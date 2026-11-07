// packages/client/src/render/player-geometry.test.ts

import { describe, expect, it } from "vitest";
import {
  dissolveSourceVisible,
  dissolveTargetVisible,
  geometryFadeBudgetAvailable,
  geometryFadeProgress,
  geometryForDetail,
  nextGeometryRequest,
  type PlayerGeometryRequest,
} from "./player-geometry";

describe("player geometry LOD", () => {
  it("keeps high geometry for visible detail levels", () => {
    expect(geometryForDetail("full")).toBe("high");
    expect(geometryForDetail("reduced")).toBe("high");
  });

  it("switches only minimal detail to the low template", () => {
    expect(geometryForDetail("minimal")).toBe("low");
  });
});

describe("player geometry hysteresis", () => {
  it("starts on high and commits a stable low request", () => {
    let state: PlayerGeometryRequest | undefined;
    for (let frame = 0; frame < 3; frame += 1) {
      state = nextGeometryRequest(state, "low", 3);
    }
    expect(state?.committed).toBe("low");
    expect(state?.desired).toBe("low");
  });

  it("restarts the count when the desired geometry flips", () => {
    let state: PlayerGeometryRequest | undefined;
    state = nextGeometryRequest(state, "low", 3);
    state = nextGeometryRequest(state, "low", 3);
    state = nextGeometryRequest(state, "high", 3);
    expect(state?.frames).toBe(1);
    expect(state?.committed).toBe("high");
    state = nextGeometryRequest(state, "high", 3);
    state = nextGeometryRequest(state, "high", 3);
    expect(state?.committed).toBe("high");
  });

  it("does not switch before the hysteresis threshold", () => {
    let state: PlayerGeometryRequest | undefined;
    state = nextGeometryRequest(state, "low", 5);
    state = nextGeometryRequest(state, "low", 5);
    expect(state?.committed).toBe("high");
    state = nextGeometryRequest(state, "low", 5);
    expect(state?.committed).toBe("high");
    state = nextGeometryRequest(state, "low", 5);
    state = nextGeometryRequest(state, "low", 5);
    expect(state?.committed).toBe("low");
  });
});


describe("player geometry fade", () => {
  it("clamps linear progress to the transition", () => {
    expect(geometryFadeProgress(0, 0.2)).toBe(0);
    expect(geometryFadeProgress(0.1, 0.2)).toBe(0.5);
    expect(geometryFadeProgress(0.2, 0.2)).toBe(1);
    expect(geometryFadeProgress(0.5, 0.2)).toBe(1);
  });

  it("resolves an invalid duration immediately", () => {
    expect(geometryFadeProgress(0, 0)).toBe(1);
    expect(geometryFadeProgress(0, Number.NaN)).toBe(1);
    expect(geometryFadeProgress(Number.NaN, 0.2)).toBe(0);
  });
});

describe("player geometry dissolve", () => {
  it("partitions every pixel exactly once between outgoing and incoming", () => {
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      for (const threshold of [0, 0.1, 0.5, 0.9, 0.999]) {
        const source = dissolveSourceVisible(threshold, progress);
        const target = dissolveTargetVisible(threshold, progress);
        expect(source).not.toBe(target);
      }
    }
  });

  it("starts fully on the source and ends fully on the target", () => {
    for (const threshold of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(dissolveSourceVisible(threshold, 0)).toBe(true);
      expect(dissolveTargetVisible(threshold, 0)).toBe(false);
      expect(dissolveSourceVisible(threshold, 1)).toBe(false);
      expect(dissolveTargetVisible(threshold, 1)).toBe(true);
    }
  });

  it("clamps dissolve progress before choosing a side", () => {
    expect(dissolveSourceVisible(0.1, -1)).toBe(true);
    expect(dissolveTargetVisible(0.1, 2)).toBe(true);
  });
});

describe("player geometry dissolve budget", () => {
  it("admits transitions below the cap", () => {
    expect(geometryFadeBudgetAvailable(0, 1)).toBe(true);
    expect(geometryFadeBudgetAvailable(4, 6)).toBe(true);
  });

  it("rejects transitions at or above the cap", () => {
    expect(geometryFadeBudgetAvailable(6, 6)).toBe(false);
    expect(geometryFadeBudgetAvailable(7, 6)).toBe(false);
  });

  it("treats invalid caps and negative counts defensively", () => {
    expect(geometryFadeBudgetAvailable(0, Number.NaN)).toBe(true);
    expect(geometryFadeBudgetAvailable(1, Number.NaN)).toBe(false);
    expect(geometryFadeBudgetAvailable(-2, 2)).toBe(true);
  });
});
