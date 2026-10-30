// packages/server/src/rooms/match-stream.ts
import { randomBytes, randomUUID } from "node:crypto";
import {
  type PlayerData,
  type TeamData,
  type TeamSheet,
  type MatchSetupWire,
  type MatchSettingsWire,
  type SnapshotFrame,
  type WireMatchStats,
  type WirePitch,
  type WireRosterPlayer,
  type WireShootout,
  type WireTeam,
  TUNING,
} from "@fb/shared";
import {
  createMatchFromTeams,
  type MatchRules,
  type MatchState,
  type Pitch,
  type TeamState,
} from "@fb/sim";

export interface ServerMatch {
  readonly setup: MatchSetupWire;
  readonly state: MatchState;
}

export interface ServerMatchTeam {
  readonly team: TeamData;
  readonly sheet: TeamSheet;
  readonly players: readonly PlayerData[];
}

export interface CreateServerMatchOptions {
  readonly seed?: number;
  readonly rules?: Partial<MatchRules>;
  readonly home: ServerMatchTeam;
  readonly away: ServerMatchTeam;
}

/** Map the lobby's host-owned choices onto the pure simulation rules. */
export function rulesFromSettings(
  settings: MatchSettingsWire,
): Partial<MatchRules> {
  return {
    realHalfSeconds: settings.halfRealMinutes * 60,
    extraTimeEnabled: settings.extraTime,
    shootoutEnabled: settings.shootout,
    varEnabled: settings.varEnabled,
    strictness: settings.refereeStrictness,
    aiDifficulty: settings.aiDifficulty,
  };
}

export function createServerMatch(
  options: CreateServerMatchOptions,
): ServerMatch {
  const seed = options.seed ?? randomBytes(4).readUInt32LE(0);
  const state = createMatchFromTeams({
    seed,
    ...(options.rules === undefined ? {} : { rules: options.rules }),
    home: {
      team: options.home.team,
      sheet: options.home.sheet,
      players: toPlayerMap(options.home.players),
    },
    away: {
      team: options.away.team,
      sheet: options.away.sheet,
      players: toPlayerMap(options.away.players),
    },
  });
  return {
    state,
    setup: buildMatchSetup(state, randomUUID()),
  };
}

function toPlayerMap(
  players: readonly PlayerData[],
): ReadonlyMap<string, PlayerData> {
  return new Map(players.map((player) => [player.id, player]));
}

export function buildMatchSetup(
  state: MatchState,
  matchId: string,
): MatchSetupWire {
  return {
    matchId,
    seed: state.seed,
    tickHz: TUNING.sim.tickHz,
    snapshotHz: TUNING.network.snapshotHz,
    pitch: buildPitch(state.pitch),
    home: buildTeam(state.home),
    away: buildTeam(state.away),
  };
}

export interface SnapshotControlState {
  readonly home: number;
  readonly away: number;
}

export function buildSnapshotFrame(
  state: MatchState,
  seq: number,
  controls: SnapshotControlState = { home: -1, away: -1 },
): SnapshotFrame {
  return {
    seq,
    tick: state.tick,
    baseSeq: 0,
    controlledHome: controls.home,
    controlledAway: controls.away,
    match: {
      phase: state.referee.phase,
      half: state.referee.half,
      clockSeconds: state.referee.clockSeconds,
      addedTimeSeconds: state.referee.addedTimeSeconds,
      scoreHome: state.referee.scoreHome,
      scoreAway: state.referee.scoreAway,
      restartType: state.referee.restart?.type ?? null,
      restartSide: state.referee.restart?.side ?? null,
      lastEvent:
        state.referee.lastEvent === null
          ? null
          : {
              seq: state.referee.lastEvent.seq,
              type: state.referee.lastEvent.type,
              side: state.referee.lastEvent.side,
              playerNumber: state.referee.lastEvent.playerNumber,
            },
    },
    ball: {
      x: state.ball.x,
      y: state.ball.y,
      z: state.ball.z,
      vx: state.ball.vx,
      vy: state.ball.vy,
      vz: state.ball.vz,
    },
    players: [...state.home.players, ...state.away.players].map((player) => ({
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      facing: player.facing,
      state: player.state,
      stamina: player.stamina,
      sentOff: player.sentOff,
      unavailable: player.unavailable,
      yellowCards: player.yellowCards,
    })),
  };
}

function buildPitch(pitch: Pitch): WirePitch {
  return {
    lengthM: pitch.lengthM,
    widthM: pitch.widthM,
    goalWidthM: pitch.goalWidthM,
    goalHeightM: pitch.goalHeightM,
    goalPostRadiusM: pitch.goalPostRadiusM,
    goalNetDepthM: pitch.goalNetDepthM,
    penaltyAreaLengthM: pitch.penaltyAreaLengthM,
    penaltyAreaWidthM: pitch.penaltyAreaWidthM,
    goalAreaLengthM: pitch.goalAreaLengthM,
    goalAreaWidthM: pitch.goalAreaWidthM,
    penaltySpotDistanceM: pitch.penaltySpotDistanceM,
    penaltyArcRadiusM: pitch.penaltyArcRadiusM,
    cornerArcRadiusM: pitch.cornerArcRadiusM,
  };
}

function buildTeam(team: TeamState): WireTeam {
  return {
    side: team.side,
    name: team.name,
    colors: { ...team.colors },
    ...buildWireRoster(team),
  };
}

export function buildWireRoster(team: TeamState): {
  readonly players: WireRosterPlayer[];
  readonly bench: WireRosterPlayer[];
} {
  return {
    players: team.players.map<WireRosterPlayer>((player) => ({
      id: player.id,
      name: player.name,
      number: player.number,
      goalkeeper: player.role === "GK",
    })),
    bench: team.bench.map<WireRosterPlayer>((substitute) => ({
      id: substitute.player.id,
      name: substitute.player.name,
      number: substitute.player.number,
      goalkeeper: substitute.player.role === "GK",
    })),
  };
}

export function buildShootoutWire(state: MatchState): WireShootout | null {
  const shootout = state.referee.shootout;
  if (shootout === null) {
    return null;
  }
  return {
    firstSide: shootout.firstSide,
    homeScore: shootout.homeScore,
    awayScore: shootout.awayScore,
    index: shootout.index,
    suddenDeath: shootout.suddenDeath,
    winner: shootout.winner,
  };
}

export function buildMatchStats(state: MatchState): WireMatchStats {
  const home = state.stats.home;
  const away = state.stats.away;
  const shootout = buildShootoutWire(state);
  const forfeit = state.referee.forfeitSide;
  const winner =
    forfeit !== null
      ? forfeit === "home"
        ? "away"
        : "home"
      : shootout?.winner ??
        (state.referee.scoreHome === state.referee.scoreAway
          ? null
          : state.referee.scoreHome > state.referee.scoreAway
            ? "home"
            : "away");
  return {
    home: { ...home },
    away: { ...away },
    shootout,
    forfeitSide: forfeit,
    winner,
  };
}
