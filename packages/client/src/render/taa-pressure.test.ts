// packages/client/src/render/taa-pressure.test.ts

import { describe, expect, it } from "vitest";
import {
  INITIAL_TAA_PRESSURE_STATE,
  updateTaaPressure,
} from "./taa-pressure";

describe("TAA frame-time pressure", () => {
  it("disables after a sustained streak above the render threshold", () => {
    let state = INITIAL_TAA_PRESSURE_STATE;
    let disabled = false;
    for (let frame = 0; frame < 3; frame += 1) {
      const update = updateTaaPressure(state, 18, 16.7, 3);
      state = update.state;
      disabled = update.disable;
    }
    expect(state.slowFrames).toBe(3);
    expect(disabled).toBe(true);
  });

  it("clears the streak after a fast frame", () => {
    const state = updateTaaPressure(
      INITIAL_TAA_PRESSURE_STATE,
      20,
      16.7,
      4,
    ).state;
    const fast = updateTaaPressure(state, 12, 16.7, 4);
    expect(fast.state.slowFrames).toBe(0);
    expect(fast.disable).toBe(false);
  });

  it("rejects invalid measurements and non-positive frame budgets safely", () => {
    expect(
      updateTaaPressure(INITIAL_TAA_PRESSURE_STATE, Number.NaN, 16.7, 3)
        .state.slowFrames,
    ).toBe(0);
    expect(
      updateTaaPressure(INITIAL_TAA_PRESSURE_STATE, 20, 16.7, 0).disable,
    ).toBe(true);
  });
});
