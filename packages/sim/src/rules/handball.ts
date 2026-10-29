// packages/sim/src/rules/handball.ts
import { TUNING, clamp } from "@fb/shared";
import type { PlayerState } from "../types";

export type HandballDecision = "none" | "directFreeKick" | "penalty";

export interface HandballContext {
  readonly isGoalkeeper: boolean;
  readonly inOwnPenaltyArea: boolean;
  /** Ball struck the hand/arm rather than the head or torso. */
  readonly contactOnArm: boolean;
  readonly armMakesBodyBigger: boolean;
  readonly armAboveShoulder: boolean;
  readonly deliberate: boolean;
  /** Attacker handled immediately before a goal-scoring touch. */
  readonly attackerBeforeGoal: boolean;
}

const RULES = TUNING.referee;

/**
 * Law 12 handball test. Goalkeepers may handle inside their own area; every
 * other arm contact that is deliberate, makes the body unnaturally bigger, is
 * above the shoulder, or denies a goal is an offence.
 */
export function assessHandball(context: HandballContext): HandballDecision {
  if (context.isGoalkeeper && context.inOwnPenaltyArea) {
    return "none";
  }
  if (!context.contactOnArm) {
    return "none";
  }
  const offence =
    context.deliberate ||
    context.armMakesBodyBigger ||
    context.armAboveShoulder ||
    context.attackerBeforeGoal;
  if (!offence) {
    return "none";
  }
  return context.inOwnPenaltyArea && !context.isGoalkeeper
    ? "penalty"
    : "directFreeKick";
}

export interface HandballContactInput {
  readonly player: PlayerState;
  readonly ballHeightM: number;
  readonly relativeSpeedMps: number;
  readonly inOwnPenaltyArea: boolean;
  readonly deliberateRoll: number;
  readonly attackerBeforeGoal: boolean;
}

/** Converts a physical ball/body contact into the law's contact description. */
export function handballContextFromContact(
  input: HandballContactInput,
): HandballContext {
  const height = input.ballHeightM;
  const contactOnArm =
    height >= RULES.handballMinHeightM &&
    height <= RULES.handballMaxHeightM;
  const movingFast =
    input.relativeSpeedMps >= RULES.handballMinRelativeSpeedMps;
  return {
    isGoalkeeper: input.player.role === "GK",
    inOwnPenaltyArea: input.inOwnPenaltyArea,
    contactOnArm,
    armMakesBodyBigger:
      contactOnArm &&
      movingFast &&
      height >= RULES.handballShoulderHeightM,
    armAboveShoulder:
      contactOnArm && height >= RULES.handballMaxHeightM,
    deliberate:
      contactOnArm &&
      clamp(input.deliberateRoll, 0, 1) <= RULES.handballDeliberateChance,
    attackerBeforeGoal: input.attackerBeforeGoal,
  };
}
