// packages/sim/src/pitch.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PITCH_CONFIG,
  createPitch,
  getAttackingGoal,
  getDefendingGoal,
  isInsideGoalArea,
  isInsidePenaltyArea,
  isInsidePitch,
  validatePitchConfig,
} from "./pitch";

describe("createPitch", () => {
  it("builds the full-size default pitch in metres", () => {
    const pitch = createPitch();
    expect(pitch.lengthM).toBe(105);
    expect(pitch.widthM).toBe(68);
    expect(pitch.centreX).toBe(52.5);
    expect(pitch.centreY).toBe(34);
    expect(pitch.homeGoal.lineX).toBe(0);
    expect(pitch.homeGoal.centreY).toBe(34);
    expect(pitch.homeGoal.netDirection).toBe(-1);
    expect(pitch.awayGoal.lineX).toBe(105);
    expect(pitch.awayGoal.netDirection).toBe(1);
    expect(pitch.goalWidthM).toBe(7.32);
  });

  it("applies per-stadium overrides", () => {
    const pitch = createPitch({ lengthM: 100, widthM: 64 });
    expect(pitch.lengthM).toBe(100);
    expect(pitch.centreX).toBe(50);
    expect(pitch.centreY).toBe(32);
    expect(pitch.awayGoal.lineX).toBe(100);
    expect(pitch.penaltyAreaLengthM).toBe(DEFAULT_PITCH_CONFIG.penaltyAreaLengthM);
  });

  it("rejects impossible geometry", () => {
    expect(() => createPitch({ goalWidthM: 80 })).toThrow(RangeError);
    expect(() => createPitch({ widthM: 0 })).toThrow(RangeError);
    expect(() => createPitch({ penaltyAreaLengthM: 60 })).toThrow(RangeError);
    expect(() =>
      validatePitchConfig({ ...DEFAULT_PITCH_CONFIG, goalAreaLengthM: 20 }),
    ).toThrow(RangeError);
  });
});

describe("goal helpers", () => {
  const pitch = createPitch();

  it("returns the correct attacking and defending goals", () => {
    expect(getAttackingGoal(pitch, "home")).toBe(pitch.awayGoal);
    expect(getDefendingGoal(pitch, "home")).toBe(pitch.homeGoal);
    expect(getAttackingGoal(pitch, "away")).toBe(pitch.homeGoal);
    expect(getDefendingGoal(pitch, "away")).toBe(pitch.awayGoal);
  });
});

describe("area tests", () => {
  const pitch = createPitch();

  it("checks the pitch rectangle with an optional margin", () => {
    expect(isInsidePitch(pitch, 0, 0)).toBe(true);
    expect(isInsidePitch(pitch, 105, 68)).toBe(true);
    expect(isInsidePitch(pitch, -1, 10)).toBe(false);
    expect(isInsidePitch(pitch, -1, 10, 2)).toBe(true);
  });

  it("checks both penalty areas", () => {
    expect(isInsidePenaltyArea(pitch, "home", 10, 34)).toBe(true);
    expect(isInsidePenaltyArea(pitch, "home", 20, 34)).toBe(false);
    expect(isInsidePenaltyArea(pitch, "away", 95, 34)).toBe(true);
    expect(isInsidePenaltyArea(pitch, "away", 80, 34)).toBe(false);
    expect(isInsidePenaltyArea(pitch, "home", 10, 60)).toBe(false);
  });

  it("checks both goal areas", () => {
    expect(isInsideGoalArea(pitch, "home", 3, 34)).toBe(true);
    expect(isInsideGoalArea(pitch, "home", 8, 34)).toBe(false);
    expect(isInsideGoalArea(pitch, "away", 102, 34)).toBe(true);
    expect(isInsideGoalArea(pitch, "away", 95, 34)).toBe(false);
  });
});
