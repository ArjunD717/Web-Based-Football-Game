// packages/client/src/presentation/replay.ts

import { TUNING } from "@fb/shared";
import type {
  MatchView,
  RenderBall,
  RenderPlayer,
  RenderTeam,
} from "../render/view";

export interface ReplayFrame {
  readonly view: MatchView;
  readonly recordedAtMs: number;
}

export interface ReplaySample {
  readonly view: MatchView;
  readonly progress: number;
  /** Media time inside the clip, milliseconds. */
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly paused: boolean;
  /** True when this sample wrapped from the clip end back to the start. */
  readonly wrapped: boolean;
}

export interface ReplayBufferOptions {
  /** Live action retained before a goal or full replay, milliseconds. */
  readonly captureMs?: number;
  /** Portion of the retained action included in the goal clip. */
  readonly goalWindowMs?: number;
  /** Playback rate; 0.55 is a restrained television-style slow motion. */
  readonly speed?: number;
  /**
   * Sampling rate for retained views. The render loop can run at 144 Hz while
   * replay only needs 60 Hz, which keeps the 15-second ring bounded.
   */
  readonly captureHz?: number;
  readonly maxFrames?: number;
  /**
   * Blend transforms between recorded snapshots. Live 30 Hz clips then render
   * smoothly on 60–144 Hz displays; discrete state still comes from the
   * nearest snapshot.
   */
  readonly interpolate?: boolean;
}

/**
 * A local presentation-only ring buffer. It never mutates a snapshot or asks
 * the server to pause; a clip is replayed over the live 3D scene while the
 * authoritative match continues underneath.
 */
export class MatchReplayBuffer {
  private readonly captureMs: number;
  private readonly goalWindowMs: number;
  private readonly defaultSpeed: number;
  private playbackSpeed: number;
  private readonly captureIntervalMs: number;
  private readonly maxFrames: number;
  private readonly interpolate: boolean;
  private readonly frames: ReplayFrame[] = [];
  private goalClip: ReplayFrame[] = [];
  private playbackFrames: ReplayFrame[] = [];
  private savedClip: ReplayFrame[] = [];
  private previousScore: string | null = null;
  private playbackStartedAtMs: number | null = null;
  private playbackLastAtMs = 0;
  private playbackElapsedMs = 0;
  private playbackPaused = false;
  private playbackStartMs = 0;
  private playbackDurationMs = 0;
  private goalStartMs = 0;
  private goalDurationMs = 0;

  constructor(options: ReplayBufferOptions = {}) {
    this.captureMs = Math.max(1_000, options.captureMs ?? 15_000);
    this.goalWindowMs = Math.max(500, options.goalWindowMs ?? 8_000);
    this.defaultSpeed = Math.max(
      0.1,
      options.speed ?? TUNING.presentation.replayDefaultSpeed,
    );
    this.playbackSpeed = this.defaultSpeed;
    const captureHz = Math.min(60, Math.max(15, options.captureHz ?? 60));
    this.captureIntervalMs = 1_000 / captureHz;
    this.maxFrames = Math.max(10, options.maxFrames ?? 1_200);
    this.interpolate = options.interpolate ?? true;
  }

  get hasClip(): boolean {
    return this.goalClip.length >= 2;
  }

  get hasCapture(): boolean {
    return this.frames.length >= 2;
  }

  get hasSavedClip(): boolean {
    return this.savedClip.length >= 2;
  }

  get captureDurationMs(): number {
    const first = this.frames[0];
    const last = this.frames.at(-1);
    return first === undefined || last === undefined
      ? 0
      : Math.max(0, last.recordedAtMs - first.recordedAtMs);
  }

  get active(): boolean {
    return this.playbackStartedAtMs !== null;
  }

  get durationMs(): number {
    return this.playbackDurationMs > 0
      ? this.playbackDurationMs
      : this.goalDurationMs;
  }

  /** Returns true when the just-recorded frame completed a goal. */
  record(
    view: MatchView,
    scoreHome: number,
    scoreAway: number,
    nowMs: number,
  ): boolean {
    const score = `${scoreHome}:${scoreAway}`;
    const scored = this.previousScore !== null && this.previousScore !== score;
    this.previousScore = score;

    const last = this.frames.at(-1);
    if (
      scored ||
      last === undefined ||
      nowMs - last.recordedAtMs >= this.captureIntervalMs - 0.5
    ) {
      this.frames.push({ view, recordedAtMs: nowMs });
    }
    const cutoff = nowMs - this.captureMs;
    while (
      this.frames.length > this.maxFrames ||
      (this.frames[0] !== undefined && this.frames[0].recordedAtMs < cutoff)
    ) {
      this.frames.shift();
    }

    if (!scored) {
      return false;
    }
    const clipCutoff = nowMs - this.goalWindowMs;
    this.goalClip = this.frames.filter(
      (frame) => frame.recordedAtMs >= clipCutoff,
    );
    if (this.goalClip.length < 2) {
      this.goalClip = this.frames.slice(-2);
    }
    this.goalStartMs = this.goalClip[0]?.recordedAtMs ?? nowMs;
    this.goalDurationMs = Math.max(1, nowMs - this.goalStartMs);
    this.playbackStartedAtMs = null;
    return true;
  }

  clear(): void {
    this.frames.length = 0;
    this.goalClip = [];
    this.playbackFrames = [];
    this.savedClip = [];
    this.previousScore = null;
    this.playbackStartedAtMs = null;
    this.playbackLastAtMs = 0;
    this.playbackElapsedMs = 0;
    this.playbackPaused = false;
    this.playbackStartMs = 0;
    this.playbackDurationMs = 0;
    this.goalStartMs = 0;
    this.goalDurationMs = 0;
  }

  start(nowMs: number): boolean {
    if (!this.hasClip) {
      return false;
    }
    this.beginPlayback(
      this.goalClip,
      this.goalStartMs,
      this.goalDurationMs,
      nowMs,
    );
    return true;
  }

  /** Replaces the saved clip used by `startSaved`; timestamps are synthetic. */
  loadSaved(frames: readonly ReplayFrame[]): boolean {
    this.savedClip = [...frames].sort(
      (a, b) => a.recordedAtMs - b.recordedAtMs,
    );
    return this.savedClip.length >= 2;
  }

  startSaved(nowMs: number): boolean {
    const first = this.savedClip[0];
    const last = this.savedClip.at(-1);
    if (!this.hasSavedClip || first === undefined || last === undefined) {
      return false;
    }
    this.beginPlayback(
      this.savedClip,
      first.recordedAtMs,
      Math.max(1, last.recordedAtMs - first.recordedAtMs),
      nowMs,
    );
    return true;
  }

  /** Replay the whole retained capture, regardless of whether a goal occurred. */
  startCapture(nowMs: number): boolean {
    if (!this.hasCapture) {
      return false;
    }
    const first = this.frames[0];
    const last = this.frames.at(-1);
    if (first === undefined || last === undefined) {
      return false;
    }
    this.beginPlayback(
      this.frames,
      first.recordedAtMs,
      Math.max(1, last.recordedAtMs - first.recordedAtMs),
      nowMs,
    );
    return true;
  }

  stop(): void {
    this.playbackStartedAtMs = null;
    this.playbackPaused = false;
  }

  get paused(): boolean {
    return this.playbackPaused;
  }

  get speed(): number {
    return this.playbackSpeed;
  }

  /** Speed changes advance the old rate up to now, avoiding a time jump. */
  setSpeed(multiplier: number, nowMs: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return;
    }
    if (this.active) {
      this.advance(nowMs);
    }
    this.playbackSpeed = Math.min(4, Math.max(0.1, multiplier));
  }

  pause(nowMs: number): boolean {
    if (!this.active) {
      return false;
    }
    this.advance(nowMs);
    this.playbackPaused = true;
    this.playbackLastAtMs = nowMs;
    return true;
  }

  resume(nowMs: number): boolean {
    if (!this.active) {
      return false;
    }
    this.playbackPaused = false;
    this.playbackLastAtMs = nowMs;
    return true;
  }

  togglePaused(nowMs: number): boolean {
    return this.playbackPaused
      ? this.resume(nowMs)
      : this.pause(nowMs);
  }

  /** Seek by normalized progress; preserves the current pause state. */
  seek(progress: number, nowMs: number): boolean {
    if (!this.active) {
      return false;
    }
    this.playbackElapsedMs =
      Math.min(1, Math.max(0, progress)) * this.playbackDurationMs;
    this.playbackLastAtMs = nowMs;
    return true;
  }

  /** Pauses and moves one frame in the requested direction. */
  stepFrame(direction: -1 | 1, nowMs: number): boolean {
    if (!this.active || this.playbackFrames.length < 2) {
      return false;
    }
    this.advance(nowMs);
    this.playbackPaused = true;
    this.playbackLastAtMs = nowMs;
    const targetMs = this.playbackStartMs + this.playbackElapsedMs;
    const index = this.frameIndexAt(targetMs);
    const next = Math.min(
      this.playbackFrames.length - 1,
      Math.max(0, index + direction),
    );
    const frame = this.playbackFrames[next];
    if (frame === undefined) {
      return false;
    }
    this.playbackElapsedMs = Math.min(
      this.playbackDurationMs,
      Math.max(0, frame.recordedAtMs - this.playbackStartMs),
    );
    return true;
  }

  /**
   * Samples playback. `loop` wraps at the end instead of stopping, which
   * keeps a whole-clip study loop running without restarting the buffer.
   */
  sample(nowMs: number, loop = false): ReplaySample | null {
    if (this.playbackStartedAtMs === null || this.playbackFrames.length < 2) {
      return null;
    }
    this.advance(nowMs);
    let wrapped = false;
    if (
      !this.playbackPaused &&
      this.playbackElapsedMs >= this.playbackDurationMs
    ) {
      if (!loop) {
        this.stop();
        return null;
      }
      this.playbackElapsedMs %= this.playbackDurationMs;
      wrapped = true;
    }
    const elapsedMs = Math.min(
      this.playbackElapsedMs,
      this.playbackDurationMs,
    );
    const targetMs = this.playbackStartMs + elapsedMs;
    const view = this.viewAt(targetMs);
    if (view === null) {
      this.stop();
      return null;
    }
    return {
      view,
      progress: Math.min(1, elapsedMs / this.playbackDurationMs),
      elapsedMs,
      durationMs: this.playbackDurationMs,
      paused: this.playbackPaused,
      wrapped,
    };
  }

  private beginPlayback(
    frames: readonly ReplayFrame[],
    startMs: number,
    durationMs: number,
    nowMs: number,
  ): void {
    this.playbackFrames = [...frames];
    this.playbackStartMs = startMs;
    this.playbackDurationMs = Math.max(1, durationMs);
    this.playbackStartedAtMs = nowMs;
    this.playbackLastAtMs = nowMs;
    this.playbackElapsedMs = 0;
    this.playbackPaused = false;
  }

  private advance(nowMs: number): void {
    if (this.playbackPaused || this.playbackStartedAtMs === null) {
      this.playbackLastAtMs = nowMs;
      return;
    }
    this.playbackElapsedMs +=
      Math.max(0, nowMs - this.playbackLastAtMs) * this.playbackSpeed;
    this.playbackLastAtMs = nowMs;
  }

  private frameIndexAt(targetMs: number): number {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < this.playbackFrames.length; index += 1) {
      const frame = this.playbackFrames[index];
      if (frame === undefined) {
        continue;
      }
      const distance = Math.abs(frame.recordedAtMs - targetMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  /** Nearest recorded frame for discrete playback. */
  private nearestFrame(targetMs: number): ReplayFrame | null {
    let best: ReplayFrame | null = null;
    let bestDistance = Infinity;
    for (const frame of this.playbackFrames) {
      const distance = Math.abs(frame.recordedAtMs - targetMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = frame;
      }
    }
    return best;
  }

  private viewAt(targetMs: number): MatchView | null {
    if (!this.interpolate) {
      return this.nearestFrame(targetMs)?.view ?? null;
    }
    const frames = this.playbackFrames;
    let lowerIndex = 0;
    let upperIndex = 0;
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame === undefined || frame.recordedAtMs > targetMs) {
        upperIndex = index;
        break;
      }
      lowerIndex = index;
      upperIndex = index;
    }
    const lower = frames[lowerIndex];
    const upper = frames[upperIndex];
    if (lower === undefined || upper === undefined || lower === upper) {
      return lower?.view ?? null;
    }
    // Timestamp arithmetic can land a hair past an exact frame boundary;
    // returning that frame avoids false timeline jumps from epsilon error.
    if (
      Math.abs(targetMs - lower.recordedAtMs) <= 1e-3 ||
      Math.abs(upper.recordedAtMs - targetMs) <= 1e-3
    ) {
      return Math.abs(targetMs - lower.recordedAtMs) <=
        Math.abs(upper.recordedAtMs - targetMs)
        ? lower.view
        : upper.view;
    }
    const spanMs = upper.recordedAtMs - lower.recordedAtMs;
    const alpha =
      spanMs > 0
        ? Math.min(1, Math.max(0, (targetMs - lower.recordedAtMs) / spanMs))
        : 0;
    return blendViews(lower.view, upper.view, alpha);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation; facing is wrapped to [-PI, PI]. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return a + delta * t;
}

function blendPlayer(
  lower: RenderPlayer,
  upper: RenderPlayer,
  alpha: number,
): RenderPlayer {
  const discrete = alpha <= 0.5 ? lower : upper;
  return {
    ...discrete,
    x: lerp(lower.x, upper.x, alpha),
    y: lerp(lower.y, upper.y, alpha),
    facing: lerpAngle(lower.facing, upper.facing, alpha),
    stamina: lerp(lower.stamina, upper.stamina, alpha),
  };
}

function blendTeam(
  lower: RenderTeam,
  upper: RenderTeam,
  alpha: number,
): RenderTeam {
  const discrete = alpha <= 0.5 ? lower : upper;
  if (
    lower.players.length !== upper.players.length ||
    lower.players.some(
      (player, index) => upper.players[index]?.id !== player.id,
    )
  ) {
    return discrete;
  }
  return {
    ...discrete,
    players: lower.players.map((player, index) => {
      const next = upper.players[index];
      return next === undefined
        ? player
        : blendPlayer(player, next, alpha);
    }),
  };
}

function blendBall(
  lower: RenderBall,
  upper: RenderBall,
  alpha: number,
): RenderBall {
  return {
    x: lerp(lower.x, upper.x, alpha),
    y: lerp(lower.y, upper.y, alpha),
    z: lerp(lower.z, upper.z, alpha),
    vx: lerp(lower.vx, upper.vx, alpha),
    vy: lerp(lower.vy, upper.vy, alpha),
    vz: lerp(lower.vz, upper.vz, alpha),
    spinZ: lerp(lower.spinZ, upper.spinZ, alpha),
  };
}

/** Blends only continuous transforms; rules state comes from the nearest frame. */
function blendViews(
  lower: MatchView,
  upper: MatchView,
  alpha: number,
): MatchView {
  const discrete = alpha <= 0.5 ? lower : upper;
  if (
    alpha <= 0 ||
    alpha >= 1 ||
    lower.matchId !== upper.matchId ||
    lower.home === undefined ||
    lower.away === undefined ||
    lower.ball === undefined
  ) {
    return discrete;
  }
  return {
    ...discrete,
    tick: Math.round(lerp(lower.tick, upper.tick, alpha)),
    elapsedSeconds: lerp(
      lower.elapsedSeconds,
      upper.elapsedSeconds,
      alpha,
    ),
    home: blendTeam(lower.home, upper.home, alpha),
    away: blendTeam(lower.away, upper.away, alpha),
    ball: blendBall(lower.ball, upper.ball, alpha),
  };
}
