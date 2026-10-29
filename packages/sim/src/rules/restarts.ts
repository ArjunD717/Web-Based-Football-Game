// packages/sim/src/rules/restarts.ts
import { TUNING, clamp } from "@fb/shared";
import { baseFormationPositionNormalized } from "../formations";
import {
  getAttackingGoalForDirection,
  getDefendingGoalForDirection,
  isInsideOwnPenaltyArea,
} from "../pitch";
import type {
  MatchState,
  PlayerState,
  TeamSide,
  TeamState,
} from "../types";

/**
 * Position players and the ball for a restart. These functions are deliberately
 * geometry-only; the referee owns the phase/timer transition.
 */

export function setupKickoff(state: MatchState, side: TeamSide): string | null {
  const home = state.home;
  const away = state.away;
  settleAllPlayers(state);
  state.lastTouch = null;
  state.referee.throwIn = null;

  const kickoffTeam = side === "home" ? home : away;
  const taker =
    kickoffTeam.players.find((player) => player.role === "ST") ??
    kickoffTeam.players.find((player) => player.role === "CF") ??
    kickoffTeam.players[0] ??
    null;

  for (const team of [home, away]) {
    for (const player of team.players) {
      const base = baseFormationPositionNormalized(
        state.pitch,
        team.side,
        player.formationX,
        player.formationY,
        team.attackDirection,
      );
      const ownHalfX =
        team.attackDirection === 1
          ? clamp(
              base.x,
              TUNING.player.pitchMarginM,
              state.pitch.centreX - TUNING.player.pitchMarginM,
            )
          : clamp(
              base.x,
              state.pitch.centreX + TUNING.player.pitchMarginM,
              state.pitch.lengthM - TUNING.player.pitchMarginM,
            );
      let x = ownHalfX;
      let y = clamp(
        base.y,
        TUNING.player.pitchMarginM,
        state.pitch.widthM - TUNING.player.pitchMarginM,
      );

      if (player === taker) {
        x = state.pitch.centreX - team.attackDirection * TUNING.match.kickoffTakerOffsetM;
        y = state.pitch.centreY;
      } else {
        const minDistance =
          TUNING.match.centreCircleRadiusM + TUNING.match.kickoffClearanceM;
        if (Math.hypot(x - state.pitch.centreX, y - state.pitch.centreY) < minDistance) {
          const dy = y - state.pitch.centreY;
          const span = Math.sqrt(
            Math.max(0, minDistance * minDistance - dy * dy),
          );
          x =
            team.attackDirection === 1
              ? Math.min(x, state.pitch.centreX - span)
              : Math.max(x, state.pitch.centreX + span);
          x = clamp(
            x,
            TUNING.player.pitchMarginM,
            state.pitch.lengthM - TUNING.player.pitchMarginM,
          );
        }
      }

      placePlayer(player, x, y, team.attackDirection === 1 ? 0 : Math.PI);
    }
  }

  ballAt(state, state.pitch.centreX, state.pitch.centreY);
  return taker?.id ?? null;
}

export function setupThrowIn(
  state: MatchState,
  side: TeamSide,
  x: number,
  y: number,
): string | null {
  settleAllPlayers(state);
  state.referee.throwIn = null;

  const spotX = clamp(x, 0, state.pitch.lengthM);
  const spotY = y <= 0 ? 0 : state.pitch.widthM;
  const team = side === "home" ? state.home : state.away;
  const taker = nearestOutfield(team, spotX, spotY) ?? team.players[0] ?? null;
  const inset = TUNING.match.throwInTakerInsetM;
  const takerY = spotY === 0 ? inset : state.pitch.widthM - inset;

  if (taker !== null) {
    placePlayer(
      taker,
      clamp(spotX, TUNING.player.pitchMarginM, state.pitch.lengthM - TUNING.player.pitchMarginM),
      takerY,
      spotY === 0 ? Math.PI / 2 : -Math.PI / 2,
    );
  }

  const opponents = side === "home" ? state.away : state.home;
  for (const player of opponents.players) {
    pushOutOfRadius(
      state,
      player,
      spotX,
      spotY,
      TUNING.match.throwInOpponentDistanceM,
    );
  }

  ballAt(state, spotX, spotY);
  return taker?.id ?? null;
}

export function setupGoalKick(
  state: MatchState,
  side: TeamSide,
): string | null {
  settleAllPlayers(state);
  state.referee.throwIn = null;

  const team = side === "home" ? state.home : state.away;
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const inward = -goal.netDirection;
  const spotX =
    goal.lineX + inward * TUNING.match.goalKickSpotFromLineM;
  const taker =
    team.players.find((player) => player.role === "GK") ??
    team.players[0] ??
    null;

  if (taker !== null) {
    placePlayer(
      taker,
      spotX - inward * TUNING.match.goalKickTakerBehindBallM,
      state.pitch.centreY,
      team.attackDirection === 1 ? 0 : Math.PI,
    );
  }

  const opponents = side === "home" ? state.away : state.home;
  const edgeX =
    goal.lineX +
    inward *
      (state.pitch.penaltyAreaLengthM +
        TUNING.match.goalKickOpponentClearanceM);
  for (const player of opponents.players) {
    if (
      isInsideOwnPenaltyArea(
        state.pitch,
        team.attackDirection,
        player.x,
        player.y,
      )
    ) {
      placePlayer(
        player,
        edgeX,
        clamp(
          player.y,
          TUNING.player.pitchMarginM,
          state.pitch.widthM - TUNING.player.pitchMarginM,
        ),
        team.attackDirection === 1 ? Math.PI : 0,
      );
    }
  }

  ballAt(state, spotX, state.pitch.centreY);
  return taker?.id ?? null;
}

export function setupCorner(
  state: MatchState,
  side: TeamSide,
  cornerX: number,
  cornerY: number,
): string | null {
  settleAllPlayers(state);
  state.referee.throwIn = null;

  const team = side === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const inward = -goal.netDirection;
  const spotX = cornerX <= state.pitch.centreX ? 0 : state.pitch.lengthM;
  const spotY = cornerY <= state.pitch.centreY ? 0 : state.pitch.widthM;
  const taker = nearestOutfield(team, spotX, spotY) ?? team.players[0] ?? null;
  const inset = TUNING.match.cornerTakerInsetM;

  if (taker !== null) {
    placePlayer(
      taker,
      spotX + inward * inset,
      spotY === 0 ? inset : state.pitch.widthM - inset,
      Math.atan2(spotY === 0 ? 1 : -1, inward),
    );
  }

  const opponents = side === "home" ? state.away : state.home;
  const minDistance = TUNING.match.cornerOpponentDistanceM;
  for (const player of opponents.players) {
    const distance = Math.hypot(player.x - spotX, player.y - spotY);
    if (distance >= minDistance) {
      continue;
    }
    // Move along the safest axis: away from the corner, then clamp into the
    // pitch. This guarantees the law's 9.15 m clearance at both corners.
    if (spotY === 0) {
      player.y = Math.min(state.pitch.widthM - TUNING.player.pitchMarginM, minDistance);
    } else {
      player.y = Math.max(
        TUNING.player.pitchMarginM,
        state.pitch.widthM - minDistance,
      );
    }
    player.x = clamp(
      player.x,
      TUNING.player.pitchMarginM,
      state.pitch.lengthM - TUNING.player.pitchMarginM,
    );
    zeroMotion(player);
    player.targetX = player.x;
    player.targetY = player.y;
  }

  ballAt(state, spotX, spotY);
  return taker?.id ?? null;
}

function nearestOutfield(
  team: TeamState,
  x: number,
  y: number,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Infinity;
  for (const player of team.players) {
    if (player.role === "GK") {
      continue;
    }
    const distance = Math.hypot(player.x - x, player.y - y);
    if (distance < bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }
  return best;
}

function settleAllPlayers(state: MatchState): void {
  for (const team of [state.home, state.away]) {
    for (const player of team.players) {
      zeroMotion(player);
      player.state = "idle";
      player.actionTimer = 0;
      player.kickCooldown = 0;
      player.isUserControlled = false;
      player.targetX = player.x;
      player.targetY = player.y;
      player.targetSpeed = 0;
    }
  }
}

function zeroMotion(player: PlayerState): void {
  player.vx = 0;
  player.vy = 0;
}

function placePlayer(
  player: PlayerState,
  x: number,
  y: number,
  facing: number,
): void {
  player.x = x;
  player.y = y;
  player.facing = facing;
  zeroMotion(player);
  player.targetX = x;
  player.targetY = y;
  player.targetSpeed = 0;
}

function ballAt(state: MatchState, x: number, y: number): void {
  state.ball.x = x;
  state.ball.y = y;
  state.ball.z = TUNING.ball.radiusM;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
  state.ball.spinX = 0;
  state.ball.spinY = 0;
  state.ball.spinZ = 0;
}

function pushOutOfRadius(
  state: MatchState,
  player: PlayerState,
  x: number,
  y: number,
  radius: number,
): void {
  const dx = player.x - x;
  const dy = player.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) {
    return;
  }
  const ux = distance > 1e-6 ? dx / distance : 0;
  const uy = distance > 1e-6 ? dy / distance : y <= state.pitch.centreY ? 1 : -1;
  let nextX = x + ux * radius;
  let nextY = y + uy * radius;
  nextX = clamp(
    nextX,
    TUNING.player.pitchMarginM,
    state.pitch.lengthM - TUNING.player.pitchMarginM,
  );
  nextY = clamp(
    nextY,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );
  if (Math.hypot(nextX - x, nextY - y) < radius - 1e-6) {
    nextY = y <= state.pitch.centreY ? Math.min(state.pitch.widthM, radius) : Math.max(0, state.pitch.widthM - radius);
  }
  player.x = nextX;
  player.y = nextY;
  zeroMotion(player);
  player.targetX = nextX;
  player.targetY = nextY;
}
