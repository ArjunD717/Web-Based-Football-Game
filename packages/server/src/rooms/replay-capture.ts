// packages/server/src/rooms/replay-capture.ts
import { TUNING, type SnapshotFrame } from "@fb/shared";

export const GOAL_REPLAY_PRE_SNAPSHOTS =
  TUNING.network.goalReplayPreSnapshots;
export const GOAL_REPLAY_POST_SNAPSHOTS =
  TUNING.network.goalReplayPostSnapshots;

export interface GoalReplayCapture {
  readonly id: string;
  readonly createdAtMs: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly clockSeconds: number;
  readonly half: 1 | 2 | 3 | 4;
  readonly frames: SnapshotFrame[];
  remaining: number;
}

export type GoalReplayRecord = Omit<GoalReplayCapture, "remaining">;

/**
 * Starts a clip from the retained history. The current frame is the final
 * pre-goal frame, so callers must not append it a second time.
 */
export function beginGoalReplay(
  id: string,
  history: readonly SnapshotFrame[],
  nowMs: number,
): GoalReplayCapture {
  const frames = [...history]
    .sort((a, b) => a.seq - b.seq)
    .slice(-GOAL_REPLAY_PRE_SNAPSHOTS);
  const goalFrame = frames.at(-1);
  return {
    id,
    createdAtMs: nowMs,
    scoreHome: goalFrame?.match.scoreHome ?? 0,
    scoreAway: goalFrame?.match.scoreAway ?? 0,
    clockSeconds: goalFrame?.match.clockSeconds ?? 0,
    half: goalFrame?.match.half ?? 1,
    frames,
    remaining: GOAL_REPLAY_POST_SNAPSHOTS,
  };
}

/** Appends a post-goal frame and returns the clip once the window closes. */
export function advanceGoalReplay(
  capture: GoalReplayCapture,
  frame: SnapshotFrame,
): GoalReplayRecord | null {
  capture.frames.push(frame);
  capture.remaining -= 1;
  return capture.remaining <= 0 ? finishGoalReplay(capture) : null;
}

export function finishGoalReplay(
  capture: GoalReplayCapture,
): GoalReplayRecord {
  return {
    id: capture.id,
    createdAtMs: capture.createdAtMs,
    scoreHome: capture.scoreHome,
    scoreAway: capture.scoreAway,
    clockSeconds: capture.clockSeconds,
    half: capture.half,
    frames: capture.frames,
  };
}
