// packages/sim/src/match.ts
import { TUNING } from "@fb/shared";
import { updatePlaceholderAi } from "./ai/brain";
import { createPitch } from "./pitch";
import { createPlaceholderTeam } from "./placeholder";
import { stepBall } from "./physics/ball";
import {
  resolvePlayerCollisions,
  tickPlayerTimers,
  updateTeamMovement,
} from "./physics/players";
import {
  advanceReferee,
  createMatchRules,
  createReferee,
  evaluateBoundary,
  registerTouch,
  startKickoff,
} from "./rules/referee";
import type {
  MatchRules,
  MatchState,
  PitchConfig,
  TeamSetup,
} from "./types";

const DEFAULT_MATCH_SEED = 1;

export interface CreateMatchOptions {
  /** uint32 seed; all stochastic decisions derive from it. */
  readonly seed?: number;
  readonly pitch?: Partial<PitchConfig>;
  readonly home?: TeamSetup;
  readonly away?: TeamSetup;
  readonly rules?: Partial<MatchRules>;
}

/**
 * Create a deterministic 11v11 match in the opening kick-off state. The
 * referee owns dead-ball restarts from here on.
 */
export function createMatch(
  options: CreateMatchOptions = {},
): MatchState {
  const seed = options.seed ?? DEFAULT_MATCH_SEED;
  if (!Number.isInteger(seed)) {
    throw new RangeError(`match seed must be an integer, got ${seed}`);
  }

  const pitch = createPitch(options.pitch);
  const rules = createMatchRules(options.rules);
  const home = createPlaceholderTeam(
    "home",
    seed >>> 0,
    pitch,
    options.home,
  );
  const away = createPlaceholderTeam(
    "away",
    seed >>> 0,
    pitch,
    options.away,
  );

  const state: MatchState = {
    seed: seed >>> 0,
    pitch,
    rules,
    home,
    away,
    ball: {
      x: pitch.centreX,
      y: pitch.centreY,
      z: TUNING.ball.radiusM,
      vx: 0,
      vy: 0,
      vz: 0,
      spinX: 0,
      spinY: 0,
      spinZ: 0,
    },
    tick: 0,
    elapsedSeconds: 0,
    lastTouch: null,
    referee: createReferee("home"),
  };
  startKickoff(state, "home", rules.kickoffDelaySeconds);
  return state;
}

/**
 * Advance exactly one authoritative tick. Mutates `state` to avoid copying the
 * whole match 60 times a second and returns it for convenient chaining.
 */
export function stepMatch(state: MatchState): MatchState {
  const dt = 1 / TUNING.sim.tickHz;

  state.tick += 1;
  state.elapsedSeconds = state.tick * dt;

  if (!advanceReferee(state, dt)) {
    return state;
  }

  tickPlayerTimers(state.home.players, dt);
  tickPlayerTimers(state.away.players, dt);

  updatePlaceholderAi(state);

  updateTeamMovement(state.home, state.pitch, dt);
  updateTeamMovement(state.away, state.pitch, dt);
  resolvePlayerCollisions(state.home.players, state.away.players);

  const contact = stepBall(
    state.ball,
    state.home.players,
    state.away.players,
    state.pitch,
    dt,
  );
  if (contact !== null) {
    registerTouch(state, contact);
  }

  evaluateBoundary(state);
  return state;
}
