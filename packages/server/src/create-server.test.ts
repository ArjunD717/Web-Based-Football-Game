// packages/server/src/create-server.test.ts
// These are real-socket integration tests. Timeouts below are failure bounds,
// not synchronization sleeps; the hello-deadline case intentionally exercises
// wall-clock behavior owned by the server.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";
import {
  APP_VERSION,
  CLOSE_CODES,
  PROTOCOL_VERSION,
  WS_PATH,
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "@fb/shared";
import {
  startGameServer,
  type GameServerOptions,
  type Logger,
  type RunningGameServer,
} from "./create-server";
import type { HealthPayload } from "./http/request-handler";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const activeServers: RunningGameServer[] = [];

afterEach(async () => {
  const servers = activeServers.splice(0);
  await Promise.all(servers.map(async (server) => server.close()));
});

interface Waiter {
  readonly resolve: (message: ServerMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface CloseInfo {
  readonly code: number;
  readonly reason: string;
}

class TestClient {
  readonly closed: Promise<CloseInfo>;

  private readonly queued: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise<CloseInfo>((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    ws.on("error", () => {
      // 'close' carries the information tests assert on.
    });

    ws.on("message", (data) => {
      const message = parseServerMessage(messageText(data));
      if (message === null) {
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        this.queued.push(message);
        return;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  send(message: ClientMessage): void {
    this.ws.send(encodeClientMessage(message));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  sendBinary(data: Uint8Array): void {
    this.ws.send(data);
  }

  next(timeoutMs = 2_000): Promise<ServerMessage> {
    const queued = this.queued.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }

    return new Promise<ServerMessage>((resolve, reject) => {
      let waiter: Waiter | null = null;
      const timer = setTimeout(() => {
        if (waiter !== null) {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
        }
        reject(new Error(`Timed out waiting for a server message`));
      }, timeoutMs);

      waiter = { resolve, reject, timer };
      this.waiters.push(waiter);
    });
  }

  async close(): Promise<void> {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.terminate();
    }
    await this.closed;
  }
}

describe("game server", () => {
  it("completes the handshake, reports health and echoes pings", async () => {
    const server = await startTestServer();
    const client = await openClient(server);

    client.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    const welcome = await client.next();
    expect(welcome).toMatchObject({
      t: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: APP_VERSION,
    });
    if (welcome.t === "welcome") {
      expect(welcome.sessionId.length).toBeGreaterThan(0);
      expect(welcome.serverTimeMs).toBeGreaterThan(0);
    }

    const presence = await client.next();
    expect(presence).toEqual({ t: "presence", connectedClients: 1 });

    const healthResponse = await fetch(baseUrl(server) + "/healthz");
    expect(healthResponse.status).toBe(200);
    const health = (await healthResponse.json()) as HealthPayload;
    expect(health).toMatchObject({
      status: "ok",
      app: "web-football",
      version: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      secure: false,
      connectedClients: 1,
    });

    const sentAt = Date.now();
    client.send({ t: "ping", clientTimeMs: sentAt });
    const pong = await client.next();
    expect(pong).toMatchObject({ t: "pong", clientTimeMs: sentAt });
    if (pong.t === "pong") {
      expect(pong.serverTimeMs).toBeGreaterThanOrEqual(sentAt);
    }

    await client.close();
  });

  it("broadcasts presence as clients join and leave", async () => {
    const server = await startTestServer();

    const first = await openClient(server);
    first.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    await first.next();
    expect(await first.next()).toEqual({ t: "presence", connectedClients: 1 });

    const second = await openClient(server);
    second.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    await second.next();
    expect(await second.next()).toEqual({ t: "presence", connectedClients: 2 });
    expect(await first.next()).toEqual({ t: "presence", connectedClients: 2 });

    await second.close();
    expect(await first.next()).toEqual({ t: "presence", connectedClients: 1 });

    await first.close();
  });

  it("rejects a protocol mismatch with a structured error and close code", async () => {
    const server = await startTestServer();
    const client = await openClient(server);

    client.send({ t: "hello", protocolVersion: PROTOCOL_VERSION + 1 });
    const error = await client.next();
    expect(error).toMatchObject({ t: "error", code: "protocol_mismatch" });
    if (error.t === "error") {
      expect(error.message).toContain(String(PROTOCOL_VERSION));
    }

    const closed = await client.closed;
    expect(closed.code).toBe(CLOSE_CODES.PROTOCOL_MISMATCH);
  });

  it("closes malformed JSON without crashing the server", async () => {
    const server = await startTestServer();
    const client = await openClient(server);

    client.sendRaw("{not json");
    const error = await client.next();
    expect(error).toMatchObject({ t: "error", code: "bad_message" });
    expect((await client.closed).code).toBe(CLOSE_CODES.BAD_MESSAGE);

    const healthResponse = await fetch(baseUrl(server) + "/healthz");
    expect(healthResponse.status).toBe(200);
  });

  it("rejects unsupported messages after handshake", async () => {
    const server = await startTestServer();
    const client = await openClient(server);
    client.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    await client.next();
    await client.next();

    client.sendRaw(
      JSON.stringify({ t: "hello", protocolVersion: PROTOCOL_VERSION }),
    );
    const error = await client.next();
    expect(error).toMatchObject({ t: "error", code: "unsupported_message" });
    expect((await client.closed).code).toBe(CLOSE_CODES.UNSUPPORTED_MESSAGE);
  });

  it("enforces the hello deadline", async () => {
    const server = await startTestServer({ helloTimeoutMs: 50 });
    const client = await openClient(server);

    const error = await client.next(1_000);
    expect(error).toMatchObject({ t: "error", code: "hello_timeout" });
    expect((await client.closed).code).toBe(CLOSE_CODES.HELLO_TIMEOUT);
  });

  it("serves static assets, health and safe 404s", async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "fb-http-"));
    try {
      const staticDir = path.join(workDir, "static");
      await mkdir(staticDir);
      await writeFile(path.join(staticDir, "index.html"), "<h1>fixture-index</h1>");
      await writeFile(
        path.join(staticDir, "app.js"),
        "console.log('fixture-asset');",
      );
      await writeFile(path.join(workDir, "secret.txt"), "TOP-SECRET");

      const server = await startTestServer({ staticDir });
      const base = baseUrl(server);

      const indexResponse = await fetch(`${base}/`);
      expect(indexResponse.status).toBe(200);
      expect(indexResponse.headers.get("content-type")).toContain("text/html");
      expect(indexResponse.headers.get("cache-control")).toBe("no-cache");
      expect(indexResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await indexResponse.text()).toContain("fixture-index");

      const assetResponse = await fetch(`${base}/app.js`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain(
        "text/javascript",
      );
      expect(assetResponse.headers.get("cache-control")).toContain("max-age=");
      expect(await assetResponse.text()).toBe("console.log('fixture-asset');");

      const headResponse = await fetch(`${base}/app.js`, { method: "HEAD" });
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe("");
      expect(headResponse.headers.get("content-length")).toBe(
        String(Buffer.byteLength("console.log('fixture-asset');")),
      );

      const missing = await fetch(`${base}/missing.js`);
      expect(missing.status).toBe(404);

      const methodNotAllowed = await fetch(`${base}/healthz`, {
        method: "POST",
      });
      expect(methodNotAllowed.status).toBe(405);
      expect(methodNotAllowed.headers.get("allow")).toBe("GET, HEAD");

      const traversal = await fetch(`${base}/%2e%2e/secret.txt`);
      expect(traversal.status).not.toBe(200);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("serves only whitelisted generated data files", async () => {
    const dataDir = fileURLToPath(new URL("../../../data/", import.meta.url));
    const server = await startTestServer({ dataDir });
    const base = baseUrl(server);

    const manifest = await fetch(`${base}/data/manifest.json`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/json");
    const manifestBody = (await manifest.json()) as { teams: number };
    expect(manifestBody.teams).toBeGreaterThan(0);

    const teams = await fetch(`${base}/data/teams.json`);
    expect(teams.status).toBe(200);

    for (const hidden of [
      "/data/reports/build-summary.json",
      "/data/input/sample/README.md",
      "/data/../package.json",
    ]) {
      const response = await fetch(`${base}${hidden}`);
      expect(response.status).toBe(404);
    }

    const noData = await startTestServer();
    expect((await fetch(`${baseUrl(noData)}/data/teams.json`)).status).toBe(404);
  });

  it("shows setup guidance when the client build is absent", async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "fb-no-client-"));
    try {
      const server = await startTestServer({
        staticDir: path.join(workDir, "does-not-exist"),
      });
      const response = await fetch(`${baseUrl(server)}/`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("pnpm dev");
      expect(body).toContain("pnpm build");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("stops accepting requests after close", async () => {
    const server = await startTestServer();
    const client = await openClient(server);
    const base = baseUrl(server);

    await server.close();
    await client.closed;

    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });

  it("resumes a stable session token across connections", async () => {
    const ready: string[] = [];
    const disconnected: string[] = [];
    const server = await startTestServer({
      handlers: {
        onReady: (client) => {
          ready.push(client.token);
        },
        onDisconnect: (client) => {
          disconnected.push(client.token);
        },
      },
    });

    const token = "resume-token-123";
    const first = await openClient(server);
    first.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: token,
    });
    const firstWelcome = await first.next();
    expect(firstWelcome).toMatchObject({
      t: "welcome",
      sessionId: token,
    });
    expect(ready).toEqual([token]);

    await first.close();
    const second = await openClient(server);
    second.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: token,
    });
    const secondWelcome = await second.next();
    expect(secondWelcome).toMatchObject({ t: "welcome", sessionId: token });
    expect(ready).toEqual([token, token]);
    await second.close();

    await waitForCondition(() => disconnected.length === 1);
    expect(disconnected[0]).toBe(token);
  });

  it("replaces an older socket holding the same token", async () => {
    const ready: string[] = [];
    const disconnected: string[] = [];
    const server = await startTestServer({
      handlers: {
        onReady: (client) => {
          ready.push(client.token);
        },
        onDisconnect: (client) => {
          disconnected.push(client.token);
        },
      },
    });

    const token = "shared-token";
    const first = await openClient(server);
    first.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: token,
    });
    await first.next();
    const second = await openClient(server);
    second.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: token,
    });
    await second.next();
    await first.closed;
    await waitForCondition(() => ready.length === 2);
    expect(disconnected).toEqual([]);
    await second.close();
  });

  it("forwards binary frames to application handlers", async () => {
    let resolveBinary: ((data: Uint8Array) => void) | null = null;
    const binaryPromise = new Promise<Uint8Array>((resolve) => {
      resolveBinary = resolve;
    });
    const server = await startTestServer({
      handlers: {
        onBinaryMessage: (_client, data) => {
          resolveBinary?.(data);
        },
      },
    });
    const client = await openClient(server);
    client.send({ t: "hello", protocolVersion: PROTOCOL_VERSION });
    await client.next();
    await client.next();

    client.sendBinary(new Uint8Array([16, 1, 0, 0, 0]));
    const received = await binaryPromise;
    expect(Array.from(received)).toEqual([16, 1, 0, 0, 0]);
    await client.close();
  });
});

async function startTestServer(
  overrides: Partial<GameServerOptions> = {},
): Promise<RunningGameServer> {
  const server = await startGameServer({
    host: "127.0.0.1",
    port: 0,
    staticDir: path.join(process.cwd(), ".missing-client-dist"),
    logger: silentLogger,
    helloTimeoutMs: 500,
    ...overrides,
  });
  activeServers.push(server);
  return server;
}

function baseUrl(server: RunningGameServer): string {
  return `http://127.0.0.1:${server.port}`;
}

function openClient(server: RunningGameServer): Promise<TestClient> {
  return new Promise<TestClient>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${WS_PATH}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Timed out opening the test WebSocket"));
    }, 2_000);

    const onError = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    };
    ws.once("error", onError);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.off("error", onError);
      resolve(new TestClient(ws));
    });
  });
}

function messageText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}
