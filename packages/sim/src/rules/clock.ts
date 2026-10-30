// packages/sim/src/rules/clock.ts

import { TUNING, clamp } from "@fb/shared";
import type { MatchHalf, MatchState } from "../types";

/** Game-clock seconds at which a period starts. */
export function periodStartSeconds(half: MatchHalf): number {
  switch (half) {
    case 1:
      return 0;
    case 2:
      return TUNING.match.gameMinutesPerHalf * 60;
    case 3:
      return TUNING.match.gameMinutesPerHalf * 120;
    case 4:
      return TUNING.match.gameMinutesPerHalf * 120 +
        TUNING.match.extraTimeMinutesPerHalf * 60;
  }
}

/** Nominal game-clock end, before the board allowance. */
export function periodNominalEndSeconds(half: MatchHalf): number {
  const start = periodStartSeconds(half);
  return start + periodLengthSeconds(half);
}

export function periodLengthSeconds(half: MatchHalf): number {
  return half <= 2
    ? TUNING.match.gameMinutesPerHalf * 60
    : TUNING.match.extraTimeMinutesPerHalf * 60;
}

export function isExtraTimePeriod(half: MatchHalf): boolean {
  return half === 3 || half === 4;
}

/**
 * Add an event's real-world interruption to this period's board allowance.
 * Once the board has been displayed, late stoppages do not move the target.
 */
export function addStoppage(state: MatchState, seconds: number): void {
  const referee = state.referee;
  if (
    seconds <= 0 ||
    referee.phase === "fullTime" ||
    referee.phase === "shootout" ||
    referee.regulationExpired
  ) {
    return;
  }
  referee.stoppageSeconds += seconds;
}

/** Convert accumulated stoppages into the displayed added-time board. */
export function finaliseAddedTime(state: MatchState): number {
  const referee = state.referee;
  const rounding = TUNING.match.addedTimeRoundingSeconds;
  const capped = Math.min(
    TUNING.match.addedTimeCapSeconds,
    Math.max(0, referee.stoppageSeconds),
  );
  referee.addedTimeSeconds =
    capped === 0 ? 0 : Math.ceil(capped / rounding) * rounding;
  return referee.addedTimeSeconds;
}

export function isPastAddedTime(state: MatchState): boolean {
  const referee = state.referee;
  return (
    referee.clockSeconds >=
    periodNominalEndSeconds(referee.half) + referee.addedTimeSeconds
  );
}

/** Natural pauses are dead-ball restarts and completed goals. */
export function isNaturalPause(state: MatchState): boolean {
  return state.referee.phase === "deadBall";
}

/**
 * Advance the game clock and arm the added-time board at regulation time.
 * Returns true when the clock is past the period's final whistle and play is
 * at a natural pause.
 */
export function updateMatchClock(state: MatchState, dt: number): boolean {
  const referee = state.referee;
  if (
    referee.phase === "fullTime" ||
    referee.phase === "shootout"
  ) {
    return false;
  }
  const scale =
    state.rules.gameSecondsPerHalf / state.rules.realHalfSeconds;
  referee.clockSeconds += dt * scale;
  const nominalEnd = periodNominalEndSeconds(referee.half);
  if (!referee.regulationExpired && referee.clockSeconds >= nominalEnd) {
    referee.clockSeconds = Math.max(referee.clockSeconds, nominalEnd);
    finaliseAddedTime(state);
    referee.regulationExpired = true;
  }
  return (
    referee.regulationExpired &&
    isPastAddedTime(state) &&
    isNaturalPause(state)
  );
}

/** Board display in whole seconds; the caller formats it. */
export function addedTimeRemainingSeconds(state: MatchState): number {
  const target =
    periodNominalEndSeconds(state.referee.half) +
    state.referee.addedTimeSeconds;
  return Math.max(0, target - state.referee.clockSeconds);
}

/** Clamp a period transition to a sane number even on corrupt external state. */
export function clampHalf(half: number): MatchHalf {
  return clamp(Math.round(half), 1, 4) as MatchHalf;
}
