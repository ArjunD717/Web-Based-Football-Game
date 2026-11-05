// packages/server/src/config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HTTPS_PORT = 8443;
export const DEFAULT_HOST = "0.0.0.0";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface DevNetworkConfig {
  /** One-way artificial latency in milliseconds. */
  readonly latencyMs: number;
  /** Symmetric random jitter around latency, milliseconds. */
  readonly jitterMs: number;
  /** Percentage of binary snapshots to drop. */
  readonly lossPct: number;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly certDir: string;
  readonly certPath: string;
  readonly keyPath: string;
  readonly staticDir: string;
  readonly dataDir: string;
  readonly devNetwork: DevNetworkConfig;
}

/**
 * Environment overrides (all optional):
 * - FB_HOST: bind address, default 0.0.0.0 so LAN devices can connect.
 * - FB_PORT: HTTPS port, default 8443.
 * - FB_CERT_DIR: directory containing dev-cert.pem + dev-key.pem.
 * - FB_STATIC_DIR: built client directory.
 * - FB_DATA_DIR: generated public football data (default repo/data).
 * - FB_DEV_LATENCY_MS / FB_DEV_JITTER_MS / FB_DEV_LOSS_PCT: dev-only network
 *   condition simulation; all default to zero.
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
  const dataDir = env.FB_DATA_DIR
    ? path.resolve(env.FB_DATA_DIR)
    : path.join(REPO_ROOT, "data");
  const devNetwork = {
    latencyMs: parseNonNegative(env.FB_DEV_LATENCY_MS, "FB_DEV_LATENCY_MS"),
    jitterMs: parseNonNegative(env.FB_DEV_JITTER_MS, "FB_DEV_JITTER_MS"),
    lossPct: parsePercent(env.FB_DEV_LOSS_PCT, "FB_DEV_LOSS_PCT"),
  };

  return {
    host,
    port,
    certDir,
    certPath: path.join(certDir, "dev-cert.pem"),
    keyPath: path.join(certDir, "dev-key.pem"),
    staticDir,
    dataDir,
    devNetwork,
  };
}

function parseNonNegative(raw: string | undefined, name: string): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 0;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 5_000) {
    throw new RangeError(
      `${name} must be a number in [0, 5000], received "${trimmed}"`,
    );
  }
  return value;
}

function parsePercent(raw: string | undefined, name: string): number {
  const value = parseNonNegative(raw, name);
  if (value > 100) {
    throw new RangeError(`${name} must be in [0, 100], received "${raw}"`);
  }
  return value;
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
