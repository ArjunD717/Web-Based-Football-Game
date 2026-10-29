// packages/server/src/create-server.ts
import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import {
  APP_VERSION,
  CLOSE_CODES,
  PROTOCOL_VERSION,
  TUNING,
  WS_PATH,
  encodeServerMessage,
  isCompatibleProtocol,
  parseClientMessage,
  type ServerErrorCode,
  type ServerMessage,
} from "@fb/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type {
  ClientConnection,
  GameServerHandlers,
} from "./client";
import {
  createRequestHandler,
  type RequestHandler,
} from "./http/request-handler";
import type { TlsMaterial } from "./tls";

export interface Logger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message, error) => console.warn(message, error),
  error: (message, error) => console.error(message, error),
};

export interface GameServerOptions {
  readonly host: string;
  readonly port: number;
  readonly staticDir: string;
  readonly dataDir?: string;
  readonly tls?: TlsMaterial;
  readonly logger?: Logger;
  readonly handlers?: GameServerHandlers;
  /** Test seams; default to TUNING.network values. */
  readonly helloTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
}

export interface RunningGameServer {
  readonly port: number;
  readonly secure: boolean;
  close(): Promise<void>;
}

interface Session {
  readonly ws: WebSocket;
  token: string;
  handshaken: boolean;
  alive: boolean;
  helloTimer: NodeJS.Timeout | null;
  replaced: boolean;
  client: ClientConnection | null;
}

/**
 * Starts HTTP(S) + WebSocket host. TLS is optional only for tests; the CLI
 * entrypoint always supplies it because gamepad access requires a secure
 * context on LAN devices.
 */
export async function startGameServer(
  options: GameServerOptions,
): Promise<RunningGameServer> {
  const logger = options.logger ?? consoleLogger;
  const handlers = options.handlers;
  const helloTimeoutMs = options.helloTimeoutMs ?? TUNING.network.helloTimeoutMs;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? TUNING.network.serverHeartbeatIntervalMs;

  const sessions = new Set<Session>();
  /** Token → current socket. A new hello with the same token replaces the old. */
  const activeSessions = new Map<string, Session>();
  const REPLACED_SOCKET_CLOSE_GRACE_MS = 1_000;

  const countConnected = (): number => {
    let count = 0;
    for (const session of sessions) {
      if (session.handshaken) {
        count += 1;
      }
    }
    return count;
  };

  const requestHandler: RequestHandler = createRequestHandler({
    staticDir: options.staticDir,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    startedAtMs: Date.now(),
    secure: options.tls !== undefined,
    getConnectedClients: countConnected,
    onError: (error) => {
      logger.error("HTTP request failed", error);
    },
  });

  const server: HttpServer = options.tls
    ? createHttpsServer(
        { key: options.tls.key, cert: options.tls.cert },
        requestHandler,
      )
    : createHttpServer(requestHandler);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: TUNING.network.maxMessageBytes,
  });

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      socket.send(encodeServerMessage(message));
    } catch (error) {
      logger.warn("Failed to send WebSocket message", error);
    }
  };

  const sendBinary = (socket: WebSocket, data: Uint8Array): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      socket.send(data);
    } catch (error) {
      logger.warn("Failed to send binary WebSocket message", error);
    }
  };

  const fail = (
    socket: WebSocket,
    code: ServerErrorCode,
    detail: string,
    closeCode: number,
    closeReason: string,
  ): void => {
    send(socket, { t: "error", code, message: detail });
    socket.close(closeCode, closeReason);
  };

  const broadcastPresence = (): void => {
    const message: ServerMessage = {
      t: "presence",
      connectedClients: countConnected(),
    };
    for (const session of sessions) {
      if (session.handshaken) {
        send(session.ws, message);
      }
    }
  };

  const clearHelloTimer = (session: Session): void => {
    if (session.helloTimer !== null) {
      clearTimeout(session.helloTimer);
      session.helloTimer = null;
    }
  };

  const completeHandshake = (
    session: Session,
    token: string,
  ): void => {
    session.token = token;
    session.handshaken = true;
    activeSessions.set(token, session);
    clearHelloTimer(session);

    const client: ClientConnection = {
      token,
      send: (message) => {
        send(session.ws, message);
      },
      sendBinary: (data) => {
        sendBinary(session.ws, data);
      },
      close: (code, reason) => {
        session.ws.close(code, reason);
      },
    };
    session.client = client;

    send(session.ws, {
      t: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: APP_VERSION,
      sessionId: token,
      serverTimeMs: Date.now(),
    });

    try {
      handlers?.onReady?.(client);
    } catch (error) {
      logger.error("Connection ready handler failed", error);
    }

    broadcastPresence();
  };

  const handleClientMessage = (session: Session, text: string): void => {
    const message = parseClientMessage(text);
    if (message === null) {
      fail(
        session.ws,
        "bad_message",
        "Message is not valid protocol JSON",
        CLOSE_CODES.BAD_MESSAGE,
        "bad message",
      );
      return;
    }

    if (!session.handshaken) {
      if (message.t !== "hello") {
        fail(
          session.ws,
          "bad_message",
          "Handshake must start with hello",
          CLOSE_CODES.BAD_MESSAGE,
          "bad message",
        );
        return;
      }

      if (!isCompatibleProtocol(message.protocolVersion)) {
        fail(
          session.ws,
          "protocol_mismatch",
          `Protocol ${message.protocolVersion} is not supported; server speaks ${PROTOCOL_VERSION}`,
          CLOSE_CODES.PROTOCOL_MISMATCH,
          "protocol mismatch",
        );
        return;
      }

      const token = message.sessionToken ?? randomUUID();
      const existing = activeSessions.get(token);
      if (existing !== undefined && existing !== session) {
        // A silent network drop can leave the old socket half-open. The new
        // hello wins; suppress onDisconnect because the seat is being resumed.
        existing.replaced = true;
        activeSessions.delete(token);
        sessions.delete(existing);
        clearHelloTimer(existing);
        existing.ws.close(CLOSE_CODES.SESSION_REPLACED, "session replaced");
        const forceClose = setTimeout(() => {
          existing.ws.terminate();
        }, REPLACED_SOCKET_CLOSE_GRACE_MS);
        forceClose.unref();
      }

      completeHandshake(session, token);
      if (existing !== undefined && existing !== session) {
        broadcastPresence();
      }
      return;
    }

    if (message.t === "ping") {
      send(session.ws, {
        t: "pong",
        clientTimeMs: message.clientTimeMs,
        serverTimeMs: Date.now(),
      });
      return;
    }

    if (message.t === "hello") {
      fail(
        session.ws,
        "unsupported_message",
        "Handshake already completed",
        CLOSE_CODES.UNSUPPORTED_MESSAGE,
        "unsupported message",
      );
      return;
    }

    if (handlers?.onMessage !== undefined && session.client !== null) {
      try {
        handlers.onMessage(session.client, message);
      } catch (error) {
        logger.error("Application message handler failed", error);
      }
      return;
    }

    fail(
      session.ws,
      "unsupported_message",
      "No application handler is attached",
      CLOSE_CODES.UNSUPPORTED_MESSAGE,
      "unsupported message",
    );
  };

  const handleBinaryMessage = (
    session: Session,
    data: RawData,
  ): void => {
    if (!session.handshaken) {
      fail(
        session.ws,
        "bad_message",
        "Binary messages require a completed handshake",
        CLOSE_CODES.BAD_MESSAGE,
        "bad message",
      );
      return;
    }

    const bytes = rawDataToBytes(data);
    if (
      handlers?.onBinaryMessage !== undefined &&
      session.client !== null
    ) {
      try {
        handlers.onBinaryMessage(session.client, bytes);
      } catch (error) {
        logger.error("Application binary handler failed", error);
      }
      return;
    }

    fail(
      session.ws,
      "unsupported_message",
      "Binary messages are not handled by this server",
      CLOSE_CODES.UNSUPPORTED_MESSAGE,
      "unsupported message",
    );
  };

  wss.on("connection", (socket) => {
    const session: Session = {
      ws: socket,
      token: "",
      handshaken: false,
      alive: true,
      helloTimer: null,
      replaced: false,
      client: null,
    };
    sessions.add(session);

    session.helloTimer = setTimeout(() => {
      if (!session.handshaken) {
        fail(
          socket,
          "hello_timeout",
          "No hello received before the handshake deadline",
          CLOSE_CODES.HELLO_TIMEOUT,
          "hello timeout",
        );
      }
    }, helloTimeoutMs);

    socket.on("pong", () => {
      session.alive = true;
    });

    socket.on("message", (data, isBinary) => {
      if (session.replaced || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        if (isBinary) {
          handleBinaryMessage(session, data);
        } else {
          handleClientMessage(session, rawDataToString(data));
        }
      } catch (error) {
        logger.error("WebSocket message handling failed", error);
        socket.terminate();
      }
    });

    socket.on("close", () => {
      clearHelloTimer(session);
      const wasHandshaken = session.handshaken;
      const wasReplaced = session.replaced;
      const client = session.client;
      sessions.delete(session);
      if (activeSessions.get(session.token) === session) {
        activeSessions.delete(session.token);
      }
      if (wasHandshaken && !wasReplaced && client !== null) {
        try {
          handlers?.onDisconnect?.(client);
        } catch (error) {
          logger.error("Disconnect handler failed", error);
        }
      }
      if (wasHandshaken && !wasReplaced) {
        broadcastPresence();
      }
    });

    socket.on("error", (error) => {
      logger.warn("WebSocket connection error", error);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      rejectUpgrade(socket, "400 Bad Request");
      return;
    }

    if (pathname !== WS_PATH) {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const session of sessions) {
      if (!session.alive) {
        session.ws.terminate();
        continue;
      }
      session.alive = false;
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.ping();
      }
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearInterval(heartbeat);

      for (const session of sessions) {
        clearHelloTimer(session);
        session.replaced = true;
        session.ws.terminate();
      }
      sessions.clear();
      activeSessions.clear();

      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections();
      });
    })();
    return closing;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(heartbeat);
    for (const session of sessions) {
      clearHelloTimer(session);
      session.ws.terminate();
    }
    sessions.clear();
    activeSessions.clear();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    throw error;
  }

  server.on("error", (error) => {
    logger.error("HTTP server error", error);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await close();
    throw new Error("Server did not expose a TCP address");
  }

  return {
    port: address.port,
    secure: options.tls !== undefined,
    close,
  };
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return Buffer.concat(data).toString("utf8");
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return Buffer.from(data, "utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return Buffer.concat(data);
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}
