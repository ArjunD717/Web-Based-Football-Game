// packages/client/src/practice/main.ts
import { TUNING } from "@fb/shared";
import {
  createMatch,
  stepMatch,
  type MatchState,
} from "@fb/sim";
import { createCanvasRenderer } from "../render/canvas-renderer";
import { matchStateToView } from "../render/view";
import "./practice.css";

const TOAST_DURATION_MS = 2_600;

const canvas = byId<HTMLCanvasElement>("pitch");
const pauseButton = byId<HTMLButtonElement>("pause");
const resetButton = byId<HTMLButtonElement>("reset");
const liveChip = byId<HTMLSpanElement>("live-chip");
const homeName = byId<HTMLElement>("home-name");
const awayName = byId<HTMLElement>("away-name");
const homeSwatch = byId<HTMLElement>("home-swatch");
const awaySwatch = byId<HTMLElement>("away-swatch");
const clock = byId<HTMLElement>("clock");
const tick = byId<HTMLElement>("tick");
const ballSpeed = byId<HTMLElement>("ball-speed");
const lastTouch = byId<HTMLElement>("last-touch");
const seed = byId<HTMLElement>("seed");
const toast = byId<HTMLElement>("toast");

const renderer = createCanvasRenderer(canvas);

let match = createMatch({ seed: initialSeed() });
let paused = false;
let accumulator = 0;
let lastFrameAt = performance.now();
let lastHudAt = 0;
let toastTimer: number | null = null;

syncUrlWithSeed();
updateHud();
renderer.render(matchStateToView(match));
requestAnimationFrame(frame);

pauseButton.addEventListener("click", () => {
  setPaused(!paused);
});

resetButton.addEventListener("click", () => {
  restartMatch("New seeded kickabout");
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    setPaused(!paused);
  } else if (event.code === "KeyR") {
    event.preventDefault();
    restartMatch("New seeded kickabout");
  }
});

document.addEventListener("visibilitychange", () => {
  lastFrameAt = performance.now();
  if (document.hidden) {
    accumulator = 0;
  }
});

function frame(now: number): void {
  const frameDelta = Math.min(
    Math.max(0, (now - lastFrameAt) / 1_000),
    TUNING.presentation.maxFrameDeltaSeconds,
  );
  lastFrameAt = now;

  if (!paused) {
    accumulator += frameDelta;
    const tickSeconds = 1 / TUNING.sim.tickHz;
    let steps = 0;

    while (
      accumulator >= tickSeconds &&
      steps < TUNING.sim.maxCatchUpTicks
    ) {
      stepMatch(match);
      accumulator -= tickSeconds;
      steps += 1;
    }
    if (steps === TUNING.sim.maxCatchUpTicks) {
      // Drop the backlog rather than spiral after a slow frame.
      accumulator = 0;
    }

    if (
      now - lastHudAt >=
      1_000 / TUNING.presentation.hudUpdateHz
    ) {
      updateHud();
      lastHudAt = now;
    }
  }

  renderer.render(matchStateToView(match));
  requestAnimationFrame(frame);
}

function restartMatch(message: string): void {
  match = createMatch({ seed: (match.seed + 1) >>> 0 });
  accumulator = 0;
  syncUrlWithSeed();
  updateHud();
  renderer.render(matchStateToView(match));
  showToast(message);
}

function setPaused(next: boolean): void {
  paused = next;
  pauseButton.textContent = paused ? "Resume" : "Pause";
  pauseButton.setAttribute("aria-pressed", String(paused));
  liveChip.textContent = paused ? "Paused" : "Live";
  liveChip.dataset.state = paused ? "paused" : "live";
  updateHud();
}

function updateHud(): void {
  homeName.textContent = match.home.name;
  awayName.textContent = match.away.name;
  homeSwatch.style.backgroundColor = match.home.colors.primary;
  awaySwatch.style.backgroundColor = match.away.colors.primary;

  clock.textContent = formatClock(match.elapsedSeconds);
  tick.textContent = match.tick.toLocaleString("en-US");
  ballSpeed.textContent = `${Math.hypot(
    match.ball.vx,
    match.ball.vy,
    match.ball.vz,
  ).toFixed(1)} m/s`;
  lastTouch.textContent = lastTouchLabel(match);
  seed.textContent = `0x${match.seed
    .toString(16)
    .padStart(8, "0")
    .toUpperCase()}`;
}

function lastTouchLabel(state: MatchState): string {
  if (state.lastTouch === null) {
    return "Kick-off";
  }
  const team =
    state.lastTouch.team === "home" ? state.home.name : state.away.name;
  return `${team} #${state.lastTouch.playerNumber}`;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(
    2,
    "0",
  )}`;
}

function initialSeed(): number {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw !== null && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed >>> 0;
    }
  }

  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] ?? 1;
}

function syncUrlWithSeed(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(match.seed));
  window.history.replaceState(null, "", url.toString());
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, TOAST_DURATION_MS);
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

setPaused(false);
