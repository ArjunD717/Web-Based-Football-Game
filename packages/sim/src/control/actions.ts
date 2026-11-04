// packages/sim/src/control/actions.ts
import { TUNING, clamp, lerp } from "@fb/shared";
import {
  getAttackingGoalForDirection,
} from "../pitch";
import { kickBall } from "../physics/ball";
import { eventRng } from "../random";
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
  power01: number = TUNING.control.minPassPower,
): boolean {
  if (!canPlayBall(state, player)) {
    return false;
  }

  const power = clamp(
    power01,
    TUNING.control.minPassPower,
    1,
  );
  const charge = clamp(
    (power - TUNING.control.minPassPower) /
      Math.max(1e-6, 1 - TUNING.control.minPassPower),
    0,
    1,
  );

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
    speed = lerp(
      TUNING.control.throughSpeedMps,
      TUNING.control.maxThroughSpeedMps,
      charge,
    );
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
    speed = lerp(
      TUNING.control.lobSpeedMps,
      TUNING.control.maxLobSpeedMps,
      charge,
    );
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
    speed = lerp(
      TUNING.control.passSpeedMps,
      TUNING.control.maxPassSpeedMps,
      charge,
    );
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

/**
 * Nudge the ball ahead of a running player. This is the human close-control
 * touch: it is intentionally separate from the AI dribble so its error curve
 * and touch cadence stay under player control and can be tuned independently.
 */
export function playDribbleTouch(
  state: MatchState,
  player: PlayerState,
  aimX: number,
  aimY: number,
  sprinting: boolean,
): boolean {
  if (player.kickCooldown > 0 || player.sentOff) {
    return false;
  }
  const distanceToBall = Math.hypot(
    state.ball.x - player.x,
    state.ball.y - player.y,
  );
  if (
    distanceToBall > TUNING.control.dribbleAcquireRadiusM ||
    state.ball.z > TUNING.ai.controlMaxBallHeightM
  ) {
    return false;
  }

  const aim = resolveAim(player, aimX, aimY);
  const control = clamp(
    (player.attributes.ballControl + player.attributes.dribbling) / 198,
    0,
    1,
  );
  const nearestOpponent = nearestOpponentDistance(state, player);
  const pressure =
    nearestOpponent === null
      ? 0
      : clamp(
          1 -
            nearestOpponent / TUNING.control.dribblePressureDistanceM,
          0,
          1,
        );
  const rng = eventRng(state.seed, state.tick, player.number);
  const error =
    lerp(
      TUNING.control.dribbleMaxErrorRad,
      TUNING.control.dribbleMinErrorRad,
      control,
    ) +
    pressure * TUNING.control.dribblePressureErrorRad;
  const angle = Math.atan2(aim.y, aim.x) + rng.range(-error, error);
  const playerSpeed = Math.hypot(player.vx, player.vy);
  const targetDistance =
    TUNING.control.dribbleTouchDistanceM +
    (sprinting ? TUNING.control.dribbleSprintDistanceBonusM : 0);
  const speed =
    playerSpeed +
    TUNING.control.dribbleTouchSpeedMps +
    (sprinting ? TUNING.control.dribbleSprintSpeedBonusMps : 0);
  const targetX = clamp(
    player.x + Math.cos(angle) * targetDistance,
    TUNING.player.pitchMarginM,
    state.pitch.lengthM - TUNING.player.pitchMarginM,
  );
  const targetY = clamp(
    player.y + Math.sin(angle) * targetDistance,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );

  if (!beginKick(state, player, "dribble")) {
    return false;
  }
  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed,
    lift: TUNING.control.dribbleTouchLiftMps,
    velocityTransfer: TUNING.control.dribbleVelocityTransfer,
  });
  return true;
}

/**
 * A short, deliberate touch in a player-relative direction. Skill stars and
 * close-control reduce the aim error; the touch is intentionally not a pass or
 * shot, so it uses its own cooldown and stamina cost.
 */
export function playSkillMove(
  state: MatchState,
  player: PlayerState,
  dirX: number,
  dirY: number,
): boolean {
  if (player.kickCooldown > 0 || player.sentOff) {
    return false;
  }
  const distanceToBall = Math.hypot(
    state.ball.x - player.x,
    state.ball.y - player.y,
  );
  if (
    distanceToBall > TUNING.control.dribbleAcquireRadiusM ||
    state.ball.z > TUNING.ai.controlMaxBallHeightM
  ) {
    return false;
  }
  const length = Math.hypot(dirX, dirY);
  if (!Number.isFinite(length) || length < 1e-6) {
    return false;
  }

  const technique = clamp(
    (player.attributes.dribbling +
      player.attributes.ballControl +
      player.attributes.agility) /
      297,
    0,
    1,
  );
  const stars = clamp(
    (player.attributes.skillMoves - 1) / 4,
    0,
    1,
  );
  const quality = technique * 0.6 + stars * 0.4;
  const error = lerp(
    TUNING.control.skillMaxErrorRad,
    TUNING.control.skillMinErrorRad,
    quality,
  );
  const rng = eventRng(state.seed, state.tick, player.number);
  const angle =
    Math.atan2(dirY, dirX) + rng.range(-error, error);
  const targetDistance =
    TUNING.control.skillTouchDistanceM + technique * 0.25;
  const speed =
    Math.hypot(player.vx, player.vy) +
    TUNING.control.skillTouchSpeedMps +
    quality * 0.5;
  const targetX = clamp(
    player.x + Math.cos(angle) * targetDistance,
    TUNING.player.pitchMarginM,
    state.pitch.lengthM - TUNING.player.pitchMarginM,
  );
  const targetY = clamp(
    player.y + Math.sin(angle) * targetDistance,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );

  if (!beginKick(state, player, "dribble")) {
    return false;
  }
  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed,
    lift: TUNING.control.skillTouchLiftMps,
    velocityTransfer: TUNING.control.dribbleVelocityTransfer,
  });
  player.state = "dribble";
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = TUNING.control.skillMoveCooldownSeconds;
  player.stamina = Math.max(
    0,
    player.stamina - TUNING.control.skillStaminaCost,
  );
  return true;
}

function nearestOpponentDistance(
  state: MatchState,
  player: PlayerState,
): number | null {
  const opponents =
    player.team === "home" ? state.away.players : state.home.players;
  let nearest: number | null = null;
  for (const opponent of opponents) {
    if (opponent.sentOff || opponent.unavailable) {
      continue;
    }
    const distance = Math.hypot(
      opponent.x - player.x,
      opponent.y - player.y,
    );
    if (nearest === null || distance < nearest) {
      nearest = distance;
    }
  }
  return nearest;
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
  slide = true,
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

  player.state = slide ? "slide" : "tackle";
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
