// packages/client/src/render/three-player.test.ts

import { describe, expect, it } from "vitest";
import { computePlayerPose } from "./three-player";

describe("player animation pose", () => {
  it("moves the legs and arms faster in a sprint than a jog", () => {
    const jog = computePlayerPose("jog", Math.PI / 2, 1);
    const sprint = computePlayerPose("sprint", Math.PI / 2, 1);
    const idle = computePlayerPose("idle", Math.PI / 2, 1);
    expect(Math.abs(jog.leftLeg)).toBeGreaterThan(Math.abs(idle.leftLeg));
    expect(Math.abs(sprint.leftLeg)).toBeGreaterThan(Math.abs(jog.leftLeg));
    expect(Math.abs(sprint.leftArm)).toBeGreaterThan(Math.abs(jog.leftArm));
  });

  it("uses a kicking pose for shots and a grounded pose for injuries", () => {
    const shot = computePlayerPose("shoot", 1, 1);
    expect(shot.rightLeg).toBeGreaterThan(0.8);
    const injury = computePlayerPose("injured", 1, 1);
    expect(injury.bodyTilt).toBeGreaterThan(1);
    expect(injury.bodyY).toBeGreaterThan(0);
  });

  it("raises the arms to celebrate and lowers stamina-dependent effort", () => {
    const celebrate = computePlayerPose("celebrate", Math.PI / 4, 1);
    expect(Math.abs(celebrate.leftArm)).toBeGreaterThan(2);
    const tired = computePlayerPose("sprint", Math.PI / 2, 0);
    const fresh = computePlayerPose("sprint", Math.PI / 2, 1);
    expect(Math.abs(fresh.leftLeg)).toBeGreaterThan(Math.abs(tired.leftLeg));
  });
});
