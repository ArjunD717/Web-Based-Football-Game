// packages/sim/scripts/bench.ts
import { TUNING } from "@fb/shared";
import { createMatch, stepMatch } from "../src/index";

const requestedMatches = Number(process.argv[2] ?? "100");
const warmupMatches = Number(process.argv[3] ?? "3");
if (!Number.isInteger(requestedMatches) || requestedMatches <= 0) {
  throw new Error("match count must be a positive integer");
}
if (!Number.isInteger(warmupMatches) || warmupMatches < 0) {
  throw new Error("warmup count must be a non-negative integer");
}

const gameScale =
  (TUNING.match.gameMinutesPerHalf * 60) /
  (TUNING.match.halfRealMinutes * 60);
const maxAddedRealSeconds = TUNING.match.addedTimeCapSeconds / gameScale;
const tickLimit = Math.ceil(
  (2 * (TUNING.match.halfRealMinutes * 60 + maxAddedRealSeconds) +
    TUNING.match.halfTimeSeconds +
    TUNING.match.periodHardStopGraceSeconds / gameScale +
    60) *
    TUNING.sim.tickHz,
);

function runMatch(seed: number): number {
  const state = createMatch({ seed });
  let ticks = 0;
  while (state.referee.phase !== "fullTime" && ticks < tickLimit) {
    stepMatch(state);
    ticks += 1;
  }
  if (state.referee.phase !== "fullTime") {
    throw new Error(`benchmark match ${seed} did not reach full time`);
  }
  return ticks;
}

for (let index = 0; index < warmupMatches; index += 1) {
  runMatch(50_000 + index);
}

const heapBefore = process.memoryUsage().heapUsed;
const started = performance.now();
let totalTicks = 0;
for (let index = 0; index < requestedMatches; index += 1) {
  totalTicks += runMatch(70_000 + index);
}
const elapsedMs = performance.now() - started;
const heapAfter = process.memoryUsage().heapUsed;
const elapsedSeconds = elapsedMs / 1_000;

console.log(
  JSON.stringify(
    {
      matches: requestedMatches,
      warmupMatches,
      totalTicks,
      elapsedSeconds: Math.round(elapsedSeconds * 100) / 100,
      ticksPerSecond: Math.round(totalTicks / elapsedSeconds),
      simulatedMinutesPerSecond:
        Math.round(((totalTicks / TUNING.sim.tickHz) / 60 / elapsedSeconds) * 100) /
        100,
      averageStepMs:
        Math.round((elapsedMs / totalTicks) * 1_000) / 1_000,
      heapDeltaMb:
        Math.round(((heapAfter - heapBefore) / 1_048_576) * 100) / 100,
      tickLimit,
    },
    null,
    2,
  ),
);
