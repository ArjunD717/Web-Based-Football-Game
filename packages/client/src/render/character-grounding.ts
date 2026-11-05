// packages/client/src/render/character-grounding.ts

import type { PlayerStateName } from "@fb/sim";
import { clamp } from "@fb/shared";
import { VISUAL_TUNING } from "./visualTuning";

/**
 * Height of the lowest ankle above the player root for a state that keeps at
 * least one foot in contact with the pitch. `null` means the state is airborne
 * or deliberately leaves the ground (header, dive, fall, celebration).
 */
export function groundedLiftFor(state: PlayerStateName): number | null {
  return VISUAL_TUNING.authoredPlayer.footPlant.groundLiftM[state] ?? null;
}

export interface FootPlantInput {
  /** Lowest ankle measured for the current pose, relative to the player root. */
  readonly currentAnkleY: number;
  /** Lowest ankle in the bind pose, relative to the player root. */
  readonly restAnkleY: number;
  /** Intended vertical lift of the root while grounded. */
  readonly desiredLiftM: number;
  /** Root offset already applied by the previous frame. */
  readonly currentOffsetM: number;
  readonly maxCorrectionM: number;
}

/**
 * Return the root offset that puts the lowest ankle at its rest height plus the
 * desired lift. The measurement includes the previous offset, so the current
 * offset is added back before clamping; without that, a sustained correction
 * would be double-counted and the body would sink.
 */
export function footPlantOffset(input: FootPlantInput): number {
  const values = [
    input.currentAnkleY,
    input.restAnkleY,
    input.desiredLiftM,
    input.currentOffsetM,
    input.maxCorrectionM,
  ];
  if (!values.every(Number.isFinite)) {
    return input.currentOffsetM;
  }
  const correction =
    input.restAnkleY + input.desiredLiftM - input.currentAnkleY;
  const max = Math.max(0, input.maxCorrectionM);
  return clamp(input.currentOffsetM + correction, -max, max);
}
