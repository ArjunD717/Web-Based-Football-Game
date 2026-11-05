// packages/server/src/config.test.ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  DEFAULT_HTTPS_PORT,
  loadServerConfig,
} from "./config";

describe("loadServerConfig", () => {
  it("uses LAN-friendly defaults", () => {
    const config = loadServerConfig({});
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_HTTPS_PORT);
    expect(path.basename(config.certDir)).toBe("certs");
    expect(config.certPath).toBe(path.join(config.certDir, "dev-cert.pem"));
    expect(config.keyPath).toBe(path.join(config.certDir, "dev-key.pem"));
    expect(config.staticDir).toMatch(/packages[\\/]client[\\/]dist$/);
    expect(path.basename(config.dataDir)).toBe("data");
    expect(config.devNetwork).toEqual({
      latencyMs: 0,
      jitterMs: 0,
      lossPct: 0,
    });
  });

  it("honours environment overrides", () => {
    const config = loadServerConfig({
      FB_HOST: "127.0.0.1",
      FB_PORT: "9443",
      FB_CERT_DIR: "tmp/certs",
      FB_STATIC_DIR: "tmp/client",
      FB_DATA_DIR: "tmp/data",
      FB_DEV_LATENCY_MS: "120",
      FB_DEV_JITTER_MS: "25",
      FB_DEV_LOSS_PCT: "10",
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(9443);
    expect(config.certDir).toBe(path.resolve("tmp/certs"));
    expect(config.staticDir).toBe(path.resolve("tmp/client"));
    expect(config.dataDir).toBe(path.resolve("tmp/data"));
    expect(config.devNetwork).toEqual({
      latencyMs: 120,
      jitterMs: 25,
      lossPct: 10,
    });
  });

  it("defaults blank host and port values", () => {
    const config = loadServerConfig({ FB_HOST: "   ", FB_PORT: "   " });
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_HTTPS_PORT);
  });

  it.each(["0", "65536", "-1", "abc", "1.5", "80x"])(
    "rejects invalid FB_PORT=%s",
    (value) => {
      expect(() => loadServerConfig({ FB_PORT: value })).toThrow(RangeError);
    },
  );

  it.each(["FB_DEV_LATENCY_MS", "FB_DEV_JITTER_MS", "FB_DEV_LOSS_PCT"])(
    "rejects negative %s",
    (name) => {
      expect(() => loadServerConfig({ [name]: "-1" })).toThrow(RangeError);
    },
  );

  it("rejects snapshot loss above 100 percent", () => {
    expect(() => loadServerConfig({ FB_DEV_LOSS_PCT: "101" })).toThrow(
      RangeError,
    );
  });
});
