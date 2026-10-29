// packages/sim/src/ai/brain.ts
import { TUNING, clamp, normalizeAngle, type Rng } from "@fb/shared";
import { shapeAnchorNormalized } from "../formations";
import {
  getAttackingGoalForDirection,
  getDefendingGoalForDirection,
  isInsideOwnPenaltyArea,
} from "../pitch";
import { kickBall } from "../physics/ball";
import { topSpeedFor } from "../physics/players";
import { decisionRng } from "../random";
import type {
  GoalGeometry,
  MatchState,
  PlayerState,
  TeamState,
} from "../types";

interface NearestPlayer {
  readonly player: PlayerState;
  readonly distance: number;
}

/**
 * Placeholder M1 brain: shape by formation anchor, one chaser per team, and a
 * single nearest-player kick decision. Role layers and decision scoring arrive
 * in M8.
 */
export function updatePlaceholderAi(state: MatchState): void {
  const nearest = findNearestPlayerToBall(state);
  assignTeamTargets(state, state.home);
  assignTeamTargets(state, state.away);

  if (
    nearest !== null &&
    !nearest.player.isUserControlled &&
    nearest.distance <= TUNING.ai.controlRadiusM &&
    state.ball.z <= TUNING.ai.controlMaxBallHeightM &&
    nearest.player.kickCooldown <= 0
  ) {
    decideKick(state, nearest.player);
  }
}

function assignTeamTargets(state: MatchState, team: TeamState): void {
  const chaser = findNearestOutfieldPlayer(team, state.ball.x, state.ball.y);
  const ball = state.ball;

  for (const player of team.players) {
    if (player.isUserControlled) {
      continue;
    }
    if (player.role === "GK") {
      const target = keeperTarget(state, team);
      player.targetX = target.x;
      player.targetY = target.y;
      player.targetSpeed =
        topSpeedFor(player.attributes) * TUNING.ai.keeperSpeedFactor;
      continue;
    }

    if (player === chaser) {
      player.targetX = clamp(
        ball.x + ball.vx * TUNING.ai.chaseLeadSeconds,
        TUNING.player.pitchMarginM,
        state.pitch.lengthM - TUNING.player.pitchMarginM,
      );
      player.targetY = clamp(
        ball.y + ball.vy * TUNING.ai.chaseLeadSeconds,
        TUNING.player.pitchMarginM,
        state.pitch.widthM - TUNING.player.pitchMarginM,
      );
      player.targetSpeed =
        topSpeedFor(player.attributes) * TUNING.ai.chaserSpeedFactor;
      continue;
    }

    const anchor = shapeAnchorNormalized(
      state.pitch,
      team.side,
      player.role,
      player.formationX,
      player.formationY,
      ball.x,
      ball.y,
      team.attackDirection,
    );
    player.targetX = anchor.x;
    player.targetY = anchor.y;
    player.targetSpeed =
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor;
  }
}

function keeperTarget(
  state: MatchState,
  team: TeamState,
): { readonly x: number; readonly y: number } {
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const inward = team.attackDirection;
  const yMin = goal.centreY - goal.widthM / 2 + TUNING.ai.keeperTrackInsetM;
  const yMax = goal.centreY + goal.widthM / 2 - TUNING.ai.keeperTrackInsetM;
  const y = clamp(state.ball.y, yMin, yMax);
  const lineX = goal.lineX + inward * TUNING.ai.keeperLineOffsetM;

  if (
    isInsideOwnPenaltyArea(
      state.pitch,
      team.attackDirection,
      state.ball.x,
      state.ball.y,
    )
  ) {
    const advanceX =
      goal.lineX + inward * TUNING.ai.keeperMaxAdvanceM;
    return {
      x: clamp(state.ball.x, Math.min(lineX, advanceX), Math.max(lineX, advanceX)),
      y: clamp(state.ball.y, yMin, yMax),
    };
  }

  return { x: lineX, y };
}

function decideKick(state: MatchState, player: PlayerState): void {
  const team = player.team === "home" ? state.home : state.away;
  const attackGoal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const rng = decisionRng(
    state.seed,
    state.tick,
    player.team,
    player.number,
  );

  if (player.role === "GK") {
    keeperClear(state, player, attackGoal, rng);
    return;
  }

  const distanceToGoal = Math.hypot(
    attackGoal.lineX - player.x,
    attackGoal.centreY - player.y,
  );
  const nearestOpponent = findNearestOpponent(state, player);
  const pressure = nearestOpponent?.distance ?? Infinity;
  const passTarget = selectPassTarget(state, player, team.attackDirection);

  if (
    distanceToGoal <= TUNING.ai.shootRangeM &&
    rng.chance(TUNING.ai.shootChance)
  ) {
    shoot(state, player, attackGoal, rng);
    return;
  }

  if (
    passTarget !== null &&
    pressure <= TUNING.ai.pressDistanceM &&
    rng.chance(TUNING.ai.passChance)
  ) {
    pass(state, player, passTarget, rng);
    return;
  }

  dribble(state, player, attackGoal, nearestOpponent);
}

function shoot(
  state: MatchState,
  player: PlayerState,
  goal: GoalGeometry,
  rng: Rng,
): void {
  const inset = TUNING.ball.radiusM * 2;
  const yMin = goal.centreY - goal.widthM / 2 + inset;
  const yMax = goal.centreY + goal.widthM / 2 - inset;
  const aimY = clamp(
    goal.centreY + rng.range(-TUNING.ai.shootAimSpreadM, TUNING.ai.shootAimSpreadM),
    yMin,
    yMax,
  );
  const aimX = goal.lineX + goal.netDirection * TUNING.ai.shootAimDepthM;

  kickBall(state.ball, player, {
    targetX: aimX,
    targetY: aimY,
    speed: TUNING.ai.shootPowerMps,
    lift: TUNING.ai.shootLiftMps,
    spinY: -TUNING.ai.shotBackspinRadPerS,
    spinZ: rng.range(
      -TUNING.ai.shotCurveSpinRadPerS,
      TUNING.ai.shotCurveSpinRadPerS,
    ),
    velocityTransfer: TUNING.ai.shootVelocityTransfer,
  });
  markAction(state, player, "shoot", TUNING.player.kickCooldownSeconds);
}

function pass(
  state: MatchState,
  player: PlayerState,
  target: PlayerState,
  rng: Rng,
): void {
  const leadX =
    target.x + target.vx * TUNING.ai.passLeadSeconds;
  const leadY =
    target.y + target.vy * TUNING.ai.passLeadSeconds;

  kickBall(state.ball, player, {
    targetX: clamp(leadX, TUNING.player.pitchMarginM, state.pitch.lengthM - TUNING.player.pitchMarginM),
    targetY: clamp(leadY, TUNING.player.pitchMarginM, state.pitch.widthM - TUNING.player.pitchMarginM),
    speed: TUNING.ai.passPowerMps,
    lift: TUNING.ai.passLiftMps,
    spinZ: rng.range(
      -TUNING.ai.passCurveSpinRadPerS,
      TUNING.ai.passCurveSpinRadPerS,
    ),
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(state, player, "pass", TUNING.player.kickCooldownSeconds);
}

function dribble(
  state: MatchState,
  player: PlayerState,
  goal: GoalGeometry,
  nearestOpponent: NearestPlayer | null,
): void {
  let targetX = goal.lineX;
  let targetY = goal.centreY;

  if (
    nearestOpponent !== null &&
    Math.hypot(
      nearestOpponent.player.x - state.ball.x,
      nearestOpponent.player.y - state.ball.y,
    ) <= TUNING.ai.dribbleEvadeDistanceM
  ) {
    const goalAngle = Math.atan2(
      goal.centreY - state.ball.y,
      goal.lineX - state.ball.x,
    );
    const opponentAngle = Math.atan2(
      nearestOpponent.player.y - state.ball.y,
      nearestOpponent.player.x - state.ball.x,
    );
    const side =
      normalizeAngle(opponentAngle - goalAngle) >= 0 ? -1 : 1;
    const evadeAngle =
      goalAngle + side * TUNING.ai.dribbleEvadeTurnRad;
    targetX =
      state.ball.x +
      Math.cos(evadeAngle) * TUNING.ai.dribbleEvadeTargetM;
    targetY =
      state.ball.y +
      Math.sin(evadeAngle) * TUNING.ai.dribbleEvadeTargetM;
  }

  kickBall(state.ball, player, {
    targetX: clamp(
      targetX,
      TUNING.player.pitchMarginM,
      state.pitch.lengthM - TUNING.player.pitchMarginM,
    ),
    targetY: clamp(
      targetY,
      TUNING.player.pitchMarginM,
      state.pitch.widthM - TUNING.player.pitchMarginM,
    ),
    speed: TUNING.ai.dribbleTouchSpeedMps,
    lift: 0,
    velocityTransfer: TUNING.ai.dribbleVelocityTransfer,
  });
  markAction(state, player, "dribble", TUNING.ai.dribbleCooldownSeconds);
}

function keeperClear(
  state: MatchState,
  player: PlayerState,
  goal: GoalGeometry,
  rng: Rng,
): void {
  const aimY = clamp(
    goal.centreY +
      rng.range(-TUNING.ai.keeperClearSpreadM, TUNING.ai.keeperClearSpreadM),
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );

  kickBall(state.ball, player, {
    targetX: goal.lineX,
    targetY: aimY,
    speed: TUNING.ai.keeperClearPowerMps,
    lift: TUNING.ai.keeperClearLiftMps,
    spinY: -TUNING.ai.shotBackspinRadPerS,
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(state, player, "pass", TUNING.player.kickCooldownSeconds);
}

function markAction(
  state: MatchState,
  player: PlayerState,
  action: "dribble" | "pass" | "shoot",
  cooldownSeconds: number,
): void {
  player.state = action;
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = cooldownSeconds;
  state.lastTouch = {
    team: player.team,
    playerId: player.id,
    playerNumber: player.number,
  };
}

function selectPassTarget(
  state: MatchState,
  player: PlayerState,
  attackDirection: 1 | -1,
): PlayerState | null {
  const teammates =
    player.team === "home" ? state.home.players : state.away.players;
  let best: PlayerState | null = null;
  let bestProgress = -Infinity;

  for (const teammate of teammates) {
    if (teammate === player || teammate.role === "GK") {
      continue;
    }
    const distance = Math.hypot(teammate.x - player.x, teammate.y - player.y);
    if (
      distance < TUNING.ai.minPassDistanceM ||
      distance > TUNING.ai.passRangeM
    ) {
      continue;
    }
    const progress = (teammate.x - player.x) * attackDirection;
    if (progress > bestProgress) {
      bestProgress = progress;
      best = teammate;
    }
  }

  return best;
}

function findNearestOpponent(
  state: MatchState,
  player: PlayerState,
): NearestPlayer | null {
  const opponents =
    player.team === "home" ? state.away.players : state.home.players;
  let best: NearestPlayer | null = null;

  for (const opponent of opponents) {
    const distance = Math.hypot(opponent.x - player.x, opponent.y - player.y);
    if (best === null || distance < best.distance) {
      best = { player: opponent, distance };
    }
  }

  return best;
}

function findNearestPlayerToBall(state: MatchState): NearestPlayer | null {
  const homeNearest = findNearestInTeam(state.home, state.ball.x, state.ball.y);
  const awayNearest = findNearestInTeam(state.away, state.ball.x, state.ball.y);

  if (homeNearest === null) {
    return awayNearest;
  }
  if (awayNearest === null) {
    return homeNearest;
  }
  return awayNearest.distance < homeNearest.distance
    ? awayNearest
    : homeNearest;
}

function findNearestInTeam(
  team: TeamState,
  x: number,
  y: number,
): NearestPlayer | null {
  let best: NearestPlayer | null = null;

  for (const player of team.players) {
    const distance = Math.hypot(player.x - x, player.y - y);
    if (best === null || distance < best.distance) {
      best = { player, distance };
    }
  }

  return best;
}

function findNearestOutfieldPlayer(
  team: TeamState,
  x: number,
  y: number,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Infinity;

  for (const player of team.players) {
    if (player.role === "GK" || player.isUserControlled) {
      continue;
    }
    const distance = Math.hypot(player.x - x, player.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }

  return best;
}
