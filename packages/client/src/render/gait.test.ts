// packages/client/src/render/gait.test.ts

import { describe, expect, it } from "vitest";
import {
  gaitPlaybackScale,
  isLocomotionState,
  updateGaitSpeed,
  type GaitTuning,
} from "./gait";

const tuning: GaitTuning = {
  referenceSpeedMps: { jog: 4, sprint: 8, dribble: 3 },
  minPlaybackScale: 0.5,
  maxPlaybackScale: 1.5,
  speedSmoothingRate: 10,
  speedCapMps: 12,
};

describe("speed-matched gait", () => {
  it("maps each reference speed to its authored playback rate", () => {
    expect(gaitPlaybackScale("jog", 4, tuning)).toBe(1);
    expect(gaitPlaybackScale("sprint", 8, tuning)).toBe(1);
    expect(gaitPlaybackScale("dribble", 3, tuning)).toBe(1);
  });

  it("slows down for slow movement and clamps at the limits", () => {
    expect(gaitPlaybackScale("jog", 2, tuning)).toBe(0.5);
    expect(gaitPlaybackScale("jog", 0, tuning)).toBe(0.5);
    expect(gaitPlaybackScale("sprint", 20, tuning)).toBe(1.5);
    expect(gaitPlaybackScale("jog", Number.NaN, tuning)).toBe(0.5);
  });

  it("keeps idle and non-locomotion states at their authored timing", () => {
    expect(isLocomotionState("idle")).toBe(true);
    expect(isLocomotionState("pass")).toBe(false);
    expect(gaitPlaybackScale("idle", 8, tuning)).toBe(1);
    expect(gaitPlaybackScale("pass", 8, tuning)).toBe(1);
    expect(gaitPlaybackScale("shoot", 8, tuning)).toBe(1);
  });

  it("smooths speed and rejects impossible samples", () => {
    const first = updateGaitSpeed(0, 0.0667, 1 / 60, tuning);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(4);
    const second = updateGaitSpeed(first, 0.0667, 1 / 60, tuning);
    expect(second).toBeGreaterThan(first);
    expect(updateGaitSpeed(4, 0.0667, 0, tuning)).toBe(4);
    expect(updateGaitSpeed(4, Number.NaN, 1 / 60, tuning)).toBe(4);
    expect(updateGaitSpeed(Number.NaN, 1, 1 / 60, tuning)).toBe(0);
  });

  it("caps the measured speed from a teleport-sized frame", () => {
    const speed = updateGaitSpeed(0, 100, 0.1, tuning);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(12);
  });
});
