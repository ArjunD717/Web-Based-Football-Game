// packages/client/src/render/ball-effects.ts

import type { Pitch } from "@fb/sim";
import type { RenderBall } from "./view";

export interface LandingPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Predict where a high ball will first reach the ground. The server remains
 * authoritative; this is a presentation-only ballistic approximation used for
 * the landing ring.
 */
export function predictLandingPoint(
  ball: RenderBall,
  pitch: Pitch,
  gravityMps2: number,
  minHeightM: number,
): LandingPoint | null {
  if (ball.z < minHeightM || gravityMps2 <= 0) {
    return null;
  }
  const descent = Math.sqrt(
    Math.max(0, ball.vz * ball.vz + 2 * gravityMps2 * Math.max(0, ball.z)),
  );
  const flightSeconds = (ball.vz + descent) / gravityMps2;
  const x = ball.x + ball.vx * flightSeconds;
  const y = ball.y + ball.vy * flightSeconds;
  if (x < 0 || x > pitch.lengthM || y < 0 || y > pitch.widthM) {
    return null;
  }
  return { x, y };
}
