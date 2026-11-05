// packages/client/src/render/gait.ts

import type { PlayerStateName } from "@fb/sim";

/**
 * Presentation-only gait scaling. The simulation never sees this module; it
 * keeps authored foot contacts closer to the distance the player actually
 * travels between render frames.
 */
export interface StrideCalibration {
  readonly minRating: number;
  readonly neutralRating: number;
  readonly maxRating: number;
  readonly minScale: number;
  readonly maxScale: number;
}

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
 * Faster players cover more ground per stride, so their reference cadence is
 * lower for the same ground speed. The neutral rating keeps the authored
 * cadence exactly; lower and upper ratings bend it symmetrically.
 */
export function strideReferenceScale(
  sprintSpeed: number,
  calibration: StrideCalibration,
): number {
  if (!Number.isFinite(sprintSpeed)) {
    return 1;
  }
  const rating = Math.max(
    calibration.minRating,
    Math.min(calibration.maxRating, sprintSpeed),
  );
  if (rating <= calibration.neutralRating) {
    const span = Math.max(
      1,
      calibration.neutralRating - calibration.minRating,
    );
    const t = (rating - calibration.minRating) / span;
    return calibration.minScale + (1 - calibration.minScale) * t;
  }
  const span = Math.max(
    1,
    calibration.maxRating - calibration.neutralRating,
  );
  const t = (rating - calibration.neutralRating) / span;
  return 1 + (calibration.maxScale - 1) * t;
}

/**
 * Convert actual planar speed into an animation playback multiplier. The
 * reference speed maps to exactly 1, so a normal jog/sprint keeps its authored
 * cadence; only speed and per-player stride mismatches are corrected.
 */
export function gaitPlaybackScale(
  state: PlayerStateName,
  speedMps: number,
  tuning: GaitTuning,
  strideScale = 1,
): number {
  const baseReference = tuning.referenceSpeedMps[state];
  if (
    baseReference === undefined ||
    !Number.isFinite(baseReference) ||
    baseReference <= 0
  ) {
    return 1;
  }
  const reference =
    baseReference * (Number.isFinite(strideScale) ? strideScale : 1);
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
