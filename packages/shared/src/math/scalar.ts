// packages/shared/src/math/scalar.ts

/** Clamp a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`min (${min}) must not exceed max (${max})`);
  }
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation. `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Position of `value` between `a` and `b`; equal endpoints yield 0. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) {
    return 0;
  }
  return (value - a) / (b - a);
}

/** Hermite smoothstep with clamping at both edges. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    throw new RangeError("smoothstep edges must differ");
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
