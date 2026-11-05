// packages/client/src/render/footsteps.ts

import type { PlayerStateName } from "@fb/sim";
import type { GaitTuning } from "./gait";

export type FootstepSide = "left" | "right";

/**
 * Presentation-only contact notification. Audio consumes it; the simulation
 * and network protocol never see it.
 */
export interface FootstepClockEvent {
  readonly side: FootstepSide;
  readonly state: PlayerStateName;
  /** 0..1 loudness estimate derived from the measured gait speed. */
  readonly intensity: number;
}

export interface FootstepEvent extends FootstepClockEvent {
  /** World-space position of the foot at the stride crossing. */
  readonly x: number;
  readonly z: number;
  /** Camera-relative mix added by the 3D renderer. */
  readonly pan?: number;
  readonly gain?: number;
}

export type FootstepSink = (event: FootstepEvent) => void;

export interface FootstepSpatialInput {
  readonly x: number;
  readonly z: number;
  readonly listenerX: number;
  readonly listenerZ: number;
  /** Unit camera-right vector in the pitch plane. */
  readonly rightX: number;
  readonly rightZ: number;
  readonly referenceDistanceM: number;
  readonly maxDistanceM: number;
  readonly panStrength: number;
}

export interface FootstepMix {
  /** -1 hard left, 0 centre, +1 hard right. */
  readonly pan: number;
  /** 0 silent .. 1 full distance gain. */
  readonly gain: number;
}

/**
 * Camera-relative stereo placement for a footstep. The renderer supplies the
 * camera basis; audio only consumes the resulting pan and gain.
 */
export function spatializeFootstep(input: FootstepSpatialInput): FootstepMix {
  const values = [
    input.x,
    input.z,
    input.listenerX,
    input.listenerZ,
    input.rightX,
    input.rightZ,
    input.referenceDistanceM,
    input.maxDistanceM,
    input.panStrength,
  ];
  if (!values.every(Number.isFinite)) {
    return { pan: 0, gain: 0 };
  }
  const dx = input.x - input.listenerX;
  const dz = input.z - input.listenerZ;
  const distance = Math.hypot(dx, dz);
  const reference = Math.max(0.1, input.referenceDistanceM);
  const maximum = Math.max(reference, input.maxDistanceM);
  const gain =
    distance <= reference
      ? 1
      : distance >= maximum
        ? 0
        : 1 - (distance - reference) / (maximum - reference);
  const rightLength = Math.hypot(input.rightX, input.rightZ);
  const rightDot =
    rightLength > 1e-6
      ? (dx * input.rightX + dz * input.rightZ) / rightLength
      : 0;
  const pan =
    Math.max(-1, Math.min(1, rightDot / Math.max(0.75, distance))) *
    Math.max(0, Math.min(1, input.panStrength));
  return { pan, gain: Math.max(0, Math.min(1, gain)) };
}

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
): FootstepClockEvent | null {
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
