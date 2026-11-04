// packages/client/src/render/three-layout.ts

import type { Pitch } from "@fb/sim";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
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
