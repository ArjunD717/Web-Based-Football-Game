import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { WireReplayExport } from "@fb/shared";
import { loadTeamRegistry } from "../src/data/registry";
import {
  CAPTURE_CODE,
  CAPTURE_SEED,
  createAiCaptureRoom,
  waitForNaturalGoal,
} from "./capture-room";

const dataDir = fileURLToPath(new URL("../../../data/", import.meta.url));
const output = fileURLToPath(
  new URL("../../client/public/fixtures/server-goal-replay.json", import.meta.url),
);

const registry = await loadTeamRegistry(dataDir);
const matchSeed = Number(process.env.CAPTURE_SEED ?? CAPTURE_SEED);
if (!Number.isInteger(matchSeed)) {
  throw new Error(`CAPTURE_SEED must be an integer, got ${process.env.CAPTURE_SEED}`);
}
const room = createAiCaptureRoom(registry, matchSeed, CAPTURE_CODE);
const latest = waitForNaturalGoal(room);
const captured = room.manager.exportReplayClip(room.code, latest.id);
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
room.manager.close();
