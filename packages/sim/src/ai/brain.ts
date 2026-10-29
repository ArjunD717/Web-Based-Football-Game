// packages/sim/src/ai/brain.ts

import { TUNING, clamp } from "@fb/shared";
import { playTackle } from "../control/actions";
import {
  commitPhysicalFoul,
  heldBySetPiece,
} from "../rules/referee";
import { decisionRng } from "../random";
import { isDenyingGoalscoringOpportunity } from "../rules/fouls";
import type { MatchState, PlayerState, TeamState } from "../types";
import {
  analyseBall,
  nearestOutfieldTo,
  planTeam,
  type BallContext,
} from "./context";
import { decideAndExecute } from "./decisions";
import { assignTeamTargets } from "./positioning";
import { difficultyProfile } from "./profiles";

/**
 * M8 AI entry point. Each team gets a tactical plan (phase, line, pressing and
 * runner assignments), every body gets a steering target, then the on-ball
 * brain chooses one weighted action. Difficulty changes reaction cadence,
 * decision noise, pressing aggression and technical execution.
 */
export function updateAi(state: MatchState): void {
  const ball = analyseBall(state);
  const homePlan = planTeam(state, state.home, ball);
  const awayPlan = planTeam(state, state.away, ball);

  assignTeamTargets(state, state.home, homePlan);
  assignTeamTargets(state, state.away, awayPlan);

  const owner = ball.owner;
  if (owner !== null && !owner.isUserControlled) {
    if (tryChallenge(state, owner)) {
      return;
    }
    if (
      state.referee.phase === "live" &&
      !heldBySetPiece(state, owner) &&
      canReact(state, owner) &&
      owner.kickCooldown <= 0 &&
      state.ball.z <= TUNING.ai.controlMaxBallHeightM
    ) {
      decideAndExecute(state, owner);
    }
    return;
  }

  if (owner !== null) {
    return;
  }
  decideLooseBall(state, ball);
}

/** The nearest defender may commit to a tackle before the carrier reacts. */
function tryChallenge(
  state: MatchState,
  owner: PlayerState,
): boolean {
  if (
    state.referee.phase !== "live" ||
    owner.role === "GK" ||
    state.ball.z > TUNING.ai.controlMaxBallHeightM
  ) {
    return false;
  }
  const ballSpeed = Math.hypot(state.ball.vx, state.ball.vy);
  if (ballSpeed > TUNING.ai.tackleMaxBallSpeedMps) {
    return false;
  }
  const defenders = owner.team === "home" ? state.away : state.home;
  const challenger = nearestOutfieldTo(
    state,
    defenders,
    owner.x,
    owner.y,
  );
  if (
    challenger === null ||
    challenger.player.isUserControlled ||
    challenger.distance > TUNING.referee.tackleContactRangeM
  ) {
    return false;
  }
  const defender = challenger.player;
  if (
    defender.kickCooldown > 0 ||
    heldBySetPiece(state, defender) ||
    !canReact(state, defender)
  ) {
    return false;
  }
  const profile = difficultyProfile(state.rules.aiDifficulty);
  const rng = decisionRng(
    state.seed,
    state.tick,
    defender.team,
    defender.number + 1_000,
  );
  const dx = defender.x - owner.x;
  const dy = defender.y - owner.y;
  const distance = Math.hypot(dx, dy);
  const behindDot =
    distance > 1e-6
      ? (Math.cos(owner.facing) * dx + Math.sin(owner.facing) * dy) /
        distance
      : 1;
  const fromBehind = behindDot < TUNING.referee.behindDotThreshold;
  if (
    distance <= TUNING.referee.physicalDuelRangeM &&
    !isDenyingGoalscoringOpportunity(state, owner) &&
    rng.chance(TUNING.referee.physicalDuelChance)
  ) {
    defender.kickCooldown = TUNING.referee.physicalDuelCooldownSeconds;
    commitPhysicalFoul(state, defender, owner);
    return true;
  }
  const chance = clamp(
    (TUNING.ai.tackleChance + profile.tackleBias) *
      (fromBehind ? TUNING.ai.behindTackleChance : 1),
    0,
    1,
  );
  if (!rng.chance(chance)) {
    defender.kickCooldown = TUNING.ai.tackleDecisionCooldownSeconds;
    return false;
  }
  playTackle(
    state,
    defender,
    rng.chance(TUNING.ai.slideTackleChance),
  );
  return state.referee.phase !== "live";
}

function decideLooseBall(
  state: MatchState,
  ball: BallContext,
): void {
  const nearest =
    ball.nearestHome === null
      ? ball.nearestAway
      : ball.nearestAway === null
        ? ball.nearestHome
        : ball.nearestHome.distance <= ball.nearestAway.distance
          ? ball.nearestHome
          : ball.nearestAway;
  if (
    nearest === null ||
    nearest.distance > TUNING.ai.controlRadiusM ||
    nearest.player.isUserControlled ||
    nearest.player.kickCooldown > 0 ||
    heldBySetPiece(state, nearest.player) ||
    !canReact(state, nearest.player) ||
    state.ball.z > TUNING.ai.controlMaxBallHeightM
  ) {
    return;
  }
  decideAndExecute(state, nearest.player);
}

/**
 * Deterministic reaction gate: a player can only start an action on the tick
 * cadence for its difficulty. This produces observable ball-watch delays
 * without storing extra RNG state on every player.
 */
export function canReact(state: MatchState, player: PlayerState): boolean {
  const profile = difficultyProfile(state.rules.aiDifficulty);
  return (
    profile.reactionTicks <= 1 ||
    (state.tick + player.number) % profile.reactionTicks === 0
  );
}

export function teamPlanFor(
  state: MatchState,
  team: TeamState,
  ball: BallContext,
): ReturnType<typeof planTeam> {
  return planTeam(state, team, ball);
}
