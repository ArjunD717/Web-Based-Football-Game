// packages/sim/src/match.ts
import { TUNING, type PlayerData, type TeamData, type TeamSheet } from "@fb/shared";
import { updateAi } from "./ai/brain";
import { createPitch } from "./pitch";
import { createPlaceholderTeam } from "./placeholder";
import { createTeamFromData } from "./data/team";
import { createTeamMatchStats, recordPossessionTick } from "./stats";
import { stepBall } from "./physics/ball";
import { resolveGoalkeeperSave } from "./physics/keeper";
import {
  resolvePlayerCollisions,
  tickPlayerTimers,
  updateTeamMovement,
} from "./physics/players";
import {
  advanceReferee,
  checkOffsideInvolvement,
  createMatchRules,
  createReferee,
  evaluateBoundary,
  evaluateHandball,
  registerTouch,
  startKickoff,
} from "./rules/referee";
import type {
  MatchRules,
  MatchState,
  Pitch,
  PitchConfig,
  TeamSetup,
  TeamState,
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

  return initialiseMatch(seed >>> 0, pitch, rules, home, away);
}

export interface DataTeamSetup {
  readonly team: TeamData;
  readonly sheet: TeamSheet;
  readonly players: ReadonlyMap<string, PlayerData>;
}

export interface CreateMatchFromTeamsOptions {
  /** uint32 seed; all stochastic decisions derive from it. */
  readonly seed?: number;
  readonly pitch?: Partial<PitchConfig>;
  readonly rules?: Partial<MatchRules>;
  readonly home: DataTeamSetup;
  readonly away: DataTeamSetup;
}

/**
 * Build a match from authored teams and their server-approved sheets. The
 * sheet controls both the XI and the shape; absent data still uses the
 * deterministic placeholder path in `createMatch`.
 */
export function createMatchFromTeams(
  options: CreateMatchFromTeamsOptions,
): MatchState {
  const seed = options.seed ?? DEFAULT_MATCH_SEED;
  if (!Number.isInteger(seed)) {
    throw new RangeError(`match seed must be an integer, got ${seed}`);
  }
  const pitch = createPitch(options.pitch);
  const rules = createMatchRules(options.rules);
  const home = createTeamFromData({
    side: "home",
    pitch,
    team: options.home.team,
    sheet: options.home.sheet,
    players: options.home.players,
  });
  const away = createTeamFromData({
    side: "away",
    pitch,
    team: options.away.team,
    sheet: options.away.sheet,
    players: options.away.players,
  });
  return initialiseMatch(seed >>> 0, pitch, rules, home, away);
}

function initialiseMatch(
  seed: number,
  pitch: Pitch,
  rules: MatchRules,
  home: TeamState,
  away: TeamState,
): MatchState {
  const state: MatchState = {
    seed,
    pitch,
    rules,
    home,
    away,
    stats: {
      home: createTeamMatchStats(),
      away: createTeamMatchStats(),
    },
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
    offsidePassTargetId: null,
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

  updateAi(state);
  recordPossessionTick(state);

  updateTeamMovement(state.home, state.pitch, dt);
  updateTeamMovement(state.away, state.pitch, dt);
  resolvePlayerCollisions(state.home.players, state.away.players);

  if (checkOffsideInvolvement(state)) {
    return state;
  }

  const contact = stepBall(
    state.ball,
    state.home.players,
    state.away.players,
    state.pitch,
    dt,
  );
  if (contact !== null) {
    if (!evaluateHandball(state, contact)) {
      registerTouch(state, contact);
    }
  }

  resolveGoalkeeperSave(state);
  evaluateBoundary(state);
  return state;
}
