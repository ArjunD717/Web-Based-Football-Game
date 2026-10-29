// packages/sim/src/rules/scenarios.test.ts
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import { assessHandball } from "./handball";
import { isOffsidePosition } from "./offside";

const pitch = createMatch({ seed: 90 }).pitch;

interface OffsideScenario {
  readonly name: string;
  readonly direction: 1 | -1;
  readonly playerX: number;
  readonly ballX: number;
  readonly secondLastX: number;
  readonly expected: boolean;
}

// The table covers the three independent offside conditions in both attacking
// directions: opponent half, ahead of the ball, and beyond the second-last
// defender. It is deliberately generated from fixed offsets so every row is a
// distinct, named scripted case rather than a random property test.
const offsideScenarios: OffsideScenario[] = [];
for (const direction of [1, -1] as const) {
  for (const secondLastOffset of [45, 60, 75]) {
    const secondLastX =
      direction === 1 ? secondLastOffset : pitch.lengthM - secondLastOffset;
    for (const playerOffset of [-15, -1, 0, 1, 10, 20]) {
      for (const ballOffset of [-10, 0, 10]) {
        const playerX =
          secondLastX + direction * playerOffset;
        const ballX =
          secondLastX + direction * ballOffset;
        const inOpponentHalf =
          (playerX - pitch.centreX) * direction > 0;
        const aheadOfBall = (playerX - ballX) * direction > 0;
        const beyondSecondLast = playerOffset > 0;
        offsideScenarios.push({
          name: `${direction === 1 ? "right" : "left"} attack, line ${secondLastOffset}, runner ${playerOffset}, ball ${ballOffset}`,
          direction,
          playerX,
          ballX,
          secondLastX,
          expected:
            inOpponentHalf && aheadOfBall && beyondSecondLast,
        });
      }
    }
  }
}

describe("scripted offside scenarios", () => {
  it.each(offsideScenarios)(
    "$name",
    ({ direction, playerX, ballX, secondLastX, expected }) => {
      expect(
        isOffsidePosition(
          pitch,
          { id: "runner", x: playerX, y: pitch.centreY },
          ballX,
          direction,
          secondLastX,
        ),
      ).toBe(expected);
    },
  );
});

interface HandballScenario {
  readonly name: string;
  readonly expected: "none" | "directFreeKick" | "penalty";
  readonly context: {
    readonly isGoalkeeper: boolean;
    readonly inOwnPenaltyArea: boolean;
    readonly contactOnArm: boolean;
    readonly armMakesBodyBigger: boolean;
    readonly armAboveShoulder: boolean;
    readonly deliberate: boolean;
    readonly attackerBeforeGoal: boolean;
  };
}

const watching: HandballScenario["context"] = {
  isGoalkeeper: false,
  inOwnPenaltyArea: false,
  contactOnArm: true,
  armMakesBodyBigger: false,
  armAboveShoulder: false,
  deliberate: false,
  attackerBeforeGoal: false,
};

function handballScenario(
  name: string,
  context: HandballScenario["context"],
  expected: HandballScenario["expected"],
): HandballScenario {
  return { name, context, expected };
}

const handballScenarios: HandballScenario[] = [
  handballScenario("arm contact, nothing else", watching, "none"),
  handballScenario(
    "torso contact with deliberate intent",
    { ...watching, contactOnArm: false, deliberate: true },
    "none",
  ),
  handballScenario(
    "keeper handles in own area",
    {
      ...watching,
      isGoalkeeper: true,
      inOwnPenaltyArea: true,
      deliberate: true,
    },
    "none",
  ),
  handballScenario(
    "keeper handles outside area",
    { ...watching, isGoalkeeper: true, deliberate: true },
    "directFreeKick",
  ),
  handballScenario(
    "outfielder handles deliberately outside area",
    { ...watching, deliberate: true },
    "directFreeKick",
  ),
  handballScenario(
    "outfielder handles deliberately in own area",
    { ...watching, inOwnPenaltyArea: true, deliberate: true },
    "penalty",
  ),
  handballScenario(
    "arm makes body bigger outside area",
    { ...watching, armMakesBodyBigger: true },
    "directFreeKick",
  ),
  handballScenario(
    "arm makes body bigger in own area",
    { ...watching, inOwnPenaltyArea: true, armMakesBodyBigger: true },
    "penalty",
  ),
  handballScenario(
    "arm above shoulder outside area",
    { ...watching, armAboveShoulder: true },
    "directFreeKick",
  ),
  handballScenario(
    "arm above shoulder in own area",
    { ...watching, inOwnPenaltyArea: true, armAboveShoulder: true },
    "penalty",
  ),
  handballScenario(
    "attacker handles before goal",
    { ...watching, attackerBeforeGoal: true },
    "directFreeKick",
  ),
  handballScenario(
    "accidental arm contact outside area",
    watching,
    "none",
  ),
  handballScenario(
    "accidental arm contact in own area",
    { ...watching, inOwnPenaltyArea: true },
    "none",
  ),
  handballScenario(
    "keeper arm above shoulder in own area",
    {
      ...watching,
      isGoalkeeper: true,
      inOwnPenaltyArea: true,
      armAboveShoulder: true,
    },
    "none",
  ),
  handballScenario(
    "keeper arm bigger outside area",
    { ...watching, isGoalkeeper: true, armMakesBodyBigger: true },
    "directFreeKick",
  ),
  handballScenario(
    "deliberate arm contact plus bigger body",
    { ...watching, deliberate: true, armMakesBodyBigger: true },
    "directFreeKick",
  ),
];

describe("scripted handball scenarios", () => {
  it.each(handballScenarios)("$name", ({ context, expected }) => {
    expect(assessHandball(context)).toBe(expected);
  });
});
