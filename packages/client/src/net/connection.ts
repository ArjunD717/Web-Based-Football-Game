// packages/client/src/net/connection.ts
import {
  PROTOCOL_VERSION,
  TUNING,
  WS_PATH,
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerErrorCode,
  type ServerWelcomeMessage,
} from "@fb/shared";

export type LinkStatus =
  | "idle"
  | "connecting"
  | "online"
  | "retrying"
  | "offline";

export interface LinkSnapshot {
  readonly status: LinkStatus;
  readonly detail: string;
  readonly endpoint: string;
  readonly serverVersion: string | null;
  readonly protocolVersion: number | null;
  readonly sessionId: string | null;
  readonly connectedClients: number | null;
  readonly latencyMs: number | null;
}

type LinkState = LinkSnapshot;

type Listener = (snapshot: LinkSnapshot) => void;

const PROTOCOL_FAILURE_CODE: ServerErrorCode = "protocol_mismatch";

/** Same-origin endpoint; Vite proxies it in dev, Node serves both in production. */
export function defaultWebSocketEndpoint(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${WS_PATH}`;
}

/**
 * Transport-only client for M0: handshake, presence, latency and reconnect.
 * It intentionally owns no simulation state; that arrives with snapshots.
 */
export class ServerLink {
  private readonly listeners = new Set<Listener>();
  private state: LinkState;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private stopped = true;
  private protocolFailed = false;
  private reconnectDelayMs: number = TUNING.network.reconnectBaseDelayMs;

  constructor(endpoint: string = defaultWebSocketEndpoint()) {
    this.state = {
      status: "idle",
      detail: "Not connected",
      endpoint,
      serverVersion: null,
      protocolVersion: null,
      sessionId: null,
      connectedClients: null,
      latencyMs: null,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): LinkSnapshot {
    return { ...this.state };
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.protocolFailed = false;
    this.reconnectDelayMs = TUNING.network.reconnectBaseDelayMs;
    this.connect();
  }

  stop(detail = "Disconnected by user"): void {
    this.stopped = true;
    this.protocolFailed = false;
    this.clearReconnectTimer();
    this.clearPingTimer();

    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, "client disconnect");
    }

    this.update({
      status: "offline",
      detail,
      serverVersion: null,
      protocolVersion: null,
      sessionId: null,
      connectedClients: null,
      latencyMs: null,
    });
  }

  restart(): void {
    this.stop("Restarting connection");
    this.start();
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.update({
      status: "connecting",
      detail: "Opening secure WebSocket",
      serverVersion: null,
      protocolVersion: null,
      sessionId: null,
      connectedClients: null,
      latencyMs: null,
    });

    const socket = new WebSocket(this.state.endpoint);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.update({ status: "connecting", detail: "Waiting for handshake" });
      this.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleServerMessage(event.data);
    };

    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.update({ detail: "Socket error; waiting for close event" });
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.handleClose(event);
    };
  }

  private handleServerMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      this.update({ detail: "Ignored non-text server frame" });
      return;
    }

    const message = parseServerMessage(raw);
    if (message === null) {
      this.update({ detail: "Ignored malformed server message" });
      return;
    }

    switch (message.t) {
      case "welcome":
        this.handleWelcome(message);
        break;
      case "presence":
        this.update({ connectedClients: message.connectedClients });
        break;
      case "pong":
        this.update({
          latencyMs: Math.max(0, Date.now() - message.clientTimeMs),
        });
        break;
      case "error":
        this.handleServerError(message.code, message.message);
        break;
    }
  }

  private handleWelcome(message: ServerWelcomeMessage): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      this.protocolFailed = true;
      this.clearPingTimer();
      this.update({
        status: "offline",
        detail: `Protocol mismatch: server ${message.protocolVersion}, client ${PROTOCOL_VERSION}`,
      });
      // 1002 is the standard "protocol error" close status.
      this.socket?.close(1002, "protocol mismatch");
      return;
    }

    this.reconnectDelayMs = TUNING.network.reconnectBaseDelayMs;
    this.update({
      status: "online",
      detail: "Handshake complete",
      serverVersion: message.serverVersion,
      protocolVersion: message.protocolVersion,
      sessionId: message.sessionId,
    });
    this.startPingTimer();
  }

  private handleServerError(code: ServerErrorCode, message: string): void {
    const fatal = code === PROTOCOL_FAILURE_CODE;
    if (fatal) {
      this.protocolFailed = true;
      this.clearPingTimer();
    }
    this.update({
      ...(fatal ? { status: "offline" as const } : {}),
      detail: `${code}: ${message}`,
    });
  }

  private handleClose(event: CloseEvent): void {
    this.clearPingTimer();

    if (this.stopped) {
      return;
    }

    if (this.protocolFailed) {
      this.update({
        status: "offline",
        detail: `Connection closed (${event.code}). Protocol mismatch requires a reload.`,
      });
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      delay * 2,
      TUNING.network.reconnectMaxDelayMs,
    );

    this.update({
      status: "retrying",
      detail: `Disconnected (${event.code}). Retrying in ${(delay / 1_000).toFixed(1)} s`,
      serverVersion: null,
      protocolVersion: null,
      sessionId: null,
      connectedClients: null,
      latencyMs: null,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPingTimer(): void {
    this.clearPingTimer();
    const ping = (): void => {
      this.send({ t: "ping", clientTimeMs: Date.now() });
    };
    ping();
    this.pingTimer = window.setInterval(
      ping,
      TUNING.network.clientPingIntervalMs,
    );
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(encodeClientMessage(message));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private update(patch: Partial<LinkState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
