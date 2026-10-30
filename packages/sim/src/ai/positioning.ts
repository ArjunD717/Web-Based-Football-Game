// packages/sim/src/ai/positioning.ts

import { TUNING, clamp } from "@fb/shared";
import { shapeAnchorNormalized } from "../formations";
import {
  getAttackingGoalForDirection,
  getDefendingGoalForDirection,
  isInsideOwnPenaltyArea,
} from "../pitch";
import { topSpeedFor } from "../physics/players";
import { heldBySetPiece } from "../rules/referee";
import { isAvailablePlayer } from "../rules/management";
import type {
  GoalGeometry,
  MatchState,
  PlayerState,
  TeamState,
} from "../types";
import type { AiTeamPlan } from "./context";
import { nearestPlayerTo } from "./context";
import {
  isDefensiveRole,
  isWideRole,
  roleProfile,
} from "./profiles";
import {
  clampToPitch,
  goalSidePoint,
  interceptPoint,
  separatedTarget,
} from "./steering";

export function assignTeamTargets(
  state: MatchState,
  team: TeamState,
  plan: AiTeamPlan,
): void {
  const marked = new Set<string>();
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );

  for (const player of team.players) {
    if (player.isUserControlled || !isAvailablePlayer(player)) {
      continue;
    }
    if (heldBySetPiece(state, player)) {
      stopPlayer(player);
      continue;
    }
    if (player.role === "GK") {
      assignKeeperTarget(state, team, player, plan);
      continue;
    }
    if (
      applySetPieceTarget(state, team, player, plan) ||
      (plan.phase === "defend" &&
        assignDefenderTarget(state, team, player, plan, goal, marked)) ||
      (plan.phase === "attack" &&
        assignAttackerTarget(state, team, player, plan)) ||
      assignShapeTarget(state, team, player, plan)
    ) {
      continue;
    }
  }

  applySeparation(team);
}

function assignKeeperTarget(
  state: MatchState,
  team: TeamState,
  keeper: PlayerState,
  plan: AiTeamPlan,
): void {
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const pitch = state.pitch;
  const inward = -goal.netDirection;
  const lineX = goal.lineX + inward * TUNING.ai.keeperLineOffsetM;
  const setPiece = state.referee.setPiece;

  if (setPiece?.penalty !== null && setPiece?.penalty !== undefined) {
    setTarget(
      keeper,
      goal.lineX + inward * TUNING.referee.penaltyGoalkeeperLineOffsetM,
      goal.centreY,
      topSpeedFor(keeper.attributes) * TUNING.ai.keeperSpeedFactor,
    );
    return;
  }

  const inOwnArea = isInsideOwnPenaltyArea(
    pitch,
    team.attackDirection,
    state.ball.x,
    state.ball.y,
  );
  const ballDistance = Math.hypot(
    state.ball.x - goal.lineX,
    state.ball.y - goal.centreY,
  );
  const nearestOpponent = nearestPlayerTo(
    state,
    team.side === "home" ? state.away : state.home,
    state.ball.x,
    state.ball.y,
  );
  const keeperDistance = Math.hypot(
    keeper.x - state.ball.x,
    keeper.y - state.ball.y,
  );
  const canClaim =
    inOwnArea &&
    keeperDistance <= TUNING.ai.keeperClaimRadiusM &&
    (nearestOpponent === null ||
      nearestOpponent.distance >= keeperDistance - TUNING.ai.keeperLineOffsetM);

  if (canClaim) {
    const intercept = interceptPoint(
      state.ball,
      keeper,
      topSpeedFor(keeper.attributes),
    );
    const target = clampToPitch(pitch, intercept.x, intercept.y);
    setTarget(
      keeper,
      target.x,
      target.y,
      topSpeedFor(keeper.attributes) * TUNING.ai.keeperSweepSpeedFactor,
    );
    return;
  }

  const canSweep =
    !inOwnArea &&
    (plan.phase === "defend" || plan.phase === "loose") &&
    ballDistance <= TUNING.ai.keeperSweepTriggerM &&
    (nearestOpponent === null ||
      nearestOpponent.distance > keeperDistance - TUNING.ai.keeperLineOffsetM);

  if (canSweep) {
    const sweepX =
      goal.lineX + inward * TUNING.ai.keeperSweepMaxM;
    const sweepY = clamp(
      goal.centreY +
        (state.ball.y - goal.centreY) *
          TUNING.ai.keeperTrackInsetM,
      goal.centreY - goal.widthM / 2 + TUNING.ai.keeperTrackInsetM,
      goal.centreY + goal.widthM / 2 - TUNING.ai.keeperTrackInsetM,
    );
    const t = clamp(
      (ballDistance - TUNING.ai.keeperLineOffsetM) /
        TUNING.ai.keeperSweepTriggerM,
      0,
      1,
    );
    setTarget(
      keeper,
      clamp(
        lineX + (sweepX - lineX) * t,
        Math.min(lineX, sweepX),
        Math.max(lineX, sweepX),
      ),
      sweepY,
      topSpeedFor(keeper.attributes) * TUNING.ai.keeperSpeedFactor,
    );
    return;
  }

  const depth = clamp(
    TUNING.ai.keeperAngleDepthM +
      Math.abs(state.ball.x - goal.lineX) *
        TUNING.ai.keeperAngleDistanceFactor,
    TUNING.ai.keeperLineOffsetM,
    TUNING.ai.keeperSweepMaxM,
  );
  const nearPostInset = TUNING.ai.keeperNearPostInsetM;
  const targetX = goal.lineX + inward * depth;
  const targetY = clamp(
    goal.centreY +
      (state.ball.y - goal.centreY) *
        (TUNING.ai.keeperTrackInsetM * 0.5),
    goal.centreY - goal.widthM / 2 + nearPostInset,
    goal.centreY + goal.widthM / 2 - nearPostInset,
  );
  setTarget(
    keeper,
    targetX,
    targetY,
    topSpeedFor(keeper.attributes) * TUNING.ai.keeperSpeedFactor,
  );
}

function applySetPieceTarget(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  plan: AiTeamPlan,
): boolean {
  const setPiece = state.referee.setPiece;
  if (setPiece === null || setPiece.firstTouchId !== null) {
    return false;
  }
  if (setPiece.takerId === player.id) {
    // The taker waits at the restart spot until the first touch; the on-ball
    // brain still decides when to play it.
    stopPlayer(player);
    return true;
  }
  const attacking = setPiece.side === team.side;
  if (
    setPiece.type !== "corner" &&
    setPiece.type !== "penalty" &&
    setPiece.type !== "directFreeKick" &&
    setPiece.type !== "indirectFreeKick"
  ) {
    return false;
  }

  if (setPiece.type === "penalty") {
    stopPlayer(player);
    return true;
  }

  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  if (setPiece.type === "corner") {
    if (!attacking) {
      const opponent = markNearestOpponent(state, team, player, goal);
      if (opponent !== null) {
        return true;
      }
    }
    const runnerIndex = plan.runnerIds.indexOf(player.id);
    const nearPost = state.ball.y <= state.pitch.centreY;
    const postY = nearPost
      ? goal.centreY - goal.widthM / 2
      : goal.centreY + goal.widthM / 2;
    const farY = nearPost
      ? goal.centreY + goal.widthM / 2
      : goal.centreY - goal.widthM / 2;
    if (runnerIndex === 0) {
      setTarget(
        player,
        goal.lineX - team.attackDirection * TUNING.ai.cornerRunnerDepthM * 0.4,
        postY * 0.96 + farY * 0.04,
        topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
      );
      return true;
    }
    if (runnerIndex === 1) {
      setTarget(
        player,
        goal.lineX - team.attackDirection * TUNING.ai.cornerRunnerDepthM * 0.55,
        farY,
        topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
      );
      return true;
    }
    if (player.role === "ST" || player.role === "CF" || player.role === "CAM") {
      setTarget(
        player,
        goal.lineX - team.attackDirection * (state.pitch.penaltyAreaLengthM * 0.55),
        goal.centreY,
        topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
      );
      return true;
    }
    return false;
  }

  if (attacking) {
    const distance = Math.hypot(
      state.ball.x - goal.lineX,
      state.ball.y - goal.centreY,
    );
    if (distance <= TUNING.ai.freeKickDirectRangeM) {
      const runnerIndex = plan.runnerIds.indexOf(player.id);
      if (runnerIndex >= 0) {
        setTarget(
          player,
          goal.lineX - team.attackDirection * TUNING.ai.cornerRunnerDepthM,
          goal.centreY + (runnerIndex === 0 ? -1 : 1) * goal.widthM * 0.3,
          topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
        );
        return true;
      }
    }
    return false;
  }
  return markNearestOpponent(state, team, player, goal) !== null;
}

function markNearestOpponent(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  ownGoal: GoalGeometry,
): PlayerState | null {
  const opponents =
    team.side === "home" ? state.away : state.home;
  let best: PlayerState | null = null;
  let bestDistance = Infinity;
  for (const opponent of opponents.players) {
    if (!isAvailablePlayer(opponent) || opponent.role === "GK") {
      continue;
    }
    const distance = Math.hypot(
      opponent.x - player.x,
      opponent.y - player.y,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = opponent;
    }
  }
  if (best === null) {
    return null;
  }
  const point = goalSidePoint(
    { x: best.x, y: best.y },
    ownGoal.lineX,
    ownGoal.centreY,
    TUNING.ai.markGoalSideM,
  );
  setTarget(
    player,
    point.x,
    point.y,
    topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
  );
  return best;
}

function assignDefenderTarget(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  plan: AiTeamPlan,
  ownGoal: GoalGeometry,
  marked: Set<string>,
): boolean {
  const profile = roleProfile(player.role);
  if (player.id === plan.receiverId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) * TUNING.ai.receiverSpeedFactor,
    );
    return true;
  }
  if (player.id === plan.presserId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) *
        TUNING.ai.pressAggressionFactor *
        difficultyPress(state),
    );
    return true;
  }
  if (player.id === plan.secondPresserId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }
  if (player.id === plan.coverId) {
    const point = goalSidePoint(
      { x: state.ball.x, y: state.ball.y },
      ownGoal.lineX,
      ownGoal.centreY,
      TUNING.ai.coverDepthM,
    );
    setTarget(
      player,
      point.x,
      point.y,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }

  let mark: PlayerState | null = null;
  let markDistance = Infinity;
  for (const opponent of (team.side === "home"
    ? state.away
    : state.home
  ).players) {
    if (
      !isAvailablePlayer(opponent) ||
      opponent.role === "GK" ||
      opponent.id === plan.owner?.id ||
      marked.has(opponent.id)
    ) {
      continue;
    }
    const distance = Math.hypot(
      opponent.x - player.x,
      opponent.y - player.y,
    );
    if (
      distance <= TUNING.ai.markingRadiusM &&
      distance < markDistance
    ) {
      mark = opponent;
      markDistance = distance;
    }
  }

  if (mark !== null) {
    marked.add(mark.id);
    const point = goalSidePoint(
      { x: mark.x, y: mark.y },
      ownGoal.lineX,
      ownGoal.centreY,
      TUNING.ai.markGoalSideM,
    );
    setTarget(
      player,
      point.x,
      point.y,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }

  const anchor = shapeAnchorNormalized(
    state.pitch,
    team.side,
    player.role,
    player.formationX,
    player.formationY,
    state.ball.x,
    state.ball.y,
    team.attackDirection,
  );
  const width = widthFactor(team);
  const compact = compactFactor(state);
  const x =
    isDefensiveRole(player.role)
      ? plan.lineX
      : anchor.x + profile.defendShift * state.pitch.lengthM * team.attackDirection;
  const y = clamp(
    state.pitch.centreY + (anchor.y - state.pitch.centreY) * width * compact,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );
  setTarget(
    player,
    x,
    y,
    topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
  );
  return true;
}

function assignAttackerTarget(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  plan: AiTeamPlan,
): boolean {
  const profile = roleProfile(player.role);
  const anchor = shapeAnchorNormalized(
    state.pitch,
    team.side,
    player.role,
    player.formationX,
    player.formationY,
    state.ball.x,
    state.ball.y,
    team.attackDirection,
  );
  const width = widthFactor(team);
  const baseX =
    anchor.x +
    profile.attackShift * state.pitch.lengthM * team.attackDirection;
  const baseY =
    state.pitch.centreY + (anchor.y - state.pitch.centreY) * width;

  if (player.id === plan.owner?.id) {
    setTarget(
      player,
      state.ball.x + team.attackDirection * TUNING.ai.supportForwardM * 0.3,
      state.ball.y,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }

  const runnerIndex = plan.runnerIds.indexOf(player.id);
  if (runnerIndex >= 0) {
    const channelSign =
      player.formationY < 0.5 ? -1 : player.formationY > 0.5 ? 1 : 0;
    const channel =
      state.pitch.centreY +
      channelSign * TUNING.ai.channelRunM * (runnerIndex === 0 ? 1 : 1.4);
    if (runnerIndex === 0) {
      setTarget(
        player,
        plan.offsideLineX + team.attackDirection * TUNING.ai.offsideRunToleranceM,
        channel,
        topSpeedFor(player.attributes) * TUNING.ai.runnerSpeedFactor,
      );
    } else if (runnerIndex === 1) {
      setTarget(
        player,
        state.ball.x + team.attackDirection * TUNING.ai.thirdManRunM,
        channel,
        topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
      );
    } else {
      setTarget(
        player,
        plan.offsideLineX +
          team.attackDirection * TUNING.ai.offsideRunToleranceM * 0.6,
        channel,
        topSpeedFor(player.attributes) * TUNING.ai.runnerSpeedFactor,
      );
    }
    return true;
  }

  const supportIndex = plan.supportIds.indexOf(player.id);
  if (supportIndex >= 0) {
    const side = player.role === "RB" || player.role === "RM" || player.role === "RW" ||
      player.role === "LB" || player.role === "LM" || player.role === "LW"
      ? Math.sign(player.formationY - 0.5) || 1
      : 0;
    const lateral =
      side === 0
        ? player.number % 2 === 0
          ? TUNING.ai.supportLateralM
          : -TUNING.ai.supportLateralM
        : side * TUNING.ai.supportLateralM;
    const forward =
      supportIndex === 0
        ? TUNING.ai.supportForwardM
        : -TUNING.ai.supportBackwardM;
    setTarget(
      player,
      state.ball.x + team.attackDirection * forward,
      clamp(
        state.ball.y + lateral,
        TUNING.player.pitchMarginM,
        state.pitch.widthM - TUNING.player.pitchMarginM,
      ),
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }

  if (player.id === plan.overlapId && isWideRole(player.role)) {
    setTarget(
      player,
      state.ball.x + team.attackDirection * TUNING.ai.overlapRunM,
      state.ball.y + Math.sign(baseY - state.pitch.centreY) * TUNING.ai.supportLateralM,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }

  let x = baseX;
  let y = baseY;
  if (player.role === "ST" || player.role === "CF") {
    x = Math.max(
      baseX,
      state.ball.x + team.attackDirection * TUNING.ai.supportDistanceM,
    );
  } else if (player.role === "CB") {
    y = state.pitch.centreY + Math.sign(baseY - state.pitch.centreY) *
      Math.min(Math.abs(baseY - state.pitch.centreY), TUNING.ai.centralWidthM / 2);
  }
  setTarget(
    player,
    x,
    y,
    topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
  );
  return true;
}

function assignShapeTarget(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  plan: AiTeamPlan,
): boolean {
  if (player.id === plan.receiverId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) * TUNING.ai.receiverSpeedFactor,
    );
    return true;
  }
  if (player.id === plan.presserId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) *
        TUNING.ai.pressAggressionFactor *
        difficultyPress(state),
    );
    return true;
  }
  if (player.id === plan.secondPresserId) {
    const target = interceptPoint(
      state.ball,
      player,
      topSpeedFor(player.attributes),
    );
    setTarget(
      player,
      target.x,
      target.y,
      topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
    );
    return true;
  }
  const profile = roleProfile(player.role);
  const anchor = shapeAnchorNormalized(
    state.pitch,
    team.side,
    player.role,
    player.formationX,
    player.formationY,
    state.ball.x,
    state.ball.y,
    team.attackDirection,
  );
  const width = widthFactor(team);
  const x =
    plan.phase === "defend" && isDefensiveRole(player.role)
      ? plan.lineX
      : anchor.x +
        profile.defendShift * state.pitch.lengthM * team.attackDirection;
  const y =
    state.pitch.centreY + (anchor.y - state.pitch.centreY) * width;
  setTarget(
    player,
    x,
    y,
    topSpeedFor(player.attributes) * TUNING.ai.supportSpeedFactor,
  );
  return true;
}

function applySeparation(team: TeamState): void {
  for (const player of team.players) {
    if (
      player.role === "GK" ||
      !isAvailablePlayer(player) ||
      player.isUserControlled
    ) {
      continue;
    }
    const target = separatedTarget(
      { x: player.targetX, y: player.targetY },
      team.players,
      player,
    );
    player.targetX = target.x;
    player.targetY = target.y;
  }
}

function setTarget(
  player: PlayerState,
  x: number,
  y: number,
  speed: number,
): void {
  player.targetX = x;
  player.targetY = y;
  player.targetSpeed = speed;
}

function stopPlayer(player: PlayerState): void {
  player.targetX = player.x;
  player.targetY = player.y;
  player.targetSpeed = 0;
}

function widthFactor(team: TeamState): number {
  return 1 + ((team.tactics.width - 50) / 50) * TUNING.ai.widthSpread;
}

function compactFactor(state: MatchState): number {
  const distanceFromBall = Math.abs(state.ball.x - state.pitch.centreX);
  return clamp(
    1 - distanceFromBall / state.pitch.lengthM * 0.25,
    0.75,
    1,
  );
}

function difficultyPress(state: MatchState): number {
  return TUNING.ai.difficulty[state.rules.aiDifficulty].pressAggression;
}
