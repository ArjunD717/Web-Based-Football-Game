// packages/client/src/presentation/replay.ts

import type { MatchView } from "../render/view";

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
}

/**
 * A local presentation-only ring buffer. It never mutates a snapshot or asks
 * the server to pause; a clip is replayed over the live 3D scene while the
 * authoritative match continues underneath.
 */
export class MatchReplayBuffer {
  private readonly captureMs: number;
  private readonly goalWindowMs: number;
  private readonly speed: number;
  private readonly captureIntervalMs: number;
  private readonly maxFrames: number;
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
    this.speed = Math.max(0.1, options.speed ?? 0.55);
    const captureHz = Math.min(60, Math.max(15, options.captureHz ?? 60));
    this.captureIntervalMs = 1_000 / captureHz;
    this.maxFrames = Math.max(10, options.maxFrames ?? 1_200);
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

  sample(nowMs: number): ReplaySample | null {
    if (this.playbackStartedAtMs === null || this.playbackFrames.length < 2) {
      return null;
    }
    this.advance(nowMs);
    if (
      !this.playbackPaused &&
      this.playbackElapsedMs >= this.playbackDurationMs
    ) {
      this.stop();
      return null;
    }
    const elapsedMs = Math.min(
      this.playbackElapsedMs,
      this.playbackDurationMs,
    );
    const targetMs = this.playbackStartMs + elapsedMs;
    const view = this.frameAt(targetMs);
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
      Math.max(0, nowMs - this.playbackLastAtMs) * this.speed;
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

  private frameAt(targetMs: number): MatchView | null {
    let best: MatchView | null = null;
    let bestDistance = Infinity;
    for (const frame of this.playbackFrames) {
      const distance = Math.abs(frame.recordedAtMs - targetMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = frame.view;
      }
    }
    return best;
  }
}
