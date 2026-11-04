// packages/client/src/render/three-player.test.ts

import { describe, expect, it } from "vitest";
import { blendPlayerPoses, computePlayerPose } from "./three-player";

describe("player animation pose", () => {
  it("moves the legs and arms faster in a sprint than a jog", () => {
    const jog = computePlayerPose("jog", Math.PI / 2, 1);
    const sprint = computePlayerPose("sprint", Math.PI / 2, 1);
    const idle = computePlayerPose("idle", Math.PI / 2, 1);
    expect(Math.abs(jog.leftLeg)).toBeGreaterThan(Math.abs(idle.leftLeg));
    expect(Math.abs(sprint.leftLeg)).toBeGreaterThan(Math.abs(jog.leftLeg));
    expect(Math.abs(sprint.leftArm)).toBeGreaterThan(Math.abs(jog.leftArm));
    expect(Math.abs(sprint.leftKnee)).toBeGreaterThan(
      Math.abs(jog.leftKnee),
    );
    expect(sprint.leftElbow).toBeGreaterThan(jog.leftElbow);
  });

  it("drives a kick from backswing through contact", () => {
    const backswing = computePlayerPose("shoot", 1, 1, 0.02);
    const contact = computePlayerPose("shoot", 1, 1, 0.24);
    expect(backswing.rightLeg).toBeLessThan(0);
    expect(contact.rightLeg).toBeGreaterThan(backswing.rightLeg + 0.8);
    expect(contact.rightKnee).toBeGreaterThan(backswing.rightKnee);
  });

  it("uses a kicking pose for shots and a grounded pose for injuries", () => {
    const shot = computePlayerPose("shoot", 1, 1, 0.22);
    expect(shot.rightLeg).toBeGreaterThan(0.8);
    const injury = computePlayerPose("injured", 1, 1);
    expect(injury.bodyTilt).toBeGreaterThan(1);
    expect(injury.bodyY).toBeGreaterThan(0);
  });

  it("lifts a header through its jump cycle", () => {
    const rise = computePlayerPose("header", 1, 1, 0.16);
    const land = computePlayerPose("header", 1, 1, 0.34);
    expect(rise.bodyY).toBeGreaterThan(land.bodyY);
    expect(rise.headPitch).toBeLessThan(land.headPitch);
  });

  it("raises the arms to celebrate and lowers stamina-dependent effort", () => {
    const celebrate = computePlayerPose("celebrate", Math.PI / 4, 1);
    expect(Math.abs(celebrate.leftArm)).toBeGreaterThan(2);
    const tired = computePlayerPose("sprint", Math.PI / 2, 0);
    const fresh = computePlayerPose("sprint", Math.PI / 2, 1);
    expect(Math.abs(fresh.leftLeg)).toBeGreaterThan(Math.abs(tired.leftLeg));
  });

  it("blends every joint between two poses", () => {
    const idle = computePlayerPose("idle", 0, 1);
    const sprint = computePlayerPose("sprint", Math.PI / 2, 1);
    const middle = blendPlayerPoses(idle, sprint, 0.5);
    expect(middle.leftLeg).toBeCloseTo(
      (idle.leftLeg + sprint.leftLeg) / 2,
      6,
    );
    expect(middle.leftKnee).toBeCloseTo(
      (idle.leftKnee + sprint.leftKnee) / 2,
      6,
    );
    expect(middle.leftElbow).toBeCloseTo(
      (idle.leftElbow + sprint.leftElbow) / 2,
      6,
    );
    expect(middle.bodyTwist).toBeCloseTo(
      (idle.bodyTwist + sprint.bodyTwist) / 2,
      6,
    );
    expect(blendPlayerPoses(idle, sprint, -1).bodyLean).toBe(idle.bodyLean);
    expect(blendPlayerPoses(idle, sprint, 2).bodyLean).toBe(sprint.bodyLean);
  });
});
