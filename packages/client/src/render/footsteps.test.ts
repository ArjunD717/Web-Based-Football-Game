// packages/client/src/render/footsteps.test.ts

import { describe, expect, it } from "vitest";
import type { GaitTuning } from "./gait";
import {
  footstepIntensity,
  isSteppingState,
  shouldEmitFootstep,
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
  minIntervalSeconds: 0.14,
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

  it("gates contact noise by state, speed and interval", () => {
    expect(shouldEmitFootstep("jog", 4, 2, 1, gate)).toBe(true);
    expect(shouldEmitFootstep("idle", 4, 2, 1, gate)).toBe(false);
    expect(shouldEmitFootstep("pass", 4, 2, 1, gate)).toBe(false);
    expect(shouldEmitFootstep("jog", 0.5, 2, 1, gate)).toBe(false);
    expect(shouldEmitFootstep("jog", 4, 1.1, 1, gate)).toBe(false);
    expect(shouldEmitFootstep("jog", 4, 1.15, 1, gate)).toBe(true);
    expect(
      shouldEmitFootstep("jog", 4, Number.NaN, Number.NaN, gate),
    ).toBe(true);
  });
});
