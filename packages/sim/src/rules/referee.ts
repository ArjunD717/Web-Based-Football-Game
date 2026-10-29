// packages/sim/src/rules/referee.ts
import { TUNING, clamp } from "@fb/shared";
import { getDefendingGoalForDirection } from "../pitch";
import type { BallContact } from "../physics/ball";
import type {
  MatchRules,
  MatchState,
  RefereeState,
  RestartType,
  TeamSide,
} from "../types";
import {
  classifyBoundary,
  type BoundaryEvent,
} from "./out-of-play";
import {
  setupCorner,
  setupGoalKick,
  setupKickoff,
  setupThrowIn,
} from "./restarts";

const DEFAULT_RULES: MatchRules = {
  realHalfSeconds: TUNING.match.halfRealMinutes * 60,
  halfTimeSeconds: TUNING.match.halfTimeSeconds,
  restartDelaySeconds: TUNING.match.restartDelaySeconds,
  goalRestartDelaySeconds: TUNING.match.goalRestartDelaySeconds,
  kickoffDelaySeconds: TUNING.match.kickoffDelaySeconds,
  gameSecondsPerHalf: TUNING.match.gameMinutesPerHalf * 60,
};

export function createMatchRules(
  overrides: Partial<MatchRules> = {},
): MatchRules {
  const rules: MatchRules = { ...DEFAULT_RULES, ...overrides };
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`match rule ${key} must be positive`);
    }
  }
  return rules;
}

export function createReferee(firstKickoffSide: TeamSide): RefereeState {
  return {
    phase: "deadBall",
    half: 1,
    clockSeconds: 0,
    scoreHome: 0,
    scoreAway: 0,
    restart: null,
    timerSeconds: 0,
    firstKickoffSide,
    throwIn: null,
  };
}

export function startKickoff(
  state: MatchState,
  side: TeamSide,
  delaySeconds: number,
): void {
  setupKickoff(state, side);
  state.referee.phase = "deadBall";
  state.referee.restart = {
    type: "kickoff",
    side,
    x: state.pitch.centreX,
    y: state.pitch.centreY,
  };
  state.referee.timerSeconds = delaySeconds;
  state.referee.throwIn = null;
}

export function startThrowIn(
  state: MatchState,
  side: TeamSide,
  x: number,
  y: number,
): void {
  const takerId = setupThrowIn(state, side, x, y);
  state.referee.phase = "deadBall";
  state.referee.restart = { type: "throwIn", side, x, y };
  state.referee.timerSeconds = state.rules.restartDelaySeconds;
  state.referee.throwIn =
    takerId === null ? null : { side, playerId: takerId };
}

export function startGoalKick(state: MatchState, side: TeamSide): void {
  setupGoalKick(state, side);
  const team = side === "home" ? state.home : state.away;
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const inward = -goal.netDirection;
  state.referee.phase = "deadBall";
  state.referee.restart = {
    type: "goalKick",
    side,
    x: goal.lineX + inward * TUNING.match.goalKickSpotFromLineM,
    y: state.pitch.centreY,
  };
  state.referee.timerSeconds = state.rules.restartDelaySeconds;
  state.referee.throwIn = null;
}

export function startCorner(
  state: MatchState,
  side: TeamSide,
  x: number,
  y: number,
): void {
  setupCorner(state, side, x, y);
  const spotX = x <= state.pitch.centreX ? 0 : state.pitch.lengthM;
  const spotY = y <= state.pitch.centreY ? 0 : state.pitch.widthM;
  state.referee.phase = "deadBall";
  state.referee.restart = {
    type: "corner",
    side,
    x: spotX,
    y: spotY,
  };
  state.referee.timerSeconds = state.rules.restartDelaySeconds;
  state.referee.throwIn = null;
}

/**
 * Advance clocks and restart timers. Returns false when the caller must not
 * simulate physics this tick (dead ball, half-time or full-time).
 */
export function advanceReferee(state: MatchState, dt: number): boolean {
  const referee = state.referee;

  if (referee.phase === "halfTime") {
    referee.timerSeconds = Math.max(0, referee.timerSeconds - dt);
    if (referee.timerSeconds <= 0) {
      startSecondHalf(state);
    }
    return false;
  }
  if (referee.phase === "fullTime") {
    return false;
  }

  const scale =
    state.rules.gameSecondsPerHalf / state.rules.realHalfSeconds;
  const halfEnd =
    referee.half === 1
      ? state.rules.gameSecondsPerHalf
      : state.rules.gameSecondsPerHalf * 2;
  referee.clockSeconds = Math.min(
    halfEnd,
    referee.clockSeconds + dt * scale,
  );

  if (referee.clockSeconds >= halfEnd) {
    if (referee.half === 1) {
      enterHalfTime(state);
    } else {
      enterFullTime(state);
    }
    return false;
  }

  if (referee.phase === "deadBall") {
    referee.timerSeconds = Math.max(0, referee.timerSeconds - dt);
    if (referee.timerSeconds <= 0) {
      referee.phase = "live";
      referee.restart = null;
    }
    return referee.phase === "live";
  }

  return true;
}

export function evaluateBoundary(state: MatchState): void {
  const event = classifyBoundary(
    state.pitch,
    state.ball,
    state.lastTouch,
  );
  if (event === null) {
    return;
  }
  applyBoundary(state, event);
}

export function registerTouch(
  state: MatchState,
  contact: BallContact,
): void {
  state.lastTouch = {
    team: contact.team,
    playerId: contact.playerId,
    playerNumber: contact.playerNumber,
  };

  const pending = state.referee.throwIn;
  if (
    pending !== null &&
    (pending.side !== contact.team ||
      pending.playerId !== contact.playerId)
  ) {
    state.referee.throwIn = null;
  }
}

export function isRefereePlayable(state: MatchState): boolean {
  return state.referee.phase === "live";
}

function applyBoundary(state: MatchState, event: BoundaryEvent): void {
  if (event.kind === "goal") {
    const pendingThrow = state.referee.throwIn;
    if (pendingThrow !== null) {
      // A throw-in cannot score directly. Into the opponent goal it becomes a
      // goal kick; into the thrower's own goal it becomes a corner.
      if (pendingThrow.side === event.scoringSide) {
        startGoalKick(
          state,
          event.scoringSide === "home" ? "away" : "home",
        );
        return;
      }
      startCorner(
        state,
        event.scoringSide,
        event.goal === "home" ? 0 : state.pitch.lengthM,
        state.ball.y <= state.pitch.centreY ? 0 : state.pitch.widthM,
      );
      return;
    }
    if (event.scoringSide === "home") {
      state.referee.scoreHome = Math.min(255, state.referee.scoreHome + 1);
    } else {
      state.referee.scoreAway = Math.min(255, state.referee.scoreAway + 1);
    }
    startKickoff(
      state,
      event.scoringSide === "home" ? "away" : "home",
      state.rules.goalRestartDelaySeconds,
    );
    return;
  }

  beginRestart(state, event.type, event.side, event.x, event.y);
}

function beginRestart(
  state: MatchState,
  type: Exclude<RestartType, "kickoff">,
  side: TeamSide,
  x: number,
  y: number,
): void {
  switch (type) {
    case "throwIn":
      startThrowIn(state, side, x, y);
      return;
    case "goalKick":
      startGoalKick(state, side);
      return;
    case "corner":
      startCorner(state, side, x, y);
      return;
  }
}

function enterHalfTime(state: MatchState): void {
  state.referee.phase = "halfTime";
  state.referee.half = 1;
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf;
  state.referee.timerSeconds = state.rules.halfTimeSeconds;
  state.referee.restart = null;
  state.referee.throwIn = null;
  freezeBall(state);
}

function startSecondHalf(state: MatchState): void {
  state.home.attackDirection = state.home.attackDirection === 1 ? -1 : 1;
  state.away.attackDirection = state.away.attackDirection === 1 ? -1 : 1;
  state.referee.half = 2;
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf;
  state.referee.restart = null;
  state.referee.throwIn = null;
  const kickoffSide: TeamSide =
    state.referee.firstKickoffSide === "home" ? "away" : "home";
  startKickoff(state, kickoffSide, state.rules.kickoffDelaySeconds);
}

function enterFullTime(state: MatchState): void {
  state.referee.phase = "fullTime";
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf * 2;
  state.referee.timerSeconds = 0;
  state.referee.restart = null;
  state.referee.throwIn = null;
  freezeBall(state);
}

function freezeBall(state: MatchState): void {
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
  state.ball.spinX = 0;
  state.ball.spinY = 0;
  state.ball.spinZ = 0;
  state.ball.z = clamp(
    state.ball.z,
    TUNING.ball.radiusM,
    TUNING.pitch.goalHeightM,
  );
}
