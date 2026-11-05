// packages/client/src/render/footstep-spatial.test.ts

import { describe, expect, it } from "vitest";
import { spatializeFootstep, type FootstepSpatialInput } from "./footsteps";

const base: FootstepSpatialInput = {
  x: 0,
  z: 0,
  listenerX: 0,
  listenerZ: 0,
  rightX: 1,
  rightZ: 0,
  referenceDistanceM: 4,
  maxDistanceM: 40,
  panStrength: 0.7,
};

describe("footstep spatial mix", () => {
  it("plays near sounds at full gain with a hard side pan", () => {
    const mix = spatializeFootstep({ ...base, x: 2 });
    expect(mix.pan).toBeCloseTo(0.7);
    expect(mix.gain).toBe(1);
  });

  it("pans right and left relative to the listener", () => {
    const right = spatializeFootstep({ ...base, x: 20 });
    expect(right.pan).toBeGreaterThan(0);
    expect(right.pan).toBeLessThanOrEqual(0.7);
    expect(spatializeFootstep({ ...base, x: -20 }).pan).toBeLessThan(0);
    expect(spatializeFootstep({ ...base, rightX: -1, x: 20 }).pan).toBeLessThan(
      0,
    );
  });

  it("attenuates linearly to silence at the maximum distance", () => {
    expect(spatializeFootstep({ ...base, x: 22 }).gain).toBeCloseTo(0.5);
    expect(spatializeFootstep({ ...base, x: 40 }).gain).toBe(0);
    expect(spatializeFootstep({ ...base, x: 60 }).gain).toBe(0);
  });

  it("rejects invalid listener or event data", () => {
    expect(spatializeFootstep({ ...base, x: Number.NaN })).toEqual({
      pan: 0,
      gain: 0,
    });
    expect(
      spatializeFootstep({ ...base, listenerX: Number.POSITIVE_INFINITY }),
    ).toEqual({ pan: 0, gain: 0 });
  });
});
