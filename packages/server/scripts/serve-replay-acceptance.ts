// packages/server/scripts/serve-replay-acceptance.ts

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WireReplayExport } from "@fb/shared";
import { startGameServer, type Logger } from "../src/create-server";
import { loadTeamRegistry } from "../src/data/registry";
import { ReplayStore } from "../src/replays/replay-store";
import { RoomManager } from "../src/rooms/room-manager";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const fixturePath = fileURLToPath(
  new URL(
    "../../client/public/fixtures/server-goal-replay.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(
  await readFile(fixturePath, "utf8"),
) as WireReplayExport;
const replayDir = await mkdtemp(path.join(tmpdir(), "fb-replay-http-"));

const store = new ReplayStore({ dir: replayDir, logger: silentLogger });
await store.initialize();
store.saveClip(fixture.code, {
  id: fixture.id,
  kind: fixture.kind,
  scoreHome: fixture.scoreHome,
  scoreAway: fixture.scoreAway,
  clockSeconds: fixture.clockSeconds,
  half: fixture.half,
  createdAtMs: fixture.createdAtMs,
  setup: fixture.setup,
  frames: fixture.frames,
});
await store.flush();

const registry = await loadTeamRegistry(
  fileURLToPath(new URL("../../../data/", import.meta.url)),
);
const manager = new RoomManager({
  logger: silentLogger,
  registry,
  replayStore: store,
});
const server = await startGameServer({
  host: "127.0.0.1",
  port: Number(process.env.REPLAY_ACCEPTANCE_PORT ?? 4173),
  staticDir: fileURLToPath(
    new URL("../../client/dist/", import.meta.url),
  ),
  dataDir: fileURLToPath(new URL("../../../data/", import.meta.url)),
  logger: silentLogger,
  getReplayClip: (code, clipId) =>
    manager.exportReplayClip(code, clipId),
  getReplayLibrary: () => ({ rooms: store.listRooms() }),
});

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  manager.close();
  await store.flush();
  await server.close();
  await rm(replayDir, { recursive: true, force: true });
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

console.log(
  `Replay acceptance server: http://127.0.0.1:${server.port} (${fixture.code}/${fixture.id})`,
);
