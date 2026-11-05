// packages/client/src/render/footsteps.test.ts

import { describe, expect, it } from "vitest";
import type { GaitTuning } from "./gait";
import {
  createFootstepClock,
  footstepIntensity,
  isSteppingState,
  resetFootstepClock,
  updateFootstepClock,
  type FootstepTuning,
} from "./footsteps";

const gait: GaitTuning = {
  referenceSpeedMps: { jog: 4, sprint: 8, dribble: 3 },
  minPlaybackScale: 0.55,
  maxPlaybackScale: 1.45,
  speedSmoothingRate: 9,
  speedCapMps: 13,
};

const gate: FootstepTuning = {
  minSpeedMps: 1.1,
  minIntervalSeconds: 0.26,
};

describe("authored footstep contacts", () => {
  it("classifies the stepping states", () => {
    expect(isSteppingState("jog")).toBe(true);
    expect(isSteppingState("sprint")).toBe(true);
    expect(isSteppingState("dribble")).toBe(true);
    expect(isSteppingState("idle")).toBe(false);
    expect(isSteppingState("pass")).toBe(false);
  });

  it("derives loudness from the measured reference speed", () => {
    expect(footstepIntensity("jog", 4, gait)).toBe(1);
    expect(footstepIntensity("sprint", 8, gait)).toBe(1);
    expect(footstepIntensity("jog", 2, gait)).toBe(0.5);
    expect(footstepIntensity("jog", 0.1, gait)).toBe(0.3);
    expect(footstepIntensity("jog", 40, gait)).toBe(1);
    expect(footstepIntensity("pass", 8, gait)).toBe(0.5);
  });

  it("advances one step per half stride, alternating sides", () => {
    const clock = createFootstepClock();
    expect(
      updateFootstepClock(clock, "jog", 0, 4, 0.1, -1, gate, gait),
    ).toBeNull();
    const first = updateFootstepClock(
      clock,
      "jog",
      Math.PI + 0.01,
      4,
      0.4,
      0.1,
      gate,
      gait,
    );
    expect(first?.side).toBe("right");
    const second = updateFootstepClock(
      clock,
      "jog",
      2 * Math.PI + 0.02,
      4,
      0.7,
      0.4,
      gate,
      gait,
    );
    expect(second?.side).toBe("left");
  });

  it("resets on non-stepping states and debounces fast crossings", () => {
    const clock = createFootstepClock();
    updateFootstepClock(clock, "jog", 0, 4, 0, -1, gate, gait);
    expect(
      updateFootstepClock(clock, "jog", 3.2, 4, 0.1, 0.1, gate, gait),
    ).toBeNull();
    expect(clock.lastStepIndex).toBe(1);
    expect(
      updateFootstepClock(clock, "jog", 6.3, 4, 0.2, 0.1, gate, gait),
    ).toBeNull();
    expect(
      updateFootstepClock(clock, "pass", 9.5, 4, 0.3, 0.1, gate, gait),
    ).toBeNull();
    expect(clock.lastStepIndex).toBeNull();
    resetFootstepClock(clock);
    expect(clock.lastStepIndex).toBeNull();
  });

  it("does not step below the speed threshold", () => {
    const clock = createFootstepClock();
    updateFootstepClock(clock, "jog", 0, 4, 0, -1, gate, gait);
    expect(
      updateFootstepClock(clock, "jog", Math.PI + 0.01, 0.5, 1, 0, gate, gait),
    ).toBeNull();
  });
});
