// packages/sim/src/rules/management.ts

import { TUNING, positionFamiliarity, type PlayerPosition } from "@fb/shared";
import type {
  MatchState,
  PlayerState,
  SubstitutePlayer,
  TeamSide,
  TeamState,
} from "../types";

export interface SubstitutionChange {
  /** Active player leaving the pitch. */
  readonly outId: string;
  /** Bench player entering the pitch. */
  readonly inId: string;
}

export interface SubstitutionResult {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly applied: number;
  readonly windowUsed: boolean;
}

export function isAvailablePlayer(player: PlayerState): boolean {
  return !player.sentOff && !player.unavailable;
}

export function activePlayers(team: TeamState): PlayerState[] {
  return team.players.filter(isAvailablePlayer);
}

export function activePlayerCount(team: TeamState): number {
  return activePlayers(team).length;
}

/** The laws allow substitutions only while the ball is dead or at half-time. */
export function substitutionsAllowed(state: MatchState): boolean {
  return (
    state.referee.phase === "deadBall" ||
    state.referee.phase === "halfTime"
  );
}

export function maxSubstitutions(state: MatchState): number {
  return (
    TUNING.management.maxSubstitutions +
    (state.referee.half >= 3
      ? TUNING.management.extraTimeSubstitutions
      : 0)
  );
}

export function maxWindows(state: MatchState): number {
  return (
    TUNING.management.maxWindows +
    (state.referee.half >= 3 ? TUNING.management.extraTimeWindows : 0)
  );
}

/**
 * Apply one or more changes as a single substitution window. The caller can
 * group all changes made during one stoppage; half-time changes are free.
 */
export function applySubstitutions(
  state: MatchState,
  side: TeamSide,
  changes: readonly SubstitutionChange[],
): SubstitutionResult {
  if (changes.length === 0) {
    return { ok: false, reason: "No substitutions requested", applied: 0, windowUsed: false };
  }
  if (!substitutionsAllowed(state)) {
    return {
      ok: false,
      reason: "Substitutions are only allowed during a stoppage",
      applied: 0,
      windowUsed: false,
    };
  }
  const team = side === "home" ? state.home : state.away;
  if (team.substitutionsUsed + changes.length > maxSubstitutions(state)) {
    return {
      ok: false,
      reason: "No substitution allowance remains",
      applied: 0,
      windowUsed: false,
    };
  }

  let windowUsed = false;
  if (state.referee.phase !== "halfTime" && !team.substitutionWindowUsed) {
    if (team.substitutionWindowsUsed >= maxWindows(state)) {
      return {
        ok: false,
        reason: "No substitution window remains",
        applied: 0,
        windowUsed: false,
      };
    }
    windowUsed = true;
  }

  const outgoing: { index: number; player: PlayerState; incoming: SubstitutePlayer }[] = [];
  const seenOut = new Set<string>();
  const seenIn = new Set<string>();
  for (const change of changes) {
    if (seenOut.has(change.outId) || seenIn.has(change.inId)) {
      return { ok: false, reason: "Duplicate substitution player", applied: 0, windowUsed: false };
    }
    seenOut.add(change.outId);
    seenIn.add(change.inId);
    const index = team.players.findIndex((player) => player.id === change.outId);
    const player = team.players[index];
    const incomingIndex = team.bench.findIndex(
      (substitute) => substitute.player.id === change.inId,
    );
    const incoming = team.bench[incomingIndex];
    if (index < 0 || player === undefined) {
      return { ok: false, reason: "Outgoing player is not active", applied: 0, windowUsed: false };
    }
    if (incomingIndex < 0 || incoming === undefined) {
      return { ok: false, reason: "Incoming player is not on the bench", applied: 0, windowUsed: false };
    }
    if (player.sentOff) {
      return { ok: false, reason: "A sent-off player cannot be replaced", applied: 0, windowUsed: false };
    }
    if (
      player.role === "GK" &&
      !incoming.positions.includes("GK")
    ) {
      return { ok: false, reason: "The goalkeeper must be replaced by a goalkeeper", applied: 0, windowUsed: false };
    }
    outgoing.push({ index, player, incoming });
  }
  if (outgoing.length === 0) {
    return { ok: false, reason: "No eligible outgoing player", applied: 0, windowUsed: false };
  }

  for (const change of outgoing) {
    const incoming = change.incoming.player;
    const replacement = enterFromBench(
      change.player,
      incoming,
      change.incoming.positions,
      change.incoming.preferredPosition,
    );
    team.players[change.index] = replacement;
    for (const key of ["penalty", "freeKick", "cornerLeft", "cornerRight"] as const) {
      if (team.takers[key] === change.player.id) {
        team.takers[key] = replacement.id;
      }
    }
  }
  // Remove bench players only after all changes have passed validation.
  const usedIds = new Set(outgoing.map((change) => change.incoming.player.id));
  team.bench.splice(
    0,
    team.bench.length,
    ...team.bench.filter((substitute) => !usedIds.has(substitute.player.id)),
  );
  team.substitutionsUsed += outgoing.length;
  if (windowUsed) {
    team.substitutionWindowsUsed += 1;
    team.substitutionWindowUsed = true;
  }
  return {
    ok: true,
    reason: null,
    applied: outgoing.length,
    windowUsed,
  };
}

function enterFromBench(
  outgoing: PlayerState,
  incoming: PlayerState,
  positions: readonly PlayerPosition[],
  preferredPosition: PlayerPosition,
): PlayerState {
  return {
    ...incoming,
    role: outgoing.role,
    number: incoming.number,
    roleFamiliarity: positionFamiliarity(
      { positions, preferredPosition },
      outgoing.role === "GK" ? "GK" : outgoing.role,
    ),
    formationX: outgoing.formationX,
    formationY: outgoing.formationY,
    x: outgoing.x,
    y: outgoing.y,
    vx: 0,
    vy: 0,
    facing: outgoing.facing,
    state: "idle",
    actionTimer: 0,
    kickCooldown: 0,
    stamina: 1,
    yellowCards: 0,
    sentOff: false,
    unavailable: false,
    injury: null,
    isUserControlled: false,
    targetX: outgoing.x,
    targetY: outgoing.y,
    targetSpeed: 0,
  };
}

/** Reset the per-stoppage window flag every time play becomes live again. */
export function resetSubstitutionWindows(state: MatchState): void {
  state.home.substitutionWindowUsed = false;
  state.away.substitutionWindowUsed = false;
}

/**
 * Promotion is the emergency route when no goalkeeper substitute is available:
 * the best outfield defender takes the gloves, using outfield attributes as a
 * fallback for keeper ratings.
 */
export function ensureGoalkeeper(
  state: MatchState,
  side: TeamSide,
): PlayerState | null {
  const team = side === "home" ? state.home : state.away;
  const active = activePlayers(team);
  const goalkeeper = active.find((player) => player.role === "GK");
  if (goalkeeper !== undefined) {
    return goalkeeper;
  }
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const player of active) {
    if (player.role === "GK") {
      continue;
    }
    const score =
      player.attributes.strength * 0.35 +
      player.attributes.reactions * 0.3 +
      player.attributes.defAwareness * 0.25 +
      player.attributes.jumping * 0.1;
    if (score > bestScore) {
      best = player;
      bestScore = score;
    }
  }
  if (best !== null) {
    best.role = "GK";
    best.state = "idle";
    best.targetX = best.x;
    best.targetY = best.y;
    best.targetSpeed = 0;
  }
  return best;
}
