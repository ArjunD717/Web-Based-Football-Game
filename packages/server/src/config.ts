// packages/server/src/config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HTTPS_PORT = 8443;
export const DEFAULT_HOST = "0.0.0.0";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly certDir: string;
  readonly certPath: string;
  readonly keyPath: string;
  readonly staticDir: string;
}

/**
 * Environment overrides (all optional):
 * - FB_HOST: bind address, default 0.0.0.0 so LAN devices can connect.
 * - FB_PORT: HTTPS port, default 8443.
 * - FB_CERT_DIR: directory containing dev-cert.pem + dev-key.pem.
 * - FB_STATIC_DIR: built client directory.
 */
export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const host = env.FB_HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(env.FB_PORT);
  const certDir = env.FB_CERT_DIR
    ? path.resolve(env.FB_CERT_DIR)
    : path.join(REPO_ROOT, "certs");
  const staticDir = env.FB_STATIC_DIR
    ? path.resolve(env.FB_STATIC_DIR)
    : path.join(REPO_ROOT, "packages", "client", "dist");

  return {
    host,
    port,
    certDir,
    certPath: path.join(certDir, "dev-cert.pem"),
    keyPath: path.join(certDir, "dev-key.pem"),
    staticDir,
  };
}

function parsePort(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_HTTPS_PORT;
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(
      `FB_PORT must be an integer in [1, 65535], received "${trimmed}"`,
    );
  }
  return port;
}
