// packages/client/src/render/three-layout.test.ts

import { describe, expect, it } from "vitest";
import { createPitch } from "@fb/sim";
import { facingToRotationY, pitchToWorld } from "./three-layout";

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
});
