// packages/client/src/render/character-animation.test.ts

import { describe, expect, it } from "vitest";
import { computeCharacterPose } from "./character-animation";

describe("authored character animation", () => {
  it("lowers the A-pose arms for idle and keeps the gait counter-swing", () => {
    const idle = computeCharacterPose("idle", 0, 1);
    expect(idle.rotations.upperarm_l?.z).toBeLessThan(-0.4);
    expect(idle.rotations.upperarm_r?.z).toBeGreaterThan(0.4);

    const sprint = computeCharacterPose("sprint", Math.PI / 2, 1);
    expect(sprint.rotations.thigh_l?.x).toBeGreaterThan(0.7);
    expect(sprint.rotations.thigh_r?.x).toBeLessThan(-0.7);
    expect(sprint.rotations.upperarm_l?.x).toBeLessThan(0);
    expect(sprint.rotations.upperarm_r?.x).toBeGreaterThan(0);
  });

  it("drives the right leg through a shot and lifts the header", () => {
    const shot = computeCharacterPose("shoot", 1, 1, 0.22);
    expect(shot.rotations.thigh_r?.x).toBeGreaterThan(0.7);
    expect(shot.rotations.calf_r?.x).toBeGreaterThan(-0.3);

    const header = computeCharacterPose("header", 1, 1, 0.16);
    expect(header.rootLift).toBeGreaterThan(0.1);
    expect(header.rotations.upperarm_l?.z).toBeLessThan(-1);
    expect(header.rotations.upperarm_r?.z).toBeGreaterThan(1);
  });

  it("turns a dive into a body tilt and a fall into the ground pose", () => {
    const dive = computeCharacterPose("diveLeft", 1, 1, 0.16);
    expect(dive.rootLift).toBeGreaterThan(0.2);
    expect(dive.bodyTilt).toBeGreaterThan(0.8);

    const fall = computeCharacterPose("fall", 1, 1);
    expect(fall.bodyTilt).toBeGreaterThan(1);
    expect(fall.rootLift).toBeGreaterThan(0);
  });
});
