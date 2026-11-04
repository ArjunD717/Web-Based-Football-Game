// packages/client/src/camera/cameraMath.ts

import type { TeamSide } from "@fb/sim";
import type { CameraPose, CameraVec3 } from "./types";

export interface SpringState {
  readonly value: number;
  readonly velocity: number;
}

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Exact critically damped spring step. The closed-form solution keeps the
 * response identical whether the renderer runs at 60, 120 or 144 Hz.
 *
 * `responseSeconds` is the approximate time to cover 95% of a step.
 */
export function springStep(
  state: SpringState,
  target: number,
  responseSeconds: number,
  dt: number,
): SpringState {
  const safeResponse = Math.max(0.001, responseSeconds);
  const safeDt = Math.max(0, dt);
  if (safeDt === 0) {
    return state;
  }
  const omega = 2 / safeResponse;
  const offset = state.value - target;
  const decay = Math.exp(-omega * safeDt);
  const impulse = (state.velocity + omega * offset) * safeDt;
  return {
    value: target + (offset + impulse) * decay,
    velocity: (state.velocity - omega * impulse) * decay,
  };
}

/**
 * Ease into the lower/upper limits instead of stopping abruptly. At the inner
 * edge of each soft zone the curve has the same slope as the linear interior,
 * while its slope reaches zero at the limit.
 */
export function softClamp(
  value: number,
  min: number,
  max: number,
  softnessM: number,
): number {
  if (max <= min) {
    return min;
  }
  if (value <= min) {
    return min;
  }
  if (value >= max) {
    return max;
  }
  const softness = Math.min(Math.max(0.0001, softnessM), (max - min) / 2);
  if (value < min + softness) {
    const t = (value - min) / softness;
    return min + softness * (-(t ** 3) + 2 * t ** 2);
  }
  if (value > max - softness) {
    const t = (max - value) / softness;
    return max - softness * (-(t ** 3) + 2 * t ** 2);
  }
  return value;
}

/** Move a trailing anchor toward a point while preserving a dead-zone gap. */
export function deadZonePoint(
  point: Point2,
  anchor: Point2,
  radiusM: number,
): Point2 {
  const dx = point.x - anchor.x;
  const dz = point.z - anchor.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= radiusM || distance === 0) {
    return anchor;
  }
  const travel = distance - radiusM;
  return {
    x: anchor.x + (dx / distance) * travel,
    z: anchor.z + (dz / distance) * travel,
  };
}

/**
 * The client's own team must always appear to attack left-to-right. The
 * simulation swaps ends after half-time, so the camera moves to the opposite
 * touchline when the halves change.
 */
export function cameraSideSign(selfSide: TeamSide | null, half: number): 1 | -1 {
  const homeAttacksPositive = half !== 2 && half !== 4;
  const selfAttacksPositive =
    selfSide === "away" ? !homeAttacksPositive : homeAttacksPositive;
  return selfAttacksPositive ? 1 : -1;
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - (-2 * clamped + 2) ** 3 / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: CameraVec3, b: CameraVec3, t: number): CameraVec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

export function lerpPose(
  from: CameraPose,
  to: CameraPose,
  t: number,
): CameraPose {
  const eased = easeInOutCubic(t);
  return {
    position: lerpPoint(from.position, to.position, eased),
    target: lerpPoint(from.target, to.target, eased),
    fovDegrees: lerp(from.fovDegrees, to.fovDegrees, eased),
  };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
