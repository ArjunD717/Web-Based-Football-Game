// packages/client/src/presentation/replay.ts

import type { MatchView } from "../render/view";

export interface ReplayFrame {
  readonly view: MatchView;
  readonly recordedAtMs: number;
}

export interface ReplaySample {
  readonly view: MatchView;
  readonly progress: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
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
  }

  sample(nowMs: number): ReplaySample | null {
    if (this.playbackStartedAtMs === null || this.playbackFrames.length < 2) {
      return null;
    }
    const elapsedMs = (nowMs - this.playbackStartedAtMs) * this.speed;
    if (elapsedMs >= this.playbackDurationMs) {
      this.stop();
      return null;
    }
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
