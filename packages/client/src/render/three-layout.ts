// packages/client/src/render/three-layout.ts

import type { Pitch } from "@fb/sim";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fovDegrees: number;
}

/**
 * The simulation uses x along the touchline (length), y across it (width) and
 * z upwards. Three.js uses x/z for the ground plane and y upwards.
 */
export function pitchToWorld(pitch: Pitch, x: number, y: number, z = 0): Vec3 {
  return {
    x: x - pitch.lengthM / 2,
    y: z,
    z: y - pitch.widthM / 2,
  };
}

/** Simulation heading 0 points toward +x; Three.js rotates around +y. */
export function facingToRotationY(facing: number): number {
  return -facing;
}

/**
 * Fit the whole pitch into a perspective camera regardless of viewport aspect.
 * The camera sits above and beside the touchline, giving a readable broadcast
 * angle while preserving real pitch proportions.
 */
export function computeCameraPose(
  pitch: Pitch,
  aspect: number,
  fovDegrees = 42,
  margin = 1.12,
): CameraPose {
  const safeAspect = Math.max(0.2, Number.isFinite(aspect) ? aspect : 1);
  const verticalFov = (fovDegrees * Math.PI) / 180;
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  // The near/far touchlines are foreshortened by the camera elevation, so the
  // width needs less altitude than a naive perpendicular fit would suggest.
  const projectedWidth = pitch.widthM * 0.95;
  const widthDistance =
    (projectedWidth * Math.max(1, margin)) / (2 * Math.tan(verticalFov / 2));
  const lengthDistance =
    (pitch.lengthM * Math.max(1, margin)) / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(widthDistance, lengthDistance) + 4;
  const direction = { x: 0, y: 0.72, z: 0.7 };
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  return {
    position: {
      x: 0,
      y: (direction.y / magnitude) * distance,
      z: (direction.z / magnitude) * distance,
    },
    target: { x: 0, y: 0, z: 0 },
    fovDegrees,
  };
}
