// packages/client/src/render/player-lod.test.ts

import { describe, expect, it } from "vitest";
import {
  animationStrideFor,
  playerDetailForScreenHeight,
  projectedHeightPx,
  shadowCasterIds,
  shouldAnimateAtTick,
  type PlayerLodEntry,
  type PlayerLodTuning,
} from "./player-lod";

const tuning: PlayerLodTuning = {
  referenceHeightM: 1.8,
  fullDetailScreenPx: 42,
  reducedDetailScreenPx: 14,
  shadowMinScreenPx: 8,
  shadowDistanceM: 80,
  maxShadowCasters: 2,
  animation: {
    fullStride: 1,
    reducedStride: 2,
    minimalStride: 4,
  },
};

describe("player screen-space LOD", () => {
  it("projects height with the pinhole camera model", () => {
    const height = projectedHeightPx(
      1.8,
      10,
      900,
      (50 * Math.PI) / 180,
    );
    expect(height).toBeCloseTo(173.705, 2);
    expect(
      projectedHeightPx(1.8, 20, 900, (50 * Math.PI) / 180),
    ).toBeCloseTo(height / 2, 5);
  });

  it("returns zero for invalid or empty projection inputs", () => {
    expect(projectedHeightPx(0, 10, 900, 0.87)).toBe(0);
    expect(projectedHeightPx(1.8, 0, 900, 0.87)).toBe(0);
    expect(projectedHeightPx(1.8, 10, 0, 0.87)).toBe(0);
    expect(projectedHeightPx(1.8, 10, 900, 0)).toBe(0);
    expect(projectedHeightPx(1.8, 10, 900, Math.PI)).toBe(0);
    expect(projectedHeightPx(Number.NaN, 10, 900, 0.87)).toBe(0);
  });

  it("drops overlay detail at the configured screen thresholds", () => {
    expect(playerDetailForScreenHeight(100, tuning)).toBe("full");
    expect(playerDetailForScreenHeight(42, tuning)).toBe("full");
    expect(playerDetailForScreenHeight(41.9, tuning)).toBe("reduced");
    expect(playerDetailForScreenHeight(14, tuning)).toBe("reduced");
    expect(playerDetailForScreenHeight(13.9, tuning)).toBe("minimal");
    expect(playerDetailForScreenHeight(0, tuning)).toBe("minimal");
    expect(playerDetailForScreenHeight(Number.NaN, tuning)).toBe("minimal");
  });

  it("selects only the nearest shadow casters inside both budgets", () => {
    const players: PlayerLodEntry[] = [
      { id: "far", distanceM: 45, screenHeightPx: 30 },
      { id: "near", distanceM: 8, screenHeightPx: 200 },
      { id: "middle", distanceM: 18, screenHeightPx: 30 },
      { id: "tiny", distanceM: 2, screenHeightPx: 2 },
      { id: "edge", distanceM: 80, screenHeightPx: 20 },
    ];
    expect([...shadowCasterIds(players, tuning)]).toEqual(["near", "middle"]);
  });

  it("returns no shadows when the budget is zero", () => {
    expect(
      shadowCasterIds(
        [{ id: "near", distanceM: 1, screenHeightPx: 200 }],
        { ...tuning, maxShadowCasters: 0 },
      ).size,
    ).toBe(0);
  });

  it("ignores invalid entries and handles empty input", () => {
    expect(
      shadowCasterIds(
        [
          { id: "bad", distanceM: Number.NaN, screenHeightPx: 200 },
          { id: "inf", distanceM: Number.POSITIVE_INFINITY, screenHeightPx: 200 },
          { id: "hidden", distanceM: 5, screenHeightPx: Number.NaN },
        ],
        tuning,
      ).size,
    ).toBe(0);
    expect(shadowCasterIds([], tuning).size).toBe(0);
  });
});

describe("player animation cadence", () => {
  it("maps detail levels to the configured frame stride", () => {
    expect(animationStrideFor("full", tuning.animation)).toBe(1);
    expect(animationStrideFor("reduced", tuning.animation)).toBe(2);
    expect(animationStrideFor("minimal", tuning.animation)).toBe(4);
  });

  it("clamps invalid strides to the safe every-frame fallback", () => {
    expect(
      animationStrideFor("minimal", {
        ...tuning.animation,
        minimalStride: 0,
      }),
    ).toBe(1);
    expect(
      animationStrideFor("minimal", {
        ...tuning.animation,
        minimalStride: Number.NaN,
      }),
    ).toBe(1);
  });

  it("updates on the player's phase and every stride", () => {
    expect(shouldAnimateAtTick(0, 4, 0)).toBe(true);
    expect(shouldAnimateAtTick(1, 4, 0)).toBe(false);
    expect(shouldAnimateAtTick(4, 4, 0)).toBe(true);
    expect(shouldAnimateAtTick(5, 4, 1)).toBe(true);
    expect(shouldAnimateAtTick(4, 1, 3)).toBe(true);
  });

  it("normalizes negative ticks and phases", () => {
    expect(shouldAnimateAtTick(-1, 4, 3)).toBe(true);
    expect(shouldAnimateAtTick(3, 4, -5)).toBe(true);
    expect(shouldAnimateAtTick(Number.NaN, 4, 0)).toBe(true);
  });
});
