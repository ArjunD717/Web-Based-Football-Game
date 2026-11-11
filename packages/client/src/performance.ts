// packages/client/src/performance.ts

import { createPitch } from "@fb/sim";
import {
  meetsFrameBudget,
} from "./render/frame-budget";
import { createThreeRenderer } from "./render/three-renderer";
import {
  VISUAL_TUNING,
  parseVisualQuality,
} from "./render/visualTuning";
import type { MatchView, RenderPlayer, RenderTeam } from "./render/view";

const WARMUP_MS = 2_500;
const MEASURE_FRAMES = 300;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Benchmark element missing: ${selector}`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#pitch");
const status = requireElement<HTMLElement>("#status");
const results = requireElement<HTMLElement>("#results");
const rerun = requireElement<HTMLButtonElement>("#rerun");

const requestedQuality = parseVisualQuality(
  new URLSearchParams(window.location.search).get("quality"),
);
const renderer = createThreeRenderer(canvas);
renderer.resize();
renderer.setQuality?.(requestedQuality);
renderer.setCameraMode?.("broadcast");
renderer.setAutoTemporalAaDowngrade?.(false);

const pitch = createPitch();
const homeColours = {
  primary: "#e7e1cf",
  secondary: "#111815",
  keeper: "#f1c75b",
} as const;
const awayColours = {
  primary: "#4b6bff",
  secondary: "#e7e1cf",
  keeper: "#f1c75b",
} as const;
const formation: readonly (readonly [number, number])[] = [
  [4, 34],
  [18, 12],
  [18, 28],
  [18, 40],
  [18, 56],
  [36, 18],
  [36, 34],
  [36, 50],
  [58, 14],
  [58, 34],
  [58, 54],
];

function makeTeam(
  side: "home" | "away",
  colours: RenderTeam["colors"],
): RenderTeam {
  return {
    name: side,
    colors: colours,
    players: formation.map(([x, y], index): RenderPlayer => ({
      id: `${side}-${index}`,
      number: index + 1,
      team: side,
      goalkeeper: index === 0,
      x: side === "home" ? x : pitch.lengthM - x,
      y,
      facing: side === "home" ? Math.PI / 2 : -Math.PI / 2,
      state: index === 0 ? "idle" : "jog",
      stamina: 1,
      sprintSpeed: 75,
      sentOff: false,
      yellowCards: 0,
      controlled: side === "home" && index === 8,
      switchTarget: false,
    })),
  };
}

const home = makeTeam("home", homeColours);
const away = makeTeam("away", awayColours);
const baseView: Omit<MatchView, "tick" | "elapsedSeconds"> = {
  matchId: "performance",
  pitch,
  home,
  away,
  ball: { x: pitch.lengthM / 2, y: pitch.widthM / 2, z: 0.11, vx: 0, vy: 0, vz: 0, spinZ: 0 },
  selfSide: "home",
  half: 1,
  match: null,
};

let phase: "warmup" | "measure" | "done" = "warmup";
let startedAt = performance.now();
let tick = 0;
let lastFrameAt = performance.now();
const renderMs: number[] = [];
const frameIntervalsMs: number[] = [];

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function setStatus(text: string): void {
  status.textContent = text;
}

function reset(): void {
  phase = "warmup";
  startedAt = performance.now();
  lastFrameAt = startedAt;
  renderMs.length = 0;
  frameIntervalsMs.length = 0;
  results.textContent = "";
  setStatus("Warming up…");
}

function showResults(): void {
  const avgMs = average(renderMs);
  const p95Ms = percentile(renderMs, 0.95);
  const intervalAvg = average(frameIntervalsMs);
  const intervalP95 = percentile(frameIntervalsMs, 0.95);
  const budget = VISUAL_TUNING.frameBudget;
  const passes = meetsFrameBudget(p95Ms, budget);
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["quality", requestedQuality],
    ["samples", String(renderMs.length)],
    ["render avg", `${avgMs.toFixed(2)} ms`],
    ["render p95", `${p95Ms.toFixed(2)} ms`],
    ["budget", `${budget.targetFrameMs.toFixed(2)} ms`],
    ["gate", passes ? "PASS" : "FAIL"],
    ["implied fps", String(Math.round(1000 / Math.max(avgMs, 0.001)))],
    ["frame avg", `${intervalAvg.toFixed(2)} ms`],
    ["frame p95", `${intervalP95.toFixed(2)} ms`],
  ];
  results.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const key = document.createElement("span");
      key.textContent = label;
      const reading = document.createElement("span");
      reading.textContent = value;
      return [key, reading];
    }),
  );
  setStatus(passes ? "Measurement complete — PASS" : "Measurement complete — FAIL");
}

function frame(now: number): void {
  tick += 1;
  const elapsedMs = now - startedAt;
  if (phase === "warmup" && elapsedMs >= WARMUP_MS) {
    phase = "measure";
    lastFrameAt = now;
    setStatus("Measuring 300 frames…");
  }
  const view: MatchView = {
    ...baseView,
    tick,
    elapsedSeconds: elapsedMs / 1000,
  };
  const before = performance.now();
  renderer.render(view);
  const after = performance.now();
  if (phase === "measure") {
    renderMs.push(after - before);
    frameIntervalsMs.push(now - lastFrameAt);
    if (renderMs.length >= MEASURE_FRAMES) {
      phase = "done";
      showResults();
    }
  }
  lastFrameAt = now;
  requestAnimationFrame(frame);
}

rerun.addEventListener("click", reset);
window.addEventListener("error", (event) => {
  setStatus(`Error: ${event.message}`);
});
requestAnimationFrame(frame);
