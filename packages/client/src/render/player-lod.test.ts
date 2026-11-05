// packages/client/src/render/player-lod.test.ts

import { describe, expect, it } from "vitest";
import {
  playerDetailFor,
  shadowCasterIds,
  type PlayerDistanceEntry,
  type PlayerLodTuning,
} from "./player-lod";

const tuning: PlayerLodTuning = {
  fullDetailDistanceM: 20,
  reducedDetailDistanceM: 48,
  shadowDistanceM: 30,
  maxShadowCasters: 2,
};

describe("player distance LOD", () => {
  it("drops overlay detail at the configured thresholds", () => {
    expect(playerDetailFor(0, tuning)).toBe("full");
    expect(playerDetailFor(20, tuning)).toBe("full");
    expect(playerDetailFor(20.1, tuning)).toBe("reduced");
    expect(playerDetailFor(48, tuning)).toBe("reduced");
    expect(playerDetailFor(48.1, tuning)).toBe("minimal");
    expect(playerDetailFor(Number.NaN, tuning)).toBe("minimal");
  });

  it("selects only the nearest shadow casters inside the radius", () => {
    const players: PlayerDistanceEntry[] = [
      { id: "far", distanceM: 45 },
      { id: "near", distanceM: 8 },
      { id: "middle", distanceM: 18 },
      { id: "edge", distanceM: 30 },
    ];
    expect([...shadowCasterIds(players, tuning)]).toEqual(["near", "middle"]);
  });

  it("returns no shadows when the budget is zero", () => {
    expect(
      shadowCasterIds([{ id: "near", distanceM: 1 }], {
        ...tuning,
        maxShadowCasters: 0,
      }).size,
    ).toBe(0);
  });

  it("ignores invalid distances and handles empty input", () => {
    expect(
      shadowCasterIds(
        [
          { id: "bad", distanceM: Number.NaN },
          { id: "inf", distanceM: Number.POSITIVE_INFINITY },
        ],
        tuning,
      ).size,
    ).toBe(0);
    expect(shadowCasterIds([], tuning).size).toBe(0);
  });
});
