// packages/client/src/net/interpolation.ts
import {
  TUNING,
  angleDelta,
  clamp,
  lerp,
  normalizeAngle,
  type SnapshotFrame,
  type SnapshotPlayer,
} from "@fb/shared";

interface TimedSnapshot {
  readonly receivedAtMs: number;
  readonly frame: SnapshotFrame;
}

const MAX_BUFFERED_SNAPSHOTS = 90;

/**
 * Renders 100 ms behind arrival and interpolates between the two snapshots that
 * bracket that playback time. Ball and players come from the same stream; no
 * local prediction is applied.
 */
export class SnapshotInterpolator {
  private buffer: TimedSnapshot[] = [];

  reset(): void {
    this.buffer = [];
  }

  add(frame: SnapshotFrame, receivedAtMs: number): void {
    const last = this.buffer.at(-1);
    if (last !== undefined && frame.seq <= last.frame.seq) {
      return;
    }
    this.buffer.push({ frame, receivedAtMs });
    if (this.buffer.length > MAX_BUFFERED_SNAPSHOTS) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFERED_SNAPSHOTS);
    }
  }

  sample(nowMs: number): SnapshotFrame | null {
    if (this.buffer.length === 0) {
      return null;
    }
    const first = this.buffer[0]!;
    if (this.buffer.length === 1) {
      return first.frame;
    }

    const targetMs = nowMs - TUNING.network.snapshotInterpolationDelayMs;
    const last = this.buffer[this.buffer.length - 1]!;
    if (targetMs <= first.receivedAtMs) {
      return first.frame;
    }
    if (targetMs >= last.receivedAtMs) {
      return last.frame;
    }

    let older = first;
    let newer = last;
    for (let index = 1; index < this.buffer.length; index += 1) {
      const candidate = this.buffer[index]!;
      if (candidate.receivedAtMs >= targetMs) {
        older = this.buffer[index - 1]!;
        newer = candidate;
        break;
      }
    }

    const span = newer.receivedAtMs - older.receivedAtMs;
    const alpha =
      span <= 0 ? 1 : clamp((targetMs - older.receivedAtMs) / span, 0, 1);
    return interpolateSnapshot(older.frame, newer.frame, alpha);
  }

  latest(): SnapshotFrame | null {
    return this.buffer.at(-1)?.frame ?? null;
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  get oldestAgeMs(): number | null {
    const first = this.buffer[0];
    if (first === undefined) {
      return null;
    }
    return performance.now() - first.receivedAtMs;
  }
}

function interpolateSnapshot(
  older: SnapshotFrame,
  newer: SnapshotFrame,
  alpha: number,
): SnapshotFrame {
  if (older.players.length !== newer.players.length) {
    return newer;
  }
  const players: SnapshotPlayer[] = [];
  for (let index = 0; index < newer.players.length; index += 1) {
    const a = older.players[index];
    const b = newer.players[index];
    if (a === undefined || b === undefined) {
      return newer;
    }
    players.push({
      x: lerp(a.x, b.x, alpha),
      y: lerp(a.y, b.y, alpha),
      vx: lerp(a.vx, b.vx, alpha),
      vy: lerp(a.vy, b.vy, alpha),
      facing: normalizeAngle(
        a.facing + angleDelta(a.facing, b.facing) * alpha,
      ),
      state: b.state,
      stamina: lerp(a.stamina, b.stamina, alpha),
    });
  }

  return {
    seq: newer.seq,
    tick: newer.tick,
    baseSeq: newer.baseSeq,
    controlledHome: newer.controlledHome,
    controlledAway: newer.controlledAway,
    match: newer.match,
    ball: {
      x: lerp(older.ball.x, newer.ball.x, alpha),
      y: lerp(older.ball.y, newer.ball.y, alpha),
      z: lerp(older.ball.z, newer.ball.z, alpha),
      vx: lerp(older.ball.vx, newer.ball.vx, alpha),
      vy: lerp(older.ball.vy, newer.ball.vy, alpha),
      vz: lerp(older.ball.vz, newer.ball.vz, alpha),
    },
    players,
  };
}
