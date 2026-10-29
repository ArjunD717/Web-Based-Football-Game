// packages/shared/src/math/angle.ts

export const TAU = Math.PI * 2;

/** Wrap an angle into [-π, π). */
export function normalizeAngle(angle: number): number {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/** Shortest signed rotation from `from` to `to`, in radians. */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Rotate `current` toward `target` without exceeding `maxDelta` radians. */
export function rotateTowards(
  current: number,
  target: number,
  maxDelta: number,
): number {
  if (!Number.isFinite(maxDelta) || maxDelta < 0) {
    throw new RangeError(`maxDelta must be a finite non-negative number`);
  }
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) {
    return normalizeAngle(target);
  }
  return normalizeAngle(current + Math.sign(delta) * maxDelta);
}
