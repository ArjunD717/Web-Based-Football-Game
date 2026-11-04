// packages/client/src/match/view-from-wire.ts
import { createPitch, isInsidePenaltyArea } from "@fb/sim";
import type {
  MatchSetupWire,
  SnapshotFrame,
  WireRosterPlayer,
} from "@fb/shared";
import type {
  MatchView,
  RenderPlayer,
  RenderTeam,
} from "../render/view";
import { findNextSwitchTarget } from "./switch-target";

/** Builds renderer frames from static setup + dynamic binary snapshots. */
export class WireViewBuilder {
  private readonly pitch;
  private readonly home: RenderTeam;
  private readonly away: RenderTeam;
  private readonly tickHz: number;
  private readonly selfSide: "home" | "away" | null;
  private readonly matchId: string;

  constructor(setup: MatchSetupWire, selfSide: "home" | "away" | null = null) {
    this.pitch = createPitch(setup.pitch);
    this.matchId = setup.matchId;
    this.tickHz = setup.tickHz;
    this.selfSide = selfSide;
    this.home = {
      name: setup.home.name,
      colors: setup.home.colors,
      players: [],
    };
    this.away = {
      name: setup.away.name,
      colors: setup.away.colors,
      players: [],
    };
    this.roster = {
      home: setup.home.players,
      away: setup.away.players,
    };
  }

  private readonly roster: {
    readonly home: readonly WireRosterPlayer[];
    readonly away: readonly WireRosterPlayer[];
  };

  build(frame: SnapshotFrame): MatchView | null {
    if (frame.players.length < 22) {
      return null;
    }

    const homePlayers: RenderPlayer[] = [];
    const awayPlayers: RenderPlayer[] = [];
    for (let index = 0; index < 11; index += 1) {
      const home = this.toRenderPlayer(
        this.roster.home[index],
        frame,
        index,
        "home",
      );
      const away = this.toRenderPlayer(
        this.roster.away[index],
        frame,
        index + 11,
        "away",
      );
      if (home !== null) {
        homePlayers.push(home);
      }
      if (away !== null) {
        awayPlayers.push(away);
      }
    }

    const selfPlayers =
      this.selfSide === "home"
        ? homePlayers
        : this.selfSide === "away"
          ? awayPlayers
          : [];
    const nextTarget =
      this.selfSide === null
        ? null
        : findNextSwitchTarget(
            selfPlayers,
            frame.ball.x,
            frame.ball.y,
            isInsidePenaltyArea(
              this.pitch,
              this.selfSide,
              frame.ball.x,
              frame.ball.y,
            ),
          );
    const targetId = nextTarget?.id ?? null;
    return {
      matchId: this.matchId,
      pitch: this.pitch,
      tick: frame.tick,
      elapsedSeconds: frame.tick / this.tickHz,
      home: {
        ...this.home,
        players: homePlayers.map((player) =>
          player.id === targetId
            ? { ...player, switchTarget: true }
            : player,
        ),
      },
      away: {
        ...this.away,
        players: awayPlayers.map((player) =>
          player.id === targetId
            ? { ...player, switchTarget: true }
            : player,
        ),
      },
      ball: {
        x: frame.ball.x,
        y: frame.ball.y,
        z: frame.ball.z,
        vx: frame.ball.vx,
        vy: frame.ball.vy,
        vz: frame.ball.vz,
        spinZ: 0,
      },
      selfSide: this.selfSide,
      half: frame.match.half,
      match: frame.match,
    };
  }

  private toRenderPlayer(
    roster: WireRosterPlayer | undefined,
    frame: SnapshotFrame,
    index: number,
    team: "home" | "away",
  ): RenderPlayer | null {
    const player = frame.players[index];
    if (roster === undefined || player === undefined) {
      return null;
    }
    return {
      id: roster.id,
      number: roster.number,
      team,
      goalkeeper: roster.goalkeeper,
      x: player.x,
      y: player.y,
      facing: player.facing,
      state: player.state,
      stamina: player.stamina,
      sentOff: player.sentOff,
      yellowCards: player.yellowCards,
      controlled:
        team === this.selfSide &&
        (team === "home"
          ? frame.controlledHome === index
          : frame.controlledAway === index),
      switchTarget: false,
    };
  }
}
