// packages/client/src/render/ball-effects.test.ts

import { describe, expect, it } from "vitest";
import { createPitch } from "@fb/sim";
import { predictLandingPoint } from "./ball-effects";
import type { RenderBall } from "./view";

const pitch = createPitch();
const gravity = 9.81;

function ball(overrides: Partial<RenderBall> = {}): RenderBall {
  return {
    x: pitch.centreX,
    y: pitch.centreY,
    z: 2,
    vx: 0,
    vy: 0,
    vz: 0,
    spinZ: 0,
    ...overrides,
  };
}

describe("ball landing prediction", () => {
  it("projects a dropping ball onto the pitch", () => {
    const landing = predictLandingPoint(ball(), pitch, gravity, 1.2);
    expect(landing).not.toBeNull();
    expect(landing?.x).toBeCloseTo(pitch.centreX, 5);
    expect(landing?.y).toBeCloseTo(pitch.centreY, 5);
  });

  it("includes horizontal travel while the ball is in the air", () => {
    const landing = predictLandingPoint(
      ball({ vx: 10, vz: 0 }),
      pitch,
      gravity,
      1.2,
    );
    expect(landing?.x).toBeGreaterThan(pitch.centreX + 4);
    expect(landing?.y).toBeCloseTo(pitch.centreY, 5);
  });

  it("hides low balls and predictions outside the pitch", () => {
    expect(
      predictLandingPoint(ball({ z: 0.5 }), pitch, gravity, 1.2),
    ).toBeNull();
    expect(
      predictLandingPoint(
        ball({ x: 1, vx: -20, z: 4 }),
        pitch,
        gravity,
        1.2,
      ),
    ).toBeNull();
  });
});
