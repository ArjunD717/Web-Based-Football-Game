// packages/shared/src/math/angle.test.ts
import { describe, expect, it } from "vitest";
import { TAU, angleDelta, normalizeAngle, rotateTowards } from "./angle";

describe("normalizeAngle", () => {
  it("keeps angles inside [-π, π)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizeAngle(TAU)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(-Math.PI, 12);
  });

  it("wraps values outside one turn", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeAngle(-TAU - Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("angleDelta", () => {
  it("returns the shortest signed rotation", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(angleDelta(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(angleDelta(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("rotateTowards", () => {
  it("snaps to the target inside the step", () => {
    expect(rotateTowards(0, 0.2, 0.5)).toBeCloseTo(0.2, 12);
  });

  it("takes the signed step toward a distant target", () => {
    expect(rotateTowards(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1, 12);
    expect(rotateTowards(0, -Math.PI / 2, 0.1)).toBeCloseTo(-0.1, 12);
  });

  it("rejects an invalid step", () => {
    expect(() => rotateTowards(0, 1, -0.1)).toThrow(RangeError);
    expect(() => rotateTowards(0, 1, Number.NaN)).toThrow(RangeError);
  });
});
