// packages/server/scripts/capture-replay-fixture.ts

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TUNING, type ClientMessage, type ServerMessage, type WireReplayExport } from "@fb/shared";
import type { ClientConnection } from "../src/client";
import type { Logger } from "../src/create-server";
import { loadTeamRegistry } from "../src/data/registry";
import { RoomManager } from "../src/rooms/room-manager";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class CaptureClient implements ClientConnection {
  readonly json: ServerMessage[] = [];

  constructor(readonly token: string) {}

  send(message: ServerMessage): void {
    this.json.push(message);
  }

  sendBinary(_data: Uint8Array): void {}

  close(_code: number, _reason: string): void {}
}

function latestReplayClips(client: CaptureClient) {
  for (let index = client.json.length - 1; index >= 0; index -= 1) {
    const message = client.json[index];
    if (message?.t === "replayClips") {
      return message.clips;
    }
  }
  return [];
}

const dataDir = fileURLToPath(new URL("../../../data/", import.meta.url));
const output = fileURLToPath(
  new URL("../../client/public/fixtures/server-goal-replay.json", import.meta.url),
);

const registry = await loadTeamRegistry(dataDir);
const matchSeed = Number(process.env.CAPTURE_SEED ?? 20_261_108);
if (!Number.isInteger(matchSeed)) {
  throw new Error(`CAPTURE_SEED must be an integer, got ${process.env.CAPTURE_SEED}`);
}
const manager = new RoomManager({
  logger: silentLogger,
  registry,
  generateCode: () => "ABCD",
  matchSeed,
  aiOnly: true,
});
const host = new CaptureClient("capture-host");
const guest = new CaptureClient("capture-guest");
manager.onReady(host);
manager.onMessage(host, { t: "createRoom" });
manager.onReady(guest);
manager.onMessage(guest, { t: "joinRoom", code: "ABCD" } satisfies ClientMessage);
manager.onMessage(host, { t: "setReady", ready: true });
manager.onMessage(guest, { t: "setReady", ready: true });

const maxTicks = TUNING.sim.tickHz * 60 * 20;
for (let tick = 0; tick < maxTicks; tick += 1) {
  manager.tick(1 / 60);
  if (latestReplayClips(host).length > 0) {
    break;
  }
}
const clips = latestReplayClips(host);
const latest = clips.at(-1);
if (latest === undefined) {
  throw new Error(
    `No natural goal was captured with seed ${matchSeed} in ${maxTicks} ticks`,
  );
}
const captured = manager.exportReplayClip("ABCD", latest.id);
if (captured === null) {
  throw new Error("Captured clip could not be exported");
}

// Normalise incidental metadata so regenerating the fixture is diff-stable;
// frames, lineups and the match clock are untouched server output.
if (
  captured.id === undefined ||
  captured.kind !== "goal" ||
  captured.scoreHome === undefined ||
  captured.scoreAway === undefined ||
  captured.clockSeconds === undefined ||
  captured.half === undefined
) {
  throw new Error("Exported clip is missing goal metadata");
}
const fixture: WireReplayExport = {
  id: captured.id,
  kind: captured.kind,
  scoreHome: captured.scoreHome,
  scoreAway: captured.scoreAway,
  clockSeconds: captured.clockSeconds,
  half: captured.half,
  createdAtMs: 0,
  frameCount: captured.frames.length,
  code: captured.code,
  generatedAtMs: 0,
  setup: {
    ...captured.setup,
    matchId: "server-captured-goal",
    seed: 7,
  },
  frames: captured.frames,
};

await mkdir(fileURLToPath(new URL("../public/fixtures/", import.meta.url)), {
  recursive: true,
});
await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${fixture.frames.length} frames (${fixture.id}) from room ${fixture.code} to ${output}`,
);
manager.close();
