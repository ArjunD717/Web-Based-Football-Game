// packages/client/src/render/player-geometry.test.ts

import { describe, expect, it } from "vitest";
import {
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
