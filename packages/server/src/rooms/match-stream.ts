// packages/server/src/rooms/match-stream.ts
import { randomBytes, randomUUID } from "node:crypto";
import {
  type MatchSetupWire,
  type SnapshotFrame,
  type WirePitch,
  type WireRosterPlayer,
  type WireTeam,
  TUNING,
} from "@fb/shared";
import {
  createMatch,
  type MatchState,
  type Pitch,
  type TeamState,
} from "@fb/sim";

export interface ServerMatch {
  readonly setup: MatchSetupWire;
  readonly state: MatchState;
}

export interface CreateServerMatchOptions {
  readonly seed?: number;
  readonly homeName?: string;
  readonly awayName?: string;
}

export function createServerMatch(
  options: CreateServerMatchOptions = {},
): ServerMatch {
  const seed = options.seed ?? randomBytes(4).readUInt32LE(0);
  const state = createMatch({
    seed,
    home: { name: options.homeName ?? "Host XI" },
    away: { name: options.awayName ?? "Guest XI" },
  });
  return {
    state,
    setup: buildMatchSetup(state, randomUUID()),
  };
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
      scoreHome: state.referee.scoreHome,
      scoreAway: state.referee.scoreAway,
      restartType: state.referee.restart?.type ?? null,
      restartSide: state.referee.restart?.side ?? null,
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
    players: team.players.map<WireRosterPlayer>((player) => ({
      id: player.id,
      number: player.number,
      goalkeeper: player.role === "GK",
    })),
  };
}
