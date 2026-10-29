// packages/client/src/render/view.ts
import type {
  MatchState,
  Pitch,
  PlayerStateName,
  TeamSide,
} from "@fb/sim";

export interface RenderTeamColors {
  readonly primary: string;
  readonly secondary: string;
  readonly keeper: string;
}

export interface RenderPlayer {
  readonly id: string;
  readonly number: number;
  readonly team: TeamSide;
  readonly goalkeeper: boolean;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly state: PlayerStateName;
  readonly stamina: number;
  /** True for the player currently selected by this client's control input. */
  readonly controlled: boolean;
}

export interface RenderTeam {
  readonly name: string;
  readonly colors: RenderTeamColors;
  readonly players: readonly RenderPlayer[];
}

export interface RenderBall {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly spinZ: number;
}

/** Network-agnostic presentation frame consumed by every renderer. */
export interface MatchView {
  readonly pitch: Pitch;
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly home: RenderTeam;
  readonly away: RenderTeam;
  readonly ball: RenderBall;
}

/** Adapter for the local practice page, which owns a full MatchState. */
export function matchStateToView(state: MatchState): MatchView {
  return {
    pitch: state.pitch,
    tick: state.tick,
    elapsedSeconds: state.elapsedSeconds,
    home: {
      name: state.home.name,
      colors: state.home.colors,
      players: state.home.players.map((player) => ({
        id: player.id,
        number: player.number,
        team: player.team,
        goalkeeper: player.role === "GK",
        x: player.x,
        y: player.y,
        facing: player.facing,
        state: player.state,
        stamina: player.stamina,
        controlled: false,
      })),
    },
    away: {
      name: state.away.name,
      colors: state.away.colors,
      players: state.away.players.map((player) => ({
        id: player.id,
        number: player.number,
        team: player.team,
        goalkeeper: player.role === "GK",
        x: player.x,
        y: player.y,
        facing: player.facing,
        state: player.state,
        stamina: player.stamina,
        controlled: false,
      })),
    },
    ball: {
      x: state.ball.x,
      y: state.ball.y,
      z: state.ball.z,
      vx: state.ball.vx,
      vy: state.ball.vy,
      vz: state.ball.vz,
      spinZ: state.ball.spinZ,
    },
  };
}
