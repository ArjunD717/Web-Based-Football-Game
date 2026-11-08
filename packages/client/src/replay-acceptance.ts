// packages/client/src/replay-acceptance.ts

import { createPitch } from "@fb/sim";
import { MatchReplayBuffer } from "./presentation/replay";
import { createThreeRenderer } from "./render/three-renderer";
import type { MatchView, RenderPlayer, RenderTeam } from "./render/view";

const canvas = document.querySelector<HTMLCanvasElement>("#pitch")!;
const result = document.querySelector<HTMLElement>("#result")!;
const pitch = createPitch();

function player(
  id: string,
  team: "home" | "away",
  x: number,
  y: number,
): RenderPlayer {
  return {
    id,
    number: 9,
    team,
    goalkeeper: false,
    x,
    y,
    facing: team === "home" ? Math.PI / 2 : -Math.PI / 2,
    state: "idle",
    stamina: 1,
    sprintSpeed: 80,
    sentOff: false,
    yellowCards: 0,
    controlled: team === "home",
    switchTarget: false,
  };
}

const home: RenderTeam = {
  name: "Home",
  colors: { primary: "#e7e1cf", secondary: "#111815", keeper: "#f1c75b" },
  players: [player("home-9", "home", 45, 34)],
};
const away: RenderTeam = {
  name: "Away",
  colors: { primary: "#4b6bff", secondary: "#e7e1cf", keeper: "#f1c75b" },
  players: [player("away-9", "away", 60, 34)],
};

function recordedView(index: number): MatchView {
  return {
    matchId: "replay-acceptance",
    pitch,
    home,
    away,
    ball: { x: 52.5, y: 34, z: 0.11, vx: 0, vy: 0, vz: 0, spinZ: 0 },
    selfSide: "home",
    half: 1,
    match: null,
    tick: index,
    elapsedSeconds: index / 10,
  };
}

const renderer = createThreeRenderer(canvas);
renderer.resize();
renderer.setQuality?.("low");
renderer.setCameraMode?.("broadcast");
renderer.setAutoTemporalAaDowngrade?.(false);

const replay = new MatchReplayBuffer({ speed: 1 });
const frames = Array.from({ length: 21 }, (_, index) => ({
  view: recordedView(index),
  recordedAtMs: index * 100,
}));
if (!replay.loadSaved(frames) || !replay.startSaved(0)) {
  throw new Error("Could not load the saved replay clip");
}

const expectedSteps = [
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["paused", 0],
  ["reverse", 1],
  ["reverse", 1],
  ["forward", 2],
  ["seek-back", 3],
  ["seek-forward", 4],
  ["loop", 5],
] as const;

const checks: {
  readonly step: string;
  readonly expected: number;
  readonly actual: number;
  readonly tick: number;
}[] = [];
let expectedIndex = 0;

function renderSample(sample: NonNullable<ReturnType<MatchReplayBuffer["sample"]>>, step: string): void {
  renderer.render(sample.view);
  const expected = expectedSteps[expectedIndex]?.[1] ?? -1;
  const diagnostics = renderer.temporalAaDiagnostics?.();
  checks.push({
    step,
    expected,
    actual: diagnostics?.timelineResets ?? -1,
    tick: sample.view.tick,
  });
  expectedIndex += 1;
}

for (const nowMs of [0, 500, 1_000, 1_500, 1_900]) {
  const sample = replay.sample(nowMs);
  if (sample === null) {
    throw new Error("Forward replay sample was null");
  }
  renderSample(sample, "forward");
}

if (!replay.pause(2_000)) {
  throw new Error("Could not pause replay");
}
const paused = replay.sample(2_000);
if (paused === null) {
  throw new Error("Paused sample was null");
}
renderSample(paused, "paused");

for (const [direction, label] of [
  [-1, "reverse"],
  [-1, "reverse"],
  [1, "forward"],
] as const) {
  if (!replay.stepFrame(direction, 2_000)) {
    throw new Error(`${label} step failed`);
  }
  const sample = replay.sample(2_000);
  if (sample === null) {
    throw new Error(`${label} sample was null`);
  }
  renderSample(sample, label);
}

if (!replay.seek(0.1, 2_000)) {
  throw new Error("Backward seek failed");
}
const back = replay.sample(2_000);
if (back === null) {
  throw new Error("Backward seek sample was null");
}
renderSample(back, "seek-back");

if (!replay.resume(2_000) || !replay.seek(0.95, 2_000)) {
  throw new Error("Forward seek setup failed");
}
const forward = replay.sample(2_000);
if (forward === null) {
  throw new Error("Forward seek sample was null");
}
renderSample(forward, "seek-forward");

const looped = replay.sample(2_200, true);
if (looped === null) {
  throw new Error("Loop sample was null");
}
renderSample(looped, "loop");

const failed = checks.filter((check) => check.actual !== check.expected);
const report = {
  status: failed.length === 0 ? "PASS" : "FAIL",
  taaSupported:
    renderer.temporalAaDiagnostics?.().supported ?? false,
  timelineResets: renderer.temporalAaDiagnostics?.().timelineResets ?? -1,
  checks,
};
result.textContent = JSON.stringify(report, null, 2);
(window as { __replayAcceptance?: typeof report }).__replayAcceptance = report;
