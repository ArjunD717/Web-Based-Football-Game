// packages/client/src/render/three-layout.test.ts

import { describe, expect, it } from "vitest";
import { createPitch } from "@fb/sim";
import {
  computeCameraPose,
  facingToRotationY,
  pitchToWorld,
} from "./three-layout";

const pitch = createPitch();

describe("three layout", () => {
  it("maps pitch metres into a centred ground plane", () => {
    expect(pitchToWorld(pitch, 0, 0)).toEqual({
      x: -pitch.lengthM / 2,
      y: 0,
      z: -pitch.widthM / 2,
    });
    expect(pitchToWorld(pitch, pitch.lengthM, pitch.widthM)).toEqual({
      x: pitch.lengthM / 2,
      y: 0,
      z: pitch.widthM / 2,
    });
    expect(pitchToWorld(pitch, 10, 20, 1.5)).toEqual({
      x: 10 - pitch.lengthM / 2,
      y: 1.5,
      z: 20 - pitch.widthM / 2,
    });
  });

  it("maps heading to the opposite Three.js yaw", () => {
    expect(Math.abs(facingToRotationY(0))).toBe(0);
    expect(facingToRotationY(Math.PI / 2)).toBe(-Math.PI / 2);
    expect(facingToRotationY(Math.PI)).toBe(-Math.PI);
  });

  it("fits the full pitch and backs away for portrait screens", () => {
    const landscape = computeCameraPose(pitch, 16 / 9);
    const square = computeCameraPose(pitch, 1);
    const portrait = computeCameraPose(pitch, 0.6);
    expect(landscape.position.y).toBeGreaterThan(0);
    expect(landscape.position.z).toBeGreaterThan(0);
    expect(square.position.z).toBeGreaterThan(landscape.position.z);
    expect(portrait.position.z).toBeGreaterThan(square.position.z);
    expect(landscape.target).toEqual({ x: 0, y: 0, z: 0 });
    expect(landscape.fovDegrees).toBe(42);
  });

  it("clamps invalid aspect ratios instead of producing an unusable camera", () => {
    const pose = computeCameraPose(pitch, 0);
    expect(Number.isFinite(pose.position.y)).toBe(true);
    expect(Number.isFinite(pose.position.z)).toBe(true);
    expect(pose.position.z).toBeGreaterThan(0);
  });
});
