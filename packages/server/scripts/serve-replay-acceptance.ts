// packages/server/scripts/serve-replay-acceptance.ts

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { consoleLogger, startGameServer } from "../src/create-server";
import { loadTeamRegistry } from "../src/data/registry";
import { RoomManager } from "../src/rooms/room-manager";
import { startSimulationLoop } from "../src/rooms/simulation-loop";
import { CAPTURE_CODE, CAPTURE_SEED } from "./capture-room";

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
const roomManager = new RoomManager({
  logger: consoleLogger,
  registry,
  generateCode: () => CAPTURE_CODE,
  matchSeed,
  aiOnly: true,
});

const server = await startGameServer({
  host: "127.0.0.1",
  port: Number(process.env.REPLAY_ACCEPTANCE_PORT ?? 4173),
  staticDir: fileURLToPath(
    new URL("../../client/dist/", import.meta.url),
  ),
  dataDir: fileURLToPath(new URL("../../../data/", import.meta.url)),
  tls,
  getReplayClip: (code, clipId) =>
    roomManager.exportReplayClip(code, clipId),
  handlers: {
    onReady: (client) => {
      roomManager.onReady(client);
    },
    onMessage: (client, message) => {
      roomManager.onMessage(client, message);
    },
    onBinaryMessage: (client, data) => {
      roomManager.onBinaryMessage(client, data);
    },
    onDisconnect: (client) => {
      roomManager.onDisconnect(client);
    },
  },
});

const simulationLoop = startSimulationLoop(roomManager);

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  simulationLoop.stop();
  roomManager.close();
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
    `(waiting for host and guest to create room ${CAPTURE_CODE})`,
);
