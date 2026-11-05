// packages/client/src/render/gait.ts

import type { PlayerStateName } from "@fb/sim";

/**
 * Presentation-only gait scaling. The simulation never sees this module; it
 * keeps authored foot contacts closer to the distance the player actually
 * travels between render frames.
 */
export interface GaitTuning {
  /** Nominal movement speed for each locomotion state, in metres/second. */
  readonly referenceSpeedMps: Partial<Record<PlayerStateName, number>>;
  /** Slowest playback used when a locomotion state is nearly stationary. */
  readonly minPlaybackScale: number;
  /** Fastest playback used when the state speed is above its reference. */
  readonly maxPlaybackScale: number;
  /** Exponential smoothing rate for measured movement speed. */
  readonly speedSmoothingRate: number;
  /** Reject measured speeds above this as teleports/numerical spikes. */
  readonly speedCapMps: number;
}

export function isLocomotionState(state: PlayerStateName): boolean {
  return (
    state === "idle" ||
    state === "jog" ||
    state === "sprint" ||
    state === "dribble"
  );
}

/**
 * Convert actual planar speed into an animation playback multiplier. The
 * reference speed maps to exactly 1, so a normal jog/sprint keeps its authored
 * cadence; only mismatches are corrected.
 */
export function gaitPlaybackScale(
  state: PlayerStateName,
  speedMps: number,
  tuning: GaitTuning,
): number {
  const reference = tuning.referenceSpeedMps[state];
  if (reference === undefined || !Number.isFinite(reference) || reference <= 0) {
    return 1;
  }
  const speed = Number.isFinite(speedMps)
    ? Math.min(Math.max(0, speedMps), tuning.speedCapMps)
    : 0;
  return Math.min(
    tuning.maxPlaybackScale,
    Math.max(tuning.minPlaybackScale, speed / reference),
  );
}

/**
 * Smooth the frame-to-frame speed estimate. `distanceM` is the root travel
 * since the previous update; it is capped to avoid a single network teleport
 * forcing a full-speed animation.
 */
export function updateGaitSpeed(
  currentMps: number,
  distanceM: number,
  deltaSeconds: number,
  tuning: GaitTuning,
): number {
  if (
    !Number.isFinite(currentMps) ||
    !Number.isFinite(distanceM) ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return Number.isFinite(currentMps) ? Math.max(0, currentMps) : 0;
  }
  const instant = Math.min(
    tuning.speedCapMps,
    Math.max(0, distanceM / deltaSeconds),
  );
  const blend = 1 - Math.exp(-tuning.speedSmoothingRate * deltaSeconds);
  return currentMps + (instant - currentMps) * blend;
}
