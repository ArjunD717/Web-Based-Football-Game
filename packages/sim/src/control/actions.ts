// packages/sim/src/control/actions.ts
import { TUNING, clamp, lerp } from "@fb/shared";
import {
  getAttackingGoalForDirection,
} from "../pitch";
import { kickBall } from "../physics/ball";
import { beginKick, commitTackleFoul } from "../rules/referee";
import { findTackleVictim } from "../rules/fouls";
import type { MatchState, PlayerState } from "../types";

export type PassKind = "pass" | "through" | "lob";

interface AimVector {
  readonly x: number;
  readonly y: number;
}

/**
 * High-level actions for a human-controlled player. They assume the server has
 * already selected this player and routed a discrete button edge.
 */
export function playPass(
  state: MatchState,
  player: PlayerState,
  kind: PassKind,
  aimX: number,
  aimY: number,
): boolean {
  if (!canPlayBall(state, player)) {
    return false;
  }

  const team = player.team === "home" ? state.home : state.away;
  const attackDirection = team.attackDirection;
  let aim = resolveAim(player, aimX, aimY);
  if (player.role === "GK" && Math.hypot(aimX, aimY) < TUNING.control.aimDeadzone) {
    aim = { x: attackDirection, y: 0 };
  }

  const target = findPassTarget(state, player, aim);
  let targetX: number;
  let targetY: number;
  let speed: number;
  let lift: number;

  if (kind === "through") {
    speed = TUNING.control.throughSpeedMps;
    lift = TUNING.control.throughLiftMps;
    if (target !== null) {
      targetX =
        target.x +
        attackDirection * TUNING.control.throughLeadM +
        target.vx * TUNING.control.passLeadSeconds;
      targetY =
        target.y + target.vy * TUNING.control.passLeadSeconds;
    } else {
      targetX = state.ball.x + aim.x * 20;
      targetY = state.ball.y + aim.y * 20;
    }
  } else if (kind === "lob") {
    speed = TUNING.control.lobSpeedMps;
    lift = TUNING.control.lobLiftMps;
    if (target !== null) {
      targetX =
        target.x + target.vx * TUNING.control.passLeadSeconds;
      targetY =
        target.y + target.vy * TUNING.control.passLeadSeconds;
    } else {
      targetX = state.ball.x + aim.x * 25;
      targetY = state.ball.y + aim.y * 25;
    }
  } else {
    speed = TUNING.control.passSpeedMps;
    lift = TUNING.control.passLiftMps;
    if (target !== null) {
      targetX =
        target.x + target.vx * TUNING.control.passLeadSeconds;
      targetY =
        target.y + target.vy * TUNING.control.passLeadSeconds;
    } else {
      targetX = state.ball.x + aim.x * 18;
      targetY = state.ball.y + aim.y * 18;
    }
  }

  targetX = clamp(
    targetX,
    TUNING.player.pitchMarginM,
    state.pitch.lengthM - TUNING.player.pitchMarginM,
  );
  targetY = clamp(
    targetY,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );

  if (!beginKick(state, player, "pass")) {
    return false;
  }

  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed,
    lift,
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  player.state = "pass";
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = TUNING.control.passCooldownSeconds;
  return true;
}

export function playShot(
  state: MatchState,
  player: PlayerState,
  aimX: number,
  aimY: number,
  power01: number,
  finesse: boolean,
): boolean {
  if (!canPlayBall(state, player)) {
    return false;
  }

  const team = player.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const ballRadius = TUNING.ball.radiusM;
  const inset = ballRadius * 2;
  const maxOffset =
    (goal.widthM / 2 - inset) * TUNING.control.shotAimSpreadFactor;
  const aimLength = Math.hypot(aimX, aimY);
  const offset =
    aimLength >= TUNING.control.aimDeadzone
      ? clamp(aimY, -1, 1) * maxOffset
      : 0;
  const targetY = goal.centreY + offset;
  const targetX = goal.lineX + goal.netDirection * TUNING.ai.shootAimDepthM;

  const power = clamp(power01, 0, 1);
  const speed =
    lerp(
      TUNING.control.minShotSpeedMps,
      TUNING.control.maxShotSpeedMps,
      power,
    ) * (finesse ? TUNING.control.finesseSpeedFactor : 1);
  const lift = lerp(
    TUNING.control.minShotLiftMps,
    TUNING.control.maxShotLiftMps,
    power,
  );
  const curveSign = offset >= 0 ? 1 : -1;

  if (!beginKick(state, player, "shot")) {
    return false;
  }

  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed,
    lift,
    spinY: -TUNING.control.shotBackspinRadPerS,
    spinZ: finesse
      ? curveSign * TUNING.control.finesseCurveSpinRadPerS
      : 0,
    velocityTransfer: TUNING.ai.shootVelocityTransfer,
  });
  player.state = "shoot";
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = TUNING.player.kickCooldownSeconds;
  return true;
}

export function playTackle(
  state: MatchState,
  player: PlayerState,
): boolean {
  if (player.kickCooldown > 0 || player.sentOff) {
    return false;
  }

  const distance = Math.hypot(
    state.ball.x - player.x,
    state.ball.y - player.y,
  );
  const canWin =
    distance <= TUNING.control.tackleRangeM &&
    state.ball.z <= TUNING.ai.controlMaxBallHeightM;
  const opponents =
    player.team === "home" ? state.away : state.home;
  const victim = findTackleVictim(opponents.players, player);

  player.state = "slide";
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = TUNING.control.tackleCooldownSeconds;

  if (victim !== null && commitTackleFoul(state, player, victim, canWin)) {
    return true;
  }

  if (!canWin) {
    return false;
  }

  const team = player.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const dx = goal.lineX - state.ball.x;
  const dy = goal.centreY - state.ball.y;
  const distanceToGoal = Math.hypot(dx, dy);
  const dirX = distanceToGoal > 1e-6 ? dx / distanceToGoal : 1;
  const dirY = distanceToGoal > 1e-6 ? dy / distanceToGoal : 0;

  state.ball.vx = dirX * TUNING.control.tackleBallSpeedMps;
  state.ball.vy = dirY * TUNING.control.tackleBallSpeedMps;
  state.ball.vz = TUNING.control.tackleLiftMps;
  state.ball.z = TUNING.ball.radiusM;
  state.lastTouch = {
    team: player.team,
    playerId: player.id,
    playerNumber: player.number,
  };
  return true;
}

function canPlayBall(
  state: MatchState,
  player: PlayerState,
): boolean {
  if (player.kickCooldown > 0 || player.sentOff) {
    return false;
  }
  const distance = Math.hypot(
    state.ball.x - player.x,
    state.ball.y - player.y,
  );
  return (
    distance <= TUNING.control.actionBallReachM &&
    state.ball.z <= TUNING.ai.controlMaxBallHeightM
  );
}

function resolveAim(
  player: PlayerState,
  aimX: number,
  aimY: number,
): AimVector {
  const length = Math.hypot(aimX, aimY);
  if (
    Number.isFinite(length) &&
    length >= TUNING.control.aimDeadzone
  ) {
    return { x: aimX / length, y: aimY / length };
  }
  return { x: Math.cos(player.facing), y: Math.sin(player.facing) };
}

function findPassTarget(
  state: MatchState,
  player: PlayerState,
  aim: AimVector,
): PlayerState | null {
  const teammates =
    player.team === "home" ? state.home.players : state.away.players;
  let best: PlayerState | null = null;
  let bestScore = -Infinity;

  for (const teammate of teammates) {
    if (teammate === player) {
      continue;
    }
    const dx = teammate.x - state.ball.x;
    const dy = teammate.y - state.ball.y;
    const distance = Math.hypot(dx, dy);
    if (
      distance < TUNING.ai.minPassDistanceM ||
      distance > TUNING.control.passSearchRangeM
    ) {
      continue;
    }
    const dot =
      distance > 1e-6 ? (dx / distance) * aim.x + (dy / distance) * aim.y : 0;
    if (dot < TUNING.control.passConeCos) {
      continue;
    }
    const score = dot + (1 - distance / TUNING.control.passSearchRangeM);
    if (score > bestScore) {
      bestScore = score;
      best = teammate;
    }
  }

  return best;
}
