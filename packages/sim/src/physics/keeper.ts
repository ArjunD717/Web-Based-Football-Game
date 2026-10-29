// packages/sim/src/physics/keeper.ts

import { TUNING, clamp } from "@fb/shared";
import { getDefendingGoalForDirection } from "../pitch";
import { eventRng } from "../random";
import { recordShotOnTarget, statsFor } from "../stats";
import type { MatchState } from "../types";

/**
 * Goalkeeper save window. The body collision model can block a ball that hits
 * the keeper, but it cannot represent a dive or a deliberate parry. This pass
 * runs after ball integration and before the goal-line law, so a save can only
 * happen while the ball is still in front of the line.
 */
export function resolveGoalkeeperSave(state: MatchState): boolean {
  if (state.referee.phase !== "live") {
    return false;
  }
  const ball = state.ball;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < TUNING.ai.saveMinBallSpeedMps) {
    return false;
  }

  for (const side of ["home", "away"] as const) {
    const team = side === "home" ? state.home : state.away;
    const keeper = team.players.find(
      (player) => player.role === "GK" && !player.sentOff,
    );
    if (keeper === undefined) {
      continue;
    }
    const goal = getDefendingGoalForDirection(
      state.pitch,
      team.attackDirection,
    );
    const inward = -goal.netDirection;
    const towardGoal = ball.vx * goal.netDirection > 0;
    if (!towardGoal) {
      continue;
    }
    const inFrontOfLine = (ball.x - goal.lineX) * inward > 0;
    if (!inFrontOfLine) {
      continue;
    }
    const distanceToLine = Math.abs(goal.lineX - ball.x);
    if (
      distanceToLine > TUNING.ai.saveMaxDistanceM ||
      distanceToLine < TUNING.ball.radiusM
    ) {
      continue;
    }
    const timeToLine = distanceToLine / Math.max(Math.abs(ball.vx), 0.01);
    const projectedY = ball.y + ball.vy * timeToLine;
    const goalMinY = goal.centreY - goal.widthM / 2;
    const goalMaxY = goal.centreY + goal.widthM / 2;
    if (projectedY < goalMinY - 2 || projectedY > goalMaxY + 2) {
      continue;
    }
    const projectedZ =
      ball.z + ball.vz * timeToLine - 0.5 * TUNING.ball.gravityMps2 * timeToLine * timeToLine;
    if (projectedZ > goal.heightM + 1) {
      continue;
    }

    const gk = keeper.attributes.goalkeeper;
    const diving = gk?.diving ?? keeper.attributes.agility;
    const handling = gk?.handling ?? keeper.attributes.ballControl;
    const reflexes = gk?.reflexes ?? keeper.attributes.reactions;
    const positioning = gk?.positioning ?? keeper.attributes.defAwareness;
    const reach =
      TUNING.ai.saveReachBaseM + (diving / 99) * TUNING.ai.saveReachRatingM;
    const lateralOffset = Math.abs(keeper.y - projectedY);
    if (lateralOffset > reach) {
      continue;
    }

    const reactionTime = clamp(
      timeToLine / TUNING.ai.saveReactionSeconds,
      0,
      1,
    );
    const speedPenalty =
      clamp(speed / TUNING.ball.maxSpeedMps, 0, 1) *
      TUNING.ai.saveSpeedPenalty;
    const chance = clamp(
      TUNING.ai.saveBaseChance +
        (reflexes / 99) * TUNING.ai.saveReflexWeight +
        (positioning / 99) * TUNING.ai.savePositioningWeight +
        (handling / 99) * TUNING.ai.saveHandlingWeight +
        (1 - lateralOffset / reach) * TUNING.ai.saveReachWeight -
        speedPenalty -
        reactionTime * TUNING.ai.saveReactionPenalty,
      0,
      TUNING.ai.saveMaxChance,
    );
    const rng = eventRng(state.seed, state.tick, 0x5a17);
    if (!rng.chance(chance)) {
      continue;
    }

    const catchChance = clamp(
      TUNING.ai.saveCatchBase +
        (handling / 99) * TUNING.ai.saveCatchHandlingWeight -
        clamp(speed / TUNING.ball.maxSpeedMps, 0, 1) *
          TUNING.ai.saveCatchSpeedPenalty,
      TUNING.ai.saveCatchMinChance,
      TUNING.ai.saveCatchMaxChance,
    );
    statsFor(state, side).saves += 1;
    recordShotOnTarget(
      state,
      side === "home" ? "away" : "home",
    );

    if (rng.chance(catchChance)) {
      ball.x = keeper.x;
      ball.y = keeper.y;
      ball.z = TUNING.ball.radiusM;
      ball.vx = 0;
      ball.vy = 0;
      ball.vz = 0;
      ball.spinX = 0;
      ball.spinY = 0;
      ball.spinZ = 0;
      keeper.kickCooldown = TUNING.ai.saveCatchHoldSeconds;
    } else {
      const parrySide = rng.chance(0.5) ? 1 : -1;
      ball.x = keeper.x;
      ball.y = keeper.y;
      ball.z = TUNING.ball.radiusM;
      ball.vx = inward * TUNING.ai.saveParrySpeedMps;
      ball.vy = parrySide * TUNING.ai.saveParryLateralMps;
      ball.vz = TUNING.ai.saveParryLiftMps;
      ball.spinX = 0;
      ball.spinY = 0;
      ball.spinZ = 0;
      keeper.kickCooldown = TUNING.ai.saveParryRecoverSeconds;
    }
    state.lastTouch = {
      team: side,
      playerId: keeper.id,
      playerNumber: keeper.number,
    };
    if (state.referee.offside !== null) {
      state.referee.offside = null;
    }
    return true;
  }
  return false;
}
