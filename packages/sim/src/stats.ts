// packages/sim/src/stats.ts

import type {
  MatchState,
  TeamMatchStats,
  TeamSide,
} from "./types";

export function createTeamMatchStats(): TeamMatchStats {
  return {
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    fouls: 0,
    offsides: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    passes: 0,
    passesCompleted: 0,
    possessionTicks: 0,
  };
}

export function statsFor(
  state: MatchState,
  side: TeamSide,
): TeamMatchStats {
  return side === "home" ? state.stats.home : state.stats.away;
}

export function recordShot(state: MatchState, side: TeamSide): void {
  statsFor(state, side).shots += 1;
}

export function recordPassAttempt(state: MatchState, side: TeamSide): void {
  statsFor(state, side).passes += 1;
}

export function recordPassCompleted(state: MatchState, side: TeamSide): void {
  statsFor(state, side).passesCompleted += 1;
}

export function recordShotOnTarget(
  state: MatchState,
  side: TeamSide,
): void {
  statsFor(state, side).shotsOnTarget += 1;
}

export function recordGoal(
  state: MatchState,
  side: TeamSide,
  ownGoal = false,
): void {
  const stats = statsFor(state, side);
  stats.goals += 1;
  if (!ownGoal) {
    stats.shotsOnTarget += 1;
  }
}

/**
 * Possession is a proximity proxy rather than a tackle ledger: whoever is
 * closest to the ball while play is live owns the tick. It is deterministic
 * and cheap enough to run every simulation tick.
 */
export function recordPossessionTick(state: MatchState): void {
  if (state.referee.phase !== "live") {
    return;
  }
  let bestSide: TeamSide | null = null;
  let bestDistance = Infinity;
  for (const side of ["home", "away"] as const) {
    const team = side === "home" ? state.home : state.away;
    for (const player of team.players) {
      if (player.sentOff || player.unavailable) {
        continue;
      }
      const distance = Math.hypot(
        player.x - state.ball.x,
        player.y - state.ball.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSide = side;
      }
    }
  }
  if (bestSide !== null) {
    statsFor(state, bestSide).possessionTicks += 1;
  }
}
