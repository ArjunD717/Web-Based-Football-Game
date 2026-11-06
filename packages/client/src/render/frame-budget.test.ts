// packages/client/src/render/frame-budget.test.ts

import { describe, expect, it } from "vitest";
import {
  INITIAL_FRAME_BUDGET_STATE,
  meetsFrameBudget,
  updateFrameBudget,
  type FrameBudgetState,
  type FrameBudgetTuning,
} from "./frame-budget";

const tuning: FrameBudgetTuning = {
  targetFrameMs: 16.67,
  slowFrameRatio: 1.2,
  recoverFrameRatio: 0.9,
  slowStreak: 3,
  recoverStreak: 4,
  pressureShadowCasters: 2,
};

function feed(
  state: FrameBudgetState,
  frameMs: number,
  count: number,
): FrameBudgetState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = updateFrameBudget(next, frameMs, tuning);
  }
  return next;
}

describe("frame budget controller", () => {
  it("enters pressure only after a sustained slow streak", () => {
    const twoSlow = feed(
      INITIAL_FRAME_BUDGET_STATE,
      tuning.targetFrameMs * 1.3,
      2,
    );
    expect(twoSlow.pressured).toBe(false);
    const threeSlow = feed(twoSlow, tuning.targetFrameMs * 1.3, 1);
    expect(threeSlow.pressured).toBe(true);
  });

  it("recovers only after a sustained fast streak", () => {
    const pressured = feed(
      INITIAL_FRAME_BUDGET_STATE,
      tuning.targetFrameMs * 1.3,
      3,
    );
    const almost = feed(pressured, tuning.targetFrameMs * 0.8, 3);
    expect(almost.pressured).toBe(true);
    const recovered = feed(almost, tuning.targetFrameMs * 0.8, 1);
    expect(recovered.pressured).toBe(false);
    expect(recovered.slowStreak).toBe(0);
    expect(recovered.recoverStreak).toBe(0);
  });

  it("resets streaks for frames inside the hysteresis band", () => {
    const slow = feed(
      INITIAL_FRAME_BUDGET_STATE,
      tuning.targetFrameMs * 1.3,
      2,
    );
    const neutral = updateFrameBudget(
      slow,
      tuning.targetFrameMs,
      tuning,
    );
    expect(neutral.slowStreak).toBe(0);
    expect(neutral.recoverStreak).toBe(0);
    expect(neutral.pressured).toBe(false);
  });

  it("ignores invalid and suspended-tab intervals", () => {
    const slow = feed(
      INITIAL_FRAME_BUDGET_STATE,
      tuning.targetFrameMs * 1.3,
      2,
    );
    expect(updateFrameBudget(slow, Number.NaN, tuning)).toBe(slow);
    expect(updateFrameBudget(slow, 0, tuning)).toBe(slow);
    expect(updateFrameBudget(slow, 251, tuning)).toBe(slow);
  });

  it("does not enter pressure while frames stay at target", () => {
    const state = feed(INITIAL_FRAME_BUDGET_STATE, tuning.targetFrameMs, 20);
    expect(state.pressured).toBe(false);
  });

  it("gates the benchmark's render p95 against the same target", () => {
    expect(meetsFrameBudget(16.67, tuning)).toBe(true);
    expect(meetsFrameBudget(16.68, tuning)).toBe(false);
    expect(meetsFrameBudget(Number.NaN, tuning)).toBe(false);
  });
});
