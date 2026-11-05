// packages/client/src/render/foot-ik.ts

import * as THREE from "three";

/**
 * Analytic two-bone IK in world space for a hip -> knee -> ankle chain.
 *
 * The solver only returns joint positions; the caller is responsible for
 * orienting the bones. Given the same inputs it is stable across frames,
 * which is important because clip playback and team palettes must not make
 * the pose non-deterministic.
 */
export interface TwoBoneIkInput {
  readonly hip: THREE.Vector3;
  readonly target: THREE.Vector3;
  /** Direction the knee should point, usually the character's forward. */
  readonly pole: THREE.Vector3;
  readonly upperLengthM: number;
  readonly lowerLengthM: number;
  /** Keeps the fully extended leg just short of a singular straight line. */
  readonly reachMarginM?: number;
}

export interface TwoBoneIkSolution {
  readonly knee: THREE.Vector3;
  readonly ankle: THREE.Vector3;
  /** False when the target was clamped to the chain's reachable range. */
  readonly reachable: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(0, -1, 0);

export function solveTwoBoneIk(
  input: TwoBoneIkInput,
  kneeOut = new THREE.Vector3(),
  ankleOut = new THREE.Vector3(),
): TwoBoneIkSolution {
  const upper = Math.max(0, input.upperLengthM);
  const lower = Math.max(0, input.lowerLengthM);
  const margin = Math.max(0, input.reachMarginM ?? 0);
  const maxReach = Math.max(1e-4, upper + lower - margin);
  const minReach = Math.max(1e-4, Math.abs(upper - lower) + margin);

  const axis = new THREE.Vector3().subVectors(input.target, input.hip);
  const requestedDistance = axis.length();
  const reachable =
    Number.isFinite(requestedDistance) &&
    requestedDistance >= minReach &&
    requestedDistance <= maxReach;
  if (requestedDistance < 1e-6) {
    axis.copy(FALLBACK_AXIS);
  } else {
    axis.multiplyScalar(1 / requestedDistance);
  }

  const distance = THREE.MathUtils.clamp(
    Number.isFinite(requestedDistance) ? requestedDistance : maxReach,
    minReach,
    maxReach,
  );
  ankleOut.copy(input.hip).addScaledVector(axis, distance);

  const along =
    (upper * upper - lower * lower + distance * distance) /
    (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));

  const pole = new THREE.Vector3().copy(input.pole);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-10) {
    pole.crossVectors(axis, UP);
    if (pole.lengthSq() < 1e-10) {
      pole.set(0, 0, 1);
    }
  }
  pole.normalize();

  kneeOut
    .copy(input.hip)
    .addScaledVector(axis, along)
    .addScaledVector(pole, height);

  return { knee: kneeOut, ankle: ankleOut, reachable };
}

export interface FootLockTuning {
  /** Ankle height below which a foot may acquire a world-space contact. */
  readonly contactEnterM: number;
  /** Ankle height above which an existing contact is released. */
  readonly contactExitM: number;
  /** Release the contact if the hip travels farther than this from it. */
  readonly maxPlantTravelM: number;
}

export interface FootLockState {
  locked: boolean;
  readonly anchor: THREE.Vector3;
}

export interface FootLockInput {
  readonly ankle: THREE.Vector3;
  readonly hip: THREE.Vector3;
  /** World height of the ankle when the foot is flat on the pitch. */
  readonly targetY: number;
  /** Maximum distance from hip to ankle the leg chain can cover. */
  readonly maxReachM: number;
  /** False for airborne states or when the authored clip has no contact. */
  readonly grounded: boolean;
}

export interface FootLockTarget {
  readonly position: THREE.Vector3;
  readonly justLocked: boolean;
  readonly justReleased: boolean;
}

export function createFootLockState(): FootLockState {
  return { locked: false, anchor: new THREE.Vector3() };
}

export function resetFootLock(state: FootLockState): void {
  state.locked = false;
  state.anchor.set(0, 0, 0);
}

/**
 * Keep a stance foot at a fixed world position while the hips move over it.
 * The contact is acquired only when the animated ankle is already close to
 * the ground; a lifted swing foot is never pulled down to the pitch.
 */
export function updateFootLock(
  state: FootLockState,
  input: FootLockInput,
  tuning: FootLockTuning,
  targetOut = new THREE.Vector3(),
): FootLockTarget | null {
  const values = [
    input.ankle.x,
    input.ankle.y,
    input.ankle.z,
    input.hip.x,
    input.hip.z,
    input.targetY,
  ];
  if (!input.grounded || !values.every(Number.isFinite)) {
    resetFootLock(state);
    return null;
  }

  const candidateReach = Math.hypot(
    input.ankle.x - input.hip.x,
    input.targetY - input.hip.y,
    input.ankle.z - input.hip.z,
  );
  const height = input.ankle.y - input.targetY;
  if (!state.locked) {
    if (height > tuning.contactEnterM || candidateReach > input.maxReachM) {
      return null;
    }
    state.locked = true;
    state.anchor.copy(input.ankle);
    targetOut.set(state.anchor.x, input.targetY, state.anchor.z);
    return { position: targetOut, justLocked: true, justReleased: false };
  }

  const travel = Math.hypot(
    input.hip.x - state.anchor.x,
    input.hip.z - state.anchor.z,
  );
  const plantedReach = Math.hypot(
    state.anchor.x - input.hip.x,
    input.targetY - input.hip.y,
    state.anchor.z - input.hip.z,
  );
  if (
    height > tuning.contactExitM ||
    travel > tuning.maxPlantTravelM ||
    plantedReach > input.maxReachM
  ) {
    resetFootLock(state);
    return { position: targetOut, justLocked: false, justReleased: true };
  }

  targetOut.set(state.anchor.x, input.targetY, state.anchor.z);
  return { position: targetOut, justLocked: false, justReleased: false };
}
