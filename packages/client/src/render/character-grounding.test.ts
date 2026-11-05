// packages/client/src/render/character-grounding.test.ts

import { describe, expect, it } from "vitest";
import {
  footPlantOffset,
  groundedLiftFor,
} from "./character-grounding";

describe("authored player foot planting", () => {
  it("identifies grounded and airborne states", () => {
    expect(groundedLiftFor("idle")).toBe(0);
    expect(groundedLiftFor("sprint")).toBeGreaterThan(
      groundedLiftFor("jog") ?? 0,
    );
    expect(groundedLiftFor("slide")).toBeNull();
    expect(groundedLiftFor("diveLeft")).toBeNull();
    expect(groundedLiftFor("header")).toBeNull();
  });

  it("lowers or raises the root to restore the rest ankle height", () => {
    const base = {
      restAnkleY: 0.1,
      desiredLiftM: 0,
      currentOffsetM: 0,
      maxCorrectionM: 0.2,
    };
    expect(footPlantOffset({ ...base, currentAnkleY: 0.13 })).toBeCloseTo(-0.03);
    expect(footPlantOffset({ ...base, currentAnkleY: 0.07 })).toBeCloseTo(0.03);
    expect(
      footPlantOffset({
        ...base,
        desiredLiftM: 0.01,
        currentAnkleY: 0.11,
      }),
    ).toBeCloseTo(0);
  });

  it("does not double-count a correction that is already applied", () => {
    expect(
      footPlantOffset({
        currentAnkleY: 0.1,
        restAnkleY: 0.1,
        desiredLiftM: 0,
        currentOffsetM: -0.04,
        maxCorrectionM: 0.2,
      }),
    ).toBeCloseTo(-0.04);
  });

  it("clamps to the configured correction budget and rejects invalid input", () => {
    expect(
      footPlantOffset({
        currentAnkleY: 0.4,
        restAnkleY: 0.1,
        desiredLiftM: 0,
        currentOffsetM: 0,
        maxCorrectionM: 0.05,
      }),
    ).toBe(-0.05);
    expect(
      footPlantOffset({
        currentAnkleY: Number.NaN,
        restAnkleY: 0.1,
        desiredLiftM: 0,
        currentOffsetM: 0.02,
        maxCorrectionM: 0.05,
      }),
    ).toBe(0.02);
  });
});
