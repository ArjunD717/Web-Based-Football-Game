// packages/client/src/render/footsteps.ts

import type { PlayerStateName } from "@fb/sim";
import type { GaitTuning } from "./gait";

export type FootstepSide = "left" | "right";

/**
 * Presentation-only contact notification. Audio consumes it; the simulation
 * and network protocol never see it.
 */
export interface FootstepEvent {
  readonly side: FootstepSide;
  readonly state: PlayerStateName;
  /** 0..1 loudness estimate derived from the measured gait speed. */
  readonly intensity: number;
}

export type FootstepSink = (event: FootstepEvent) => void;

export interface FootstepTuning {
  /** Do not emit while the player is practically stationary. */
  readonly minSpeedMps: number;
  /** Debounce threshold for repeated stride crossings. */
  readonly minIntervalSeconds: number;
}

export function isSteppingState(state: PlayerStateName): boolean {
  return state === "jog" || state === "sprint" || state === "dribble";
}

export function footstepIntensity(
  state: PlayerStateName,
  speedMps: number,
  gait: GaitTuning,
): number {
  const reference = gait.referenceSpeedMps[state];
  if (reference === undefined || reference <= 0) {
    return 0.5;
  }
  const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
  return Math.min(1, Math.max(0.3, speed / reference));
}

export interface FootstepClockState {
  lastStepIndex: number | null;
}

export function createFootstepClock(): FootstepClockState {
  return { lastStepIndex: null };
}

export function resetFootstepClock(clock: FootstepClockState): void {
  clock.lastStepIndex = null;
}

/**
 * A stride is two steps; phase zero and phase pi put opposite feet down. The
 * clocks are advanced by the same speed-scaled phase as the gait, so audio
 * stays locked to the animation instead of firing on noisy IK contact edges.
 */
export function updateFootstepClock(
  clock: FootstepClockState,
  state: PlayerStateName,
  stridePhase: number,
  speedMps: number,
  elapsedSeconds: number,
  lastEmittedSeconds: number,
  tuning: FootstepTuning,
  gait: GaitTuning,
): FootstepEvent | null {
  if (!isSteppingState(state) || !Number.isFinite(stridePhase)) {
    resetFootstepClock(clock);
    return null;
  }
  const stepIndex = Math.floor(stridePhase / Math.PI);
  const previous = clock.lastStepIndex;
  clock.lastStepIndex = stepIndex;
  if (previous === null || stepIndex === previous) {
    return null;
  }
  if (
    speedMps < tuning.minSpeedMps ||
    (Number.isFinite(elapsedSeconds) &&
      Number.isFinite(lastEmittedSeconds) &&
      elapsedSeconds - lastEmittedSeconds < tuning.minIntervalSeconds)
  ) {
    return null;
  }
  const side: FootstepSide = stepIndex % 2 === 0 ? "left" : "right";
  return {
    side,
    state,
    intensity: footstepIntensity(state, speedMps, gait),
  };
}
