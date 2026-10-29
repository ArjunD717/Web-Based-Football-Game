// packages/server/src/tls.test.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MissingTlsMaterialError, loadTlsMaterial } from "./tls";

let workDir: string | null = null;

afterEach(async () => {
  if (workDir !== null) {
    await rm(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe("loadTlsMaterial", () => {
  it("reads both PEM buffers", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "fb-tls-"));
    const certPath = path.join(workDir, "cert.pem");
    const keyPath = path.join(workDir, "key.pem");
    await writeFile(certPath, "CERT");
    await writeFile(keyPath, "KEY");

    const material = await loadTlsMaterial(certPath, keyPath);
    expect(material.cert.toString()).toBe("CERT");
    expect(material.key.toString()).toBe("KEY");
  });

  it("explains how to fix missing certificates", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "fb-tls-"));
    const certPath = path.join(workDir, "missing-cert.pem");
    const keyPath = path.join(workDir, "missing-key.pem");

    const failure = loadTlsMaterial(certPath, keyPath);
    await expect(failure).rejects.toBeInstanceOf(MissingTlsMaterialError);
    await expect(failure).rejects.toThrow(/pnpm certs/);
  });
});
