// packages/shared/src/math/vec2.test.ts
import { describe, expect, it } from "vitest";
import {
  VEC2_ZERO,
  add,
  clampLength,
  cross,
  distance,
  distanceSquared,
  dot,
  equalsWithin,
  length,
  lengthSquared,
  lerpVec2,
  normalize,
  rotate,
  scale,
  subtract,
  vec2,
} from "./vec2";

describe("vector arithmetic", () => {
  it("adds and subtracts component-wise", () => {
    expect(add(vec2(1, 2), vec2(3, -4))).toEqual(vec2(4, -2));
    expect(subtract(vec2(1, 2), vec2(3, -4))).toEqual(vec2(-2, 6));
  });

  it("scales", () => {
    expect(scale(vec2(1, -2), 3)).toEqual(vec2(3, -6));
  });

  it("does not mutate inputs", () => {
    const a = vec2(1, 2);
    const b = vec2(3, 4);
    add(a, b);
    scale(a, 10);
    expect(a).toEqual(vec2(1, 2));
    expect(b).toEqual(vec2(3, 4));
  });

  it("computes dot and cross products", () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
  });
});

describe("magnitude and distance", () => {
  it("computes lengths", () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(lengthSquared(vec2(3, 4))).toBe(25);
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
    expect(distanceSquared(vec2(1, 1), vec2(4, 5))).toBe(25);
  });

  it("normalizes to unit length", () => {
    const unit = normalize(vec2(3, 4));
    expect(length(unit)).toBeCloseTo(1, 12);
    expect(unit).toEqual(vec2(0.6, 0.8));
  });

  it("normalizes the zero vector to zero", () => {
    expect(normalize(VEC2_ZERO)).toEqual(VEC2_ZERO);
  });

  it("clamps long vectors and leaves short vectors alone", () => {
    const clamped = clampLength(vec2(3, 4), 2);
    expect(clamped.x).toBeCloseTo(1.2, 12);
    expect(clamped.y).toBeCloseTo(1.6, 12);
    expect(length(clamped)).toBeCloseTo(2, 12);
    const short = vec2(1, 0);
    expect(clampLength(short, 2)).toBe(short);
  });

  it("rejects a negative clamp length", () => {
    expect(() => clampLength(vec2(1, 1), -1)).toThrow(RangeError);
  });
});

describe("rotation and interpolation", () => {
  it("rotates counter-clockwise by 90 degrees", () => {
    const result = rotate(vec2(1, 0), Math.PI / 2);
    expect(result.x).toBeCloseTo(0, 12);
    expect(result.y).toBeCloseTo(1, 12);
  });

  it("interpolates between points", () => {
    expect(lerpVec2(vec2(0, 0), vec2(10, -4), 0.25)).toEqual(vec2(2.5, -1));
  });

  it("compares within epsilon", () => {
    expect(equalsWithin(vec2(1, 1), vec2(1.0001, 0.9999), 0.001)).toBe(true);
    expect(equalsWithin(vec2(1, 1), vec2(1.01, 1), 0.001)).toBe(false);
  });
});
