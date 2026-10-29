// packages/sim/src/ai/context.ts

import { TUNING, clamp } from "@fb/shared";
import { baseFormationPositionNormalized } from "../formations";
import { heldBySetPiece } from "../rules/referee";
import type {
  AttackDirection,
  MatchState,
  PlayerState,
  TeamSide,
  TeamState,
} from "../types";
import {
  isDefensiveRole,
  roleProfile,
} from "./profiles";

export interface NearestPlayer {
  readonly player: PlayerState;
  readonly distance: number;
}

export interface BallContext {
  readonly speedMps: number;
  readonly nearestHome: NearestPlayer | null;
  readonly nearestAway: NearestPlayer | null;
  readonly owner: PlayerState | null;
  readonly ownerSide: TeamSide | null;
}

export type AiPhase = "attack" | "defend" | "loose";

export interface AiTeamPlan {
  readonly side: TeamSide;
  readonly phase: AiPhase;
  readonly owner: PlayerState | null;
  readonly presserId: string | null;
  readonly secondPresserId: string | null;
  readonly receiverId: string | null;
  readonly coverId: string | null;
  readonly supportIds: readonly string[];
  readonly runnerIds: readonly string[];
  readonly overlapId: string | null;
  /** Target world x for the back line. */
  readonly lineX: number;
  /** Law 11 boundary for this team when it attacks. */
  readonly offsideLineX: number;
}

export function nearestPlayerTo(
  state: MatchState,
  team: TeamState,
  x: number,
  y: number,
  includeKeeper = true,
): NearestPlayer | null {
  let best: NearestPlayer | null = null;
  for (const player of team.players) {
    if (
      player.sentOff ||
      (!includeKeeper && player.role === "GK") ||
      heldBySetPiece(state, player)
    ) {
      continue;
    }
    const distance = Math.hypot(player.x - x, player.y - y);
    if (best === null || distance < best.distance) {
      best = { player, distance };
    }
  }
  return best;
}

export function nearestOutfieldTo(
  state: MatchState,
  team: TeamState,
  x: number,
  y: number,
): NearestPlayer | null {
  return nearestPlayerTo(state, team, x, y, false);
}

export function analyseBall(state: MatchState): BallContext {
  const speedMps = Math.hypot(state.ball.vx, state.ball.vy);
  const nearestHome = nearestPlayerTo(
    state,
    state.home,
    state.ball.x,
    state.ball.y,
  );
  const nearestAway = nearestPlayerTo(
    state,
    state.away,
    state.ball.x,
    state.ball.y,
  );
  const nearest =
    nearestHome === null
      ? nearestAway
      : nearestAway === null
        ? nearestHome
        : nearestHome.distance <= nearestAway.distance
          ? nearestHome
          : nearestAway;

  const owner =
    nearest !== null &&
    nearest.distance <= TUNING.ai.possessionRadiusM &&
    speedMps <= TUNING.ai.possessionMaxBallSpeedMps
      ? nearest.player
      : null;

  return {
    speedMps,
    nearestHome,
    nearestAway,
    owner,
    ownerSide: owner?.team ?? null,
  };
}

/** Law 11: the second-last opponent, never behind the ball. */
export function offsideLineFor(
  state: MatchState,
  team: TeamState,
): number {
  const opponents =
    team.side === "home" ? state.away : state.home;
  const xs = opponents.players
    .filter((player) => !player.sentOff)
    .map((player) => player.x)
    .sort((a, b) =>
      team.attackDirection === 1 ? b - a : a - b,
    );
  const secondLast = xs[1];
  if (secondLast === undefined) {
    return team.attackDirection === 1
      ? state.pitch.lengthM
      : 0;
  }
  return team.attackDirection === 1
    ? Math.max(secondLast, state.ball.x)
    : Math.min(secondLast, state.ball.x);
}

export function planTeam(
  state: MatchState,
  team: TeamState,
  ball: BallContext,
): AiTeamPlan {
  const phase: AiPhase =
    ball.ownerSide === null
      ? "loose"
      : ball.ownerSide === team.side
        ? "attack"
        : "defend";
  const outfield = team.players.filter(
    (player) => !player.sentOff && player.role !== "GK",
  );
  const nearest = nearestOutfieldTo(
    state,
    team,
    state.ball.x,
    state.ball.y,
  );

  const presserId =
    phase === "defend" || phase === "loose"
      ? nearest?.player.id ?? null
      : null;
  const secondPresserId =
    presserId !== null && shouldSecondPress(state, team, phase, ball)
      ? secondNearestOutfield(state, team, presserId)?.player.id ?? null
      : null;

  const coverId =
    phase === "defend"
      ? selectCover(state, team, presserId, secondPresserId)
      : null;
  const explicitOffsideTarget =
    phase === "loose" &&
    state.lastTouch?.team === team.side &&
    state.offsidePassTargetId !== null &&
    team.players.some(
      (player) =>
        player.id === state.offsidePassTargetId && !player.sentOff,
    )
      ? state.offsidePassTargetId
      : null;
  const receiverId =
    explicitOffsideTarget ??
    (phase === "loose" && state.lastTouch?.team === team.side
      ? selectReceiver(state, team)
      : null);

  const supportIds =
    phase === "attack" && ball.owner !== null
      ? outfield
          .filter((player) => player.id !== ball.owner?.id)
          .map((player) => ({
            id: player.id,
            distance: Math.hypot(
              player.x - ball.owner!.x,
              player.y - ball.owner!.y,
            ),
          }))
          .sort(
            (a, b) =>
              a.distance - b.distance || a.id.localeCompare(b.id),
          )
          .slice(0, 2)
          .map((entry) => entry.id)
      : [];

  const runnerIds =
    phase === "attack"
      ? selectRunners(team, ball.owner?.id ?? null)
      : [];
  const overlapId =
    phase === "attack"
      ? selectOverlap(state, team, ball.owner?.id ?? null)
      : null;

  return {
    side: team.side,
    phase,
    owner: ball.owner,
    presserId,
    secondPresserId,
    receiverId,
    coverId,
    supportIds,
    runnerIds,
    overlapId,
    lineX: defensiveLineX(state, team, phase),
    offsideLineX: phase === "attack" ? offsideLineFor(state, team) : 0,
  };
}

function selectReceiver(
  state: MatchState,
  team: TeamState,
): string | null {
  const projectionX =
    state.ball.x + state.ball.vx * TUNING.ai.receiverProjectionSeconds;
  const projectionY =
    state.ball.y + state.ball.vy * TUNING.ai.receiverProjectionSeconds;
  const nearest = nearestOutfieldTo(
    state,
    team,
    projectionX,
    projectionY,
  );
  return nearest !== null &&
    nearest.distance <= TUNING.ai.receiverMaxDistanceM
    ? nearest.player.id
    : null;
}

function shouldSecondPress(
  state: MatchState,
  team: TeamState,
  phase: AiPhase,
  ball: BallContext,
): boolean {
  const nearest = nearestOutfieldTo(
    state,
    team,
    state.ball.x,
    state.ball.y,
  );
  if (nearest === null) {
    return false;
  }
  const pressFactor = pressIntensityFactor(team);
  if (
    phase === "defend" &&
    team.tactics.pressIntensity === "high" &&
    nearest.distance <= TUNING.ai.pressSecondTriggerRadiusM * pressFactor
  ) {
    return true;
  }
  return (
    phase === "loose" &&
    ball.nearestHome !== null &&
    ball.nearestAway !== null &&
    nearest.distance <= TUNING.ai.looseBallSecondChaserM
  );
}

function secondNearestOutfield(
  state: MatchState,
  team: TeamState,
  excludedId: string,
): NearestPlayer | null {
  let best: NearestPlayer | null = null;
  for (const player of team.players) {
    if (
      player.sentOff ||
      player.role === "GK" ||
      player.id === excludedId ||
      heldBySetPiece(state, player)
    ) {
      continue;
    }
    const distance = Math.hypot(
      player.x - state.ball.x,
      player.y - state.ball.y,
    );
    if (best === null || distance < best.distance) {
      best = { player, distance };
    }
  }
  return best;
}

function selectCover(
  state: MatchState,
  team: TeamState,
  presserId: string | null,
  secondPresserId: string | null,
): string | null {
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const player of team.players) {
    if (
      player.sentOff ||
      player.role === "GK" ||
      player.id === presserId ||
      player.id === secondPresserId ||
      heldBySetPiece(state, player)
    ) {
      continue;
    }
    const profile = roleProfile(player.role);
    const distance = Math.hypot(
      player.x - state.ball.x,
      player.y - state.ball.y,
    );
    const score =
      profile.cover * 100 -
      distance * 0.5 +
      (isDefensiveRole(player.role) ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best?.id ?? null;
}

function selectRunners(
  team: TeamState,
  ownerId: string | null,
): string[] {
  return team.players
    .filter(
      (player) =>
        !player.sentOff &&
        player.role !== "GK" &&
        player.id !== ownerId &&
        roleProfile(player.role).runInBehind >= 0.4,
    )
    .map((player) => ({
      id: player.id,
      score:
        roleProfile(player.role).runInBehind * 100 +
        player.attributes.attPosition * 0.25,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((entry) => entry.id);
}

function selectOverlap(
  state: MatchState,
  team: TeamState,
  ownerId: string | null,
): string | null {
  const fullbacks = team.players.filter(
    (player) =>
      !player.sentOff &&
      player.id !== ownerId &&
      (player.role === "RB" || player.role === "LB"),
  );
  if (fullbacks.length === 0) {
    return null;
  }
  return fullbacks.sort(
    (a, b) =>
      Math.abs(a.y - state.ball.y) - Math.abs(b.y - state.ball.y) ||
      a.id.localeCompare(b.id),
  )[0]?.id ?? null;
}

function defensiveLineX(
  state: MatchState,
  team: TeamState,
  phase: AiPhase,
): number {
  const backs = team.players.filter(
    (player) => !player.sentOff && isDefensiveRole(player.role),
  );
  const fallback = team.players.find((player) => player.role === "GK");
  const basePositions = (backs.length > 0 ? backs : fallback === undefined ? [] : [fallback])
    .map((player) =>
      baseFormationPositionNormalized(
        state.pitch,
        team.side,
        player.formationX,
        player.formationY,
        team.attackDirection,
      ).x,
    );
  const base =
    basePositions.length === 0
      ? state.pitch.centreX
      : basePositions.reduce((total, x) => total + x, 0) /
        basePositions.length;
  const direction = team.attackDirection;
  const depthOffset =
    ((team.tactics.defensiveDepth - 50) / 50) *
    TUNING.ai.depthShiftM *
    direction;
  const ballPull = clamp(
    (state.ball.x - base) * 0.35,
    -TUNING.ai.lineBallInfluenceM,
    TUNING.ai.lineBallInfluenceM,
  );
  const phaseBias =
    phase === "attack" ? TUNING.ai.depthShiftM * 0.25 * direction : 0;
  return clamp(
    base + depthOffset + ballPull + phaseBias,
    TUNING.player.pitchMarginM,
    state.pitch.lengthM - TUNING.player.pitchMarginM,
  );
}

export function pressIntensityFactor(team: TeamState): number {
  switch (team.tactics.pressIntensity) {
    case "low":
      return 0.78;
    case "high":
      return 1.22;
    case "medium":
      return 1;
  }
}

export function teamForSide(
  state: MatchState,
  side: TeamSide,
): TeamState {
  return side === "home" ? state.home : state.away;
}

export function opponentForSide(
  state: MatchState,
  side: TeamSide,
): TeamState {
  return side === "home" ? state.away : state.home;
}

export function directionTowardAttack(team: TeamState): AttackDirection {
  return team.attackDirection;
}
