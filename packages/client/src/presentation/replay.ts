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
  /** Live action retained before a goal, milliseconds. */
  readonly captureMs?: number;
  /** Portion of the retained action included in the goal clip. */
  readonly goalWindowMs?: number;
  /** Playback rate; 0.55 is a restrained television-style slow motion. */
  readonly speed?: number;
  readonly maxFrames?: number;
}

/**
 * A local presentation-only ring buffer. It never mutates a snapshot or asks
 * the server to pause; a goal clip is replayed over the live 3D scene while the
 * authoritative match continues underneath.
 */
export class MatchReplayBuffer {
  private readonly captureMs: number;
  private readonly goalWindowMs: number;
  private readonly speed: number;
  private readonly maxFrames: number;
  private readonly frames: ReplayFrame[] = [];
  private clip: ReplayFrame[] = [];
  private previousScore: string | null = null;
  private playbackStartedAtMs: number | null = null;
  private clipStartMs = 0;
  private clipDurationMs = 0;

  constructor(options: ReplayBufferOptions = {}) {
    this.captureMs = Math.max(1_000, options.captureMs ?? 12_000);
    this.goalWindowMs = Math.max(500, options.goalWindowMs ?? 5_500);
    this.speed = Math.max(0.1, options.speed ?? 0.55);
    this.maxFrames = Math.max(10, options.maxFrames ?? 900);
  }

  get hasClip(): boolean {
    return this.clip.length >= 2;
  }

  get active(): boolean {
    return this.playbackStartedAtMs !== null;
  }

  get durationMs(): number {
    return this.clipDurationMs;
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

    this.frames.push({ view, recordedAtMs: nowMs });
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
    this.clip = this.frames.filter((frame) => frame.recordedAtMs >= clipCutoff);
    if (this.clip.length < 2) {
      this.clip = this.frames.slice(-2);
    }
    this.clipStartMs = this.clip[0]?.recordedAtMs ?? nowMs;
    this.clipDurationMs = Math.max(1, nowMs - this.clipStartMs);
    this.playbackStartedAtMs = null;
    return true;
  }

  clear(): void {
    this.frames.length = 0;
    this.clip = [];
    this.previousScore = null;
    this.playbackStartedAtMs = null;
    this.clipStartMs = 0;
    this.clipDurationMs = 0;
  }

  start(nowMs: number): boolean {
    if (!this.hasClip) {
      return false;
    }
    this.playbackStartedAtMs = nowMs;
    return true;
  }

  stop(): void {
    this.playbackStartedAtMs = null;
  }

  sample(nowMs: number): ReplaySample | null {
    if (this.playbackStartedAtMs === null || !this.hasClip) {
      return null;
    }
    const elapsedMs = (nowMs - this.playbackStartedAtMs) * this.speed;
    if (elapsedMs >= this.clipDurationMs) {
      this.stop();
      return null;
    }
    const targetMs = this.clipStartMs + elapsedMs;
    const view = this.frameAt(targetMs);
    if (view === null) {
      this.stop();
      return null;
    }
    return {
      view,
      progress: Math.min(1, elapsedMs / this.clipDurationMs),
      elapsedMs,
      durationMs: this.clipDurationMs,
    };
  }

  private frameAt(targetMs: number): MatchView | null {
    let best: MatchView | null = null;
    let bestDistance = Infinity;
    for (const frame of this.clip) {
      const distance = Math.abs(frame.recordedAtMs - targetMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = frame.view;
      }
    }
    return best;
  }
}
