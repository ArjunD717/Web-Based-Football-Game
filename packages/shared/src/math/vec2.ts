// packages/shared/src/math/vec2.ts

/** Immutable 2D vector in simulation units (metres on the pitch). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const VEC2_ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, scalar: number): Vec2 {
  return { x: v.x * scalar, y: v.y * scalar };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product magnitude (the z component of the 3D cross product). */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSquared(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  return lengthSquared(subtract(a, b));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector; the zero vector has no direction and normalizes to zero. */
export function normalize(v: Vec2): Vec2 {
  const magnitude = length(v);
  if (magnitude === 0) {
    return VEC2_ZERO;
  }
  return { x: v.x / magnitude, y: v.y / magnitude };
}

/** Limit magnitude to `maxLength` without changing direction. */
export function clampLength(v: Vec2, maxLength: number): Vec2 {
  if (maxLength < 0) {
    throw new RangeError(`maxLength must be non-negative, got ${maxLength}`);
  }
  const magnitude = length(v);
  if (magnitude <= maxLength) {
    return v;
  }
  return scale(v, maxLength / magnitude);
}

/** Rotate counter-clockwise in standard maths orientation. */
export function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function equalsWithin(a: Vec2, b: Vec2, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}
