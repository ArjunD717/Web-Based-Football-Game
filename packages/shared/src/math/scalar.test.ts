// packages/shared/src/math/scalar.test.ts
import { describe, expect, it } from "vitest";
import { clamp, inverseLerp, lerp, smoothstep } from "./scalar";

describe("clamp", () => {
  it("returns values inside the range unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps both ends", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("rejects min greater than max", () => {
    expect(() => clamp(5, 10, 0)).toThrow(RangeError);
  });
});

describe("lerp", () => {
  it("hits both endpoints", () => {
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
  });

  it("interpolates and extrapolates without clamping", () => {
    expect(lerp(2, 6, 0.5)).toBe(4);
    expect(lerp(2, 6, 2)).toBe(10);
  });
});

describe("inverseLerp", () => {
  it("inverts lerp", () => {
    expect(inverseLerp(2, 6, 4)).toBe(0.5);
    expect(inverseLerp(2, 6, 10)).toBe(2);
  });

  it("returns zero for equal endpoints", () => {
    expect(inverseLerp(3, 3, 9)).toBe(0);
  });
});

describe("smoothstep", () => {
  it("clamps outside the edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it("is symmetric around the midpoint", () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 10, 2) + smoothstep(0, 10, 8)).toBeCloseTo(1, 12);
  });

  it("rejects equal edges", () => {
    expect(() => smoothstep(1, 1, 0.5)).toThrow(RangeError);
  });
});
