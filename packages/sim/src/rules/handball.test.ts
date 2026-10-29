// packages/sim/src/rules/handball.test.ts
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  assessHandball,
  handballContextFromContact,
  type HandballContext,
} from "./handball";

const neutral: HandballContext = {
  isGoalkeeper: false,
  inOwnPenaltyArea: false,
  contactOnArm: true,
  armMakesBodyBigger: false,
  armAboveShoulder: false,
  deliberate: false,
  attackerBeforeGoal: false,
};

describe("handball law", () => {
  it("ignores contact with the head or torso", () => {
    expect(
      assessHandball({ ...neutral, contactOnArm: false, deliberate: true }),
    ).toBe("none");
  });

  it("lets the goalkeeper handle inside their own area", () => {
    expect(
      assessHandball({
        ...neutral,
        isGoalkeeper: true,
        inOwnPenaltyArea: true,
        deliberate: true,
        armMakesBodyBigger: true,
      }),
    ).toBe("none");
  });

  it("punishes a deliberate handball by an outfielder with a penalty", () => {
    expect(
      assessHandball({
        ...neutral,
        inOwnPenaltyArea: true,
        deliberate: true,
      }),
    ).toBe("penalty");
  });

  it("punishes an arm that makes the body unnaturally bigger", () => {
    expect(
      assessHandball({
        ...neutral,
        inOwnPenaltyArea: true,
        armMakesBodyBigger: true,
      }),
    ).toBe("penalty");
  });

  it("punishes a hand above the shoulder outside the area", () => {
    expect(
      assessHandball({
        ...neutral,
        armAboveShoulder: true,
      }),
    ).toBe("directFreeKick");
  });

  it("awards a free kick for an attacker who handles before a goal", () => {
    expect(
      assessHandball({
        ...neutral,
        attackerBeforeGoal: true,
      }),
    ).toBe("directFreeKick");
  });

  it("does not punish an accidental arm contact that is not bigger", () => {
    expect(assessHandball(neutral)).toBe("none");
  });

  it("punishes deliberate outfield handling outside the area", () => {
    // Law 12 gives no general outfield handling permission: deliberate contact
    // outside the area is still a direct free kick.
    expect(
      assessHandball({
        ...neutral,
        isGoalkeeper: false,
        inOwnPenaltyArea: false,
        deliberate: true,
      }),
    ).toBe("directFreeKick");
  });
});

describe("handball contact conversion", () => {
  const state = createMatch({ seed: 31 });
  const gk = state.home.players.find((player) => player.role === "GK")!;
  const outfield = state.home.players.find((player) => player.role === "CB")!;

  it("recognises the goalkeeper and their own area", () => {
    const context = handballContextFromContact({
      player: gk,
      ballHeightM: 1,
      relativeSpeedMps: 6,
      inOwnPenaltyArea: true,
      deliberateRoll: 0,
      attackerBeforeGoal: false,
    });
    expect(context.isGoalkeeper).toBe(true);
    expect(assessHandball(context)).toBe("none");
  });

  it("treats high fast arm contact as making the body bigger", () => {
    const context = handballContextFromContact({
      player: outfield,
      ballHeightM: 1.4,
      relativeSpeedMps: 6,
      inOwnPenaltyArea: true,
      deliberateRoll: 0.9,
      attackerBeforeGoal: false,
    });
    expect(context.contactOnArm).toBe(true);
    expect(context.armMakesBodyBigger).toBe(true);
    expect(assessHandball(context)).toBe("penalty");
  });

  it("ignores contact below the hand/arm height band", () => {
    const context = handballContextFromContact({
      player: outfield,
      ballHeightM: 0.2,
      relativeSpeedMps: 10,
      inOwnPenaltyArea: false,
      deliberateRoll: 0,
      attackerBeforeGoal: true,
    });
    expect(context.contactOnArm).toBe(false);
    expect(assessHandball(context)).toBe("none");
  });

  it("uses the deterministic roll for deliberate contact", () => {
    const deliberate = handballContextFromContact({
      player: outfield,
      ballHeightM: 1,
      relativeSpeedMps: 3,
      inOwnPenaltyArea: false,
      deliberateRoll: 0.1,
      attackerBeforeGoal: false,
    });
    const accidental = handballContextFromContact({
      player: outfield,
      ballHeightM: 1,
      relativeSpeedMps: 3,
      inOwnPenaltyArea: false,
      deliberateRoll: 0.9,
      attackerBeforeGoal: false,
    });
    expect(deliberate.deliberate).toBe(true);
    expect(accidental.deliberate).toBe(false);
    expect(assessHandball(deliberate)).toBe("directFreeKick");
    expect(assessHandball(accidental)).toBe("none");
  });
});
