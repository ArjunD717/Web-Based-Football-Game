// packages/client/src/presentation/replay-motion.ts

import type { MatchView, RenderPlayer } from "../render/view";
import type { ReplayFrame } from "./replay";

/** Sub-millimetre motion is timestamp noise, not play. */
const MIN_MOTION_M = 1e-4;
/** Above these speeds a consecutive pair is a reset/teleport, not play. */
const MAX_PLAYER_SPEED_MPS = 12;
const MAX_BALL_SPEED_MPS = 45;

export interface ReplayMotionMeasurement {
  readonly playerDeltaM: number;
  readonly ballDeltaM: number;
  readonly moved: boolean;
}

export interface ReplayMotionWindow {
  readonly frameSpanMs: number;
  /** Sample start relative to the first recorded frame. */
  readonly fromOffsetMs: number;
  /** Sample end relative to the first recorded frame; inside the same span. */
  readonly toOffsetMs: number;
  readonly playerDeltaM: number;
  readonly ballDeltaM: number;
}

function distance3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  return Math.hypot(bx - ax, by - ay, bz - az);
}

function playerDelta(first: MatchView, second: MatchView): number {
  const byId = new Map<string, RenderPlayer>();
  for (const team of [second.home, second.away]) {
    for (const player of team.players) {
      byId.set(`${player.team}:${player.id}`, player);
    }
  }
  let largest = 0;
  for (const team of [first.home, first.away]) {
    for (const player of team.players) {
      const next = byId.get(`${player.team}:${player.id}`);
      if (next === undefined) {
        continue;
      }
      largest = Math.max(
        largest,
        distance3(player.x, player.y, 0, next.x, next.y, 0),
      );
    }
  }
  return largest;
}

/** Measures the largest player displacement and ball displacement. */
export function measureReplayMotion(
  first: MatchView,
  second: MatchView,
): ReplayMotionMeasurement {
  const playerDeltaM = playerDelta(first, second);
  const ballDeltaM = distance3(
    first.ball.x,
    first.ball.y,
    first.ball.z,
    second.ball.x,
    second.ball.y,
    second.ball.z,
  );
  return {
    playerDeltaM,
    ballDeltaM,
    moved:
      playerDeltaM > MIN_MOTION_M || ballDeltaM > MIN_MOTION_M,
  };
}

/**
 * Finds the consecutive recorded pair with the largest movement and returns a
 * sub-frame window inside it. The window is relative to the first frame so a
 * caller can sample a saved clip without knowing its absolute start time.
 */
export function findReplayMotionWindow(
  frames: readonly ReplayFrame[],
): ReplayMotionWindow | null {
  const firstFrame = frames[0];
  if (firstFrame === undefined || frames.length < 2) {
    return null;
  }
  let best: ReplayMotionWindow | null = null;
  let bestScore = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const frameSpanMs = current.recordedAtMs - previous.recordedAtMs;
    if (frameSpanMs <= 0) {
      continue;
    }
    const motion = measureReplayMotion(previous.view, current.view);
    const spanSeconds = frameSpanMs / 1_000;
    if (
      motion.playerDeltaM > MAX_PLAYER_SPEED_MPS * spanSeconds + MIN_MOTION_M ||
      motion.ballDeltaM > MAX_BALL_SPEED_MPS * spanSeconds + MIN_MOTION_M
    ) {
      continue;
    }
    const score = motion.playerDeltaM + motion.ballDeltaM;
    if (score <= bestScore) {
      continue;
    }
    const fromOffsetMs =
      previous.recordedAtMs - firstFrame.recordedAtMs + frameSpanMs * 0.4;
    const toOffsetMs =
      fromOffsetMs + Math.max(1, Math.min(16, frameSpanMs * 0.5));
    best = {
      frameSpanMs,
      fromOffsetMs,
      toOffsetMs,
      playerDeltaM: motion.playerDeltaM,
      ballDeltaM: motion.ballDeltaM,
    };
    bestScore = score;
  }
  return bestScore > MIN_MOTION_M ? best : null;
}
