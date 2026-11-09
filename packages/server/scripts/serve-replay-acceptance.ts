// packages/server/scripts/serve-replay-acceptance.ts

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startGameServer } from "../src/create-server";
import { loadTeamRegistry } from "../src/data/registry";
import {
  CAPTURE_SEED,
  createAiCaptureHost,
  waitForNaturalGoal,
} from "./capture-room";

const execFileAsync = promisify(execFile);
const tlsDir = await mkdtemp(path.join(tmpdir(), "fb-replay-tls-"));
const certPath = path.join(tlsDir, "cert.pem");
const keyPath = path.join(tlsDir, "key.pem");
await execFileAsync(process.env.OPENSSL_BIN ?? "openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-days",
  "1",
  "-subj",
  "/CN=127.0.0.1",
  "-addext",
  "subjectAltName=IP:127.0.0.1,DNS:localhost",
]);
const tls = {
  key: await readFile(keyPath),
  cert: await readFile(certPath),
};

const registry = await loadTeamRegistry(
  fileURLToPath(new URL("../../../data/", import.meta.url)),
);
const matchSeed = Number(process.env.CAPTURE_SEED ?? CAPTURE_SEED);
if (!Number.isInteger(matchSeed)) {
  throw new Error(
    `CAPTURE_SEED must be an integer, got ${process.env.CAPTURE_SEED}`,
  );
}
const room = createAiCaptureHost(registry, matchSeed);
let capturing = false;

const server = await startGameServer({
  host: "127.0.0.1",
  port: Number(process.env.REPLAY_ACCEPTANCE_PORT ?? 4173),
  staticDir: fileURLToPath(
    new URL("../../client/dist/", import.meta.url),
  ),
  dataDir: fileURLToPath(new URL("../../../data/", import.meta.url)),
  tls,
  getReplayClip: (code, clipId) =>
    room.manager.exportReplayClip(code, clipId),
  handlers: {
    onReady: (client) => {
      room.manager.onReady(client);
    },
    onMessage: (client, message) => {
      room.manager.onMessage(client, message);
      if (message.t === "setReady" && message.ready && !capturing) {
        capturing = true;
        try {
          waitForNaturalGoal(room);
        } catch (error) {
          console.error("Natural goal capture failed", error);
        }
      }
    },
    onBinaryMessage: (client, data) => {
      room.manager.onBinaryMessage(client, data);
    },
    onDisconnect: (client) => {
      room.manager.onDisconnect(client);
    },
  },
});

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  room.manager.close();
  await server.close();
  await rm(tlsDir, { recursive: true, force: true });
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

console.log(
  `Replay acceptance server: https://127.0.0.1:${server.port} ` +
    `(room ${room.code} waiting for a guest)`,
);
