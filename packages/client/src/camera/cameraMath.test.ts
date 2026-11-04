// packages/client/src/camera/cameraMath.test.ts

import { describe, expect, it } from "vitest";
import {
  cameraSideSign,
  deadZonePoint,
  lerpPose,
  softClamp,
  springStep,
} from "./cameraMath";

describe("camera springs", () => {
  it("reaches the same pose at 60 Hz and 144 Hz", () => {
    const target = 10;
    let at60 = { value: 0, velocity: 0 };
    let at144 = { value: 0, velocity: 0 };
    for (let frame = 0; frame < 60; frame += 1) {
      at60 = springStep(at60, target, 0.5, 1 / 60);
    }
    for (let frame = 0; frame < 144; frame += 1) {
      at144 = springStep(at144, target, 0.5, 1 / 144);
    }
    expect(Math.abs(at60.value - at144.value)).toBeLessThan(0.001);
    expect(Math.abs(at60.velocity - at144.velocity)).toBeLessThan(0.001);
    expect(at60.value).toBeLessThanOrEqual(target);
  });

  it("is a no-op for a zero-length frame", () => {
    const state = { value: 3, velocity: 4 };
    expect(springStep(state, 10, 0.5, 0)).toEqual(state);
  });
});

describe("camera target utilities", () => {
  it("does not move a trailing anchor inside the dead zone", () => {
    const anchor = { x: 10, z: 10 };
    expect(deadZonePoint({ x: 11, z: 10 }, anchor, 1.5)).toBe(anchor);
    expect(deadZonePoint({ x: 10.2, z: 10.3 }, anchor, 1.5)).toBe(anchor);
  });

  it("leaves a constant dead-zone gap when the ball leaves the zone", () => {
    const anchor = { x: 0, z: 0 };
    const next = deadZonePoint({ x: 4, z: 0 }, anchor, 1.5);
    expect(next.x).toBeCloseTo(2.5, 5);
    expect(next.z).toBe(0);
  });

  it("soft-clamps inside the limits without hard corners", () => {
    const values = [-20, 0, 5, 10, 20];
    const clamped = values.map((value) => softClamp(value, 5, 20, 2));
    expect(clamped[0]).toBeGreaterThanOrEqual(5);
    expect(clamped.at(-1)).toBeLessThanOrEqual(20);
    for (let index = 1; index < clamped.length; index += 1) {
      expect(clamped[index]!).toBeGreaterThanOrEqual(clamped[index - 1]!);
    }
  });

  it("orients the home and away clients toward opposite touchlines", () => {
    expect(cameraSideSign("home", 1)).toBe(1);
    expect(cameraSideSign("away", 1)).toBe(-1);
    expect(cameraSideSign("home", 2)).toBe(-1);
    expect(cameraSideSign("away", 2)).toBe(1);
  });

  it("eases between camera poses at both endpoints", () => {
    const from = {
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      fovDegrees: 30,
    };
    const to = {
      position: { x: 10, y: 20, z: 30 },
      target: { x: 4, y: 5, z: 6 },
      fovDegrees: 50,
    };
    expect(lerpPose(from, to, 0)).toEqual(from);
    expect(lerpPose(from, to, 1)).toEqual(to);
  });
});
