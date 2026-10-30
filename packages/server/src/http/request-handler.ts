// packages/server/src/http/request-handler.ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { APP_VERSION, PROTOCOL_VERSION, TUNING } from "@fb/shared";

export interface HealthSimulationMetrics {
  readonly loopHz: number;
  readonly tickBudgetMs: number;
  readonly ticks: number;
  readonly p95TickMs: number;
  readonly maxTickMs: number;
  readonly overBudgetTicks: number;
}

export interface HealthPayload {
  readonly status: "ok";
  readonly app: "web-football";
  readonly version: string;
  readonly protocolVersion: number;
  readonly secure: boolean;
  readonly uptimeSeconds: number;
  readonly connectedClients: number;
  readonly simulation?: HealthSimulationMetrics;
}

export interface RequestHandlerOptions {
  readonly staticDir: string;
  /** Generated data root. Only whitelisted public JSON and assets are served. */
  readonly dataDir?: string;
  readonly startedAtMs: number;
  readonly secure: boolean;
  readonly getConnectedClients: () => number;
  readonly getRuntimeMetrics?: () => HealthSimulationMetrics;
  readonly onError?: (error: unknown) => void;
}

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

const PUBLIC_DATA_FILES = new Set([
  "manifest.json",
  "leagues.json",
  "teams.json",
  "national-teams.json",
  "players.json",
  "nations.json",
]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function createRequestHandler(
  options: RequestHandlerOptions,
): RequestHandler {
  return (request, response) => {
    void handleRequest(request, response, options).catch((error: unknown) => {
      options.onError?.(error);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendText(
        response,
        request.method === "HEAD",
        500,
        "Internal server error",
      );
    });
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions,
): Promise<void> {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  const method = request.method ?? "GET";
  const isHead = method === "HEAD";

  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    sendText(response, isHead, 400, "Bad request");
    return;
  }

  if (pathname === "/healthz") {
    if (method !== "GET" && method !== "HEAD") {
      methodNotAllowed(response, "GET, HEAD");
      return;
    }
    sendHealth(response, options, isHead);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    methodNotAllowed(response, "GET, HEAD");
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendText(response, isHead, 400, "Bad request");
    return;
  }
  if (decodedPath.includes("\0")) {
    sendText(response, isHead, 400, "Bad request");
    return;
  }

  if (decodedPath.startsWith("/data/")) {
    if (options.dataDir === undefined) {
      sendText(response, isHead, 404, "Not found");
      return;
    }
    const relative = decodedPath.slice("/data/".length);
    if (!isPublicDataPath(relative)) {
      sendText(response, isHead, 404, "Not found");
      return;
    }
    const servedData = await serveStaticFile(
      response,
      method,
      `/${relative}`,
      options.dataDir,
    );
    if (servedData) {
      return;
    }
    sendText(response, isHead, 404, "Not found");
    return;
  }

  const served = await serveStaticFile(
    response,
    method,
    decodedPath,
    options.staticDir,
  );
  if (served) {
    return;
  }

  if (decodedPath === "/" || decodedPath === "/index.html") {
    sendLandingPage(response, isHead);
    return;
  }

  sendText(response, isHead, 404, "Not found");
}

function isPublicDataPath(relativePath: string): boolean {
  if (PUBLIC_DATA_FILES.has(relativePath)) {
    return true;
  }
  return /^assets\/[a-z0-9][a-z0-9/_-]*\.svg$/.test(relativePath);
}

async function serveStaticFile(
  response: ServerResponse,
  method: string,
  decodedPath: string,
  staticDir: string,
): Promise<boolean> {
  const isHead = method === "HEAD";
  const relativePath = decodedPath.replace(/^\/+/, "");
  const requestPath =
    relativePath === "" || relativePath.endsWith("/")
      ? `${relativePath}index.html`
      : relativePath;

  const filePath = path.resolve(staticDir, requestPath);
  const relativeToRoot = path.relative(staticDir, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    sendText(response, isHead, 403, "Forbidden");
    return true;
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
  if (!fileStats.isFile()) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    CONTENT_TYPES[extension] ?? "application/octet-stream";
  const isHtml = extension === ".html";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStats.size,
    "Cache-Control": isHtml
      ? "no-cache"
      : `public, max-age=${TUNING.http.staticMaxAgeSeconds}`,
  });

  if (isHead) {
    response.end();
    return true;
  }

  await pipeline(createReadStream(filePath), response);
  return true;
}

function sendHealth(
  response: ServerResponse,
  options: RequestHandlerOptions,
  isHead: boolean,
): void {
  const payload: HealthPayload = {
    status: "ok",
    app: "web-football",
    version: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    secure: options.secure,
    uptimeSeconds: Math.max(
      0,
      Math.floor((Date.now() - options.startedAtMs) / 1_000),
    ),
    connectedClients: options.getConnectedClients(),
    ...(options.getRuntimeMetrics === undefined
      ? {}
      : { simulation: options.getRuntimeMetrics() }),
  };

  const body = JSON.stringify(payload);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  if (isHead) {
    response.end();
  } else {
    response.end(body);
  }
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader("Allow", allow);
  sendText(response, false, 405, "Method not allowed");
}

function sendText(
  response: ServerResponse,
  isHead: boolean,
  status: number,
  text: string,
): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  if (isHead) {
    response.end();
  } else {
    response.end(text);
  }
}

function sendLandingPage(response: ServerResponse, isHead: boolean): void {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Web Football server</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #07130d; color: #e9f5ee;
      font: 16px/1.55 ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 38rem; padding: 2rem; }
    h1 { font-size: 1.6rem; margin: 0 0 .4rem; }
    p { color: #9fb9aa; }
    code { color: #7fe3a1; background: #0e2117; padding: .15rem .35rem;
      border-radius: .25rem; }
  </style>
</head>
<body>
  <main>
    <h1>Web Football server is online</h1>
    <p>Version ${APP_VERSION}, protocol ${PROTOCOL_VERSION}. Secure WebSocket
      endpoint: <code>/ws</code>.</p>
    <p>The client build was not found. For development run
      <code>pnpm dev</code> and open the Vite URL printed in the terminal.
      For the packaged path run <code>pnpm build</code> then reload.</p>
  </main>
</body>
</html>`;

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
  });
  if (isHead) {
    response.end();
  } else {
    response.end(html);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
