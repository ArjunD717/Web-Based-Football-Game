// packages/sim/src/ai/steering.ts

import { TUNING, clamp } from "@fb/shared";
import type { BallState, Pitch, PlayerState } from "../types";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** First-order pursuit point for a moving ball, capped by player speed. */
export function interceptPoint(
  ball: BallState,
  player: PlayerState,
  maxSpeedMps: number,
): Point {
  let targetX = ball.x;
  let targetY = ball.y;
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const distance = Math.hypot(targetX - player.x, targetY - player.y);
    const travelTime =
      maxSpeedMps > 0 ? distance / maxSpeedMps : 0;
    const ballTravel = Math.min(
      ballSpeed * travelTime,
      TUNING.ai.looseBallPursuitRadiusM,
    );
    if (ballSpeed < 1e-6) {
      break;
    }
    targetX = ball.x + (ball.vx / ballSpeed) * ballTravel;
    targetY = ball.y + (ball.vy / ballSpeed) * ballTravel;
  }
  return { x: targetX, y: targetY };
}

export function clampToPitch(pitch: Pitch, x: number, y: number): Point {
  const margin = TUNING.player.pitchMarginM;
  return {
    x: clamp(x, margin, pitch.lengthM - margin),
    y: clamp(y, margin, pitch.widthM - margin),
  };
}

/**
 * Goal-side marking point. The defender stands between the attacker and its
 * own goal rather than chasing the attacker's current position.
 */
export function goalSidePoint(
  target: Point,
  ownGoalX: number,
  ownGoalY: number,
  distanceM: number,
): Point {
  const dx = ownGoalX - target.x;
  const dy = ownGoalY - target.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { x: target.x, y: target.y };
  }
  return {
    x: target.x + (dx / length) * distanceM,
    y: target.y + (dy / length) * distanceM,
  };
}

/** Offset duplicate targets so two teammates do not occupy the same lane. */
export function separatedTarget(
  target: Point,
  teammates: readonly PlayerState[],
  self: PlayerState,
  radiusM = TUNING.ai.teammateSeparationM,
): Point {
  const x = target.x;
  let y = target.y;
  let attempts = 0;
  while (attempts < 2) {
    let blocked = false;
    for (const teammate of teammates) {
      if (
        teammate === self ||
        teammate.sentOff ||
        teammate.unavailable
      ) {
        continue;
      }
      const distance = Math.hypot(
        x - teammate.targetX,
        y - teammate.targetY,
      );
      if (distance < radiusM) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      return { x, y };
    }
    y += self.number % 2 === 0 ? radiusM : -radiusM;
    attempts += 1;
  }
  return { x, y };
}
