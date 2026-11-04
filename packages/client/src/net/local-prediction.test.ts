// packages/client/src/net/local-prediction.test.ts
import { CONTROL_BUTTONS, type SnapshotFrame } from "@fb/shared";
import { describe, expect, it } from "vitest";
import type { MatchView, RenderPlayer } from "../render/view";
import { LocalPlayerPrediction } from "./local-prediction";

const PITCH = {
  lengthM: 105,
  widthM: 68,
  goalWidthM: 7.32,
  goalHeightM: 2.44,
  goalPostRadiusM: 0.06,
  goalNetDepthM: 1.5,
  penaltyAreaLengthM: 16.5,
  penaltyAreaWidthM: 40.32,
  goalAreaLengthM: 5.5,
  goalAreaWidthM: 18.32,
  penaltySpotDistanceM: 11,
  penaltyArcRadiusM: 9.15,
  cornerArcRadiusM: 1,
  centreX: 52.5,
  centreY: 34,
  homeGoal: {
    lineX: 0,
    centreY: 34,
    netDirection: -1,
    widthM: 7.32,
    heightM: 2.44,
    postRadiusM: 0.06,
    netDepthM: 1.5,
  },
  awayGoal: {
    lineX: 105,
    centreY: 34,
    netDirection: 1,
    widthM: 7.32,
    heightM: 2.44,
    postRadiusM: 0.06,
    netDepthM: 1.5,
  },
} as const;

function player(x: number, y: number): RenderPlayer {
  return {
    id: "home:p1",
    number: 9,
    team: "home",
    goalkeeper: false,
    x,
    y,
    facing: 0,
    state: "idle",
    stamina: 1,
    sentOff: false,
    yellowCards: 0,
    controlled: true,
    switchTarget: false,
  };
}

function view(x: number, y: number, phase = "live"): MatchView {
  return {
    matchId: "m1",
    pitch: PITCH,
    tick: 1,
    elapsedSeconds: 0,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#0f0" },
      players: [player(x, y)],
    },
    away: {
      name: "Away",
      colors: { primary: "#f00", secondary: "#000", keeper: "#00f" },
      players: [],
    },
    ball: { x, y, z: 0, vx: 0, vy: 0, vz: 0, spinZ: 0 },
    selfSide: "home",
    half: 1,
    match: { phase } as MatchView["match"],
  };
}

function frame(
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): SnapshotFrame {
  return {
    seq: 1,
    tick: 1,
    baseSeq: 0,
    controlledHome: 0,
    controlledAway: -1,
    match: { phase: "live" },
    ball: { x, y, z: 0, vx: 0, vy: 0, vz: 0 },
    players: [
      {
        x,
        y,
        vx,
        vy,
        facing: 0,
        state: "idle" as const,
        stamina: 1,
        sentOff: false,
        unavailable: false,
        yellowCards: 0,
      },
    ],
  } as unknown as SnapshotFrame;
}

describe("LocalPlayerPrediction", () => {
  it("advances the controlled player from input and corrects toward authority", () => {
    const predictor = new LocalPlayerPrediction();
    const auth = view(10, 34);
    const snapshot = frame(10, 34);
    let result = predictor.apply(auth, snapshot, null, 1 / 60);
    expect(result.home.players[0]!.x).toBeCloseTo(10, 2);

    for (let index = 0; index < 30; index += 1) {
      result = predictor.apply(
        auth,
        snapshot,
        { moveX: 1, moveY: 0, buttons: CONTROL_BUTTONS.SPRINT },
        1 / 60,
      );
    }
    expect(result.home.players[0]!.x).toBeGreaterThan(10.2);
  });

  it("extrapolates the interpolated authority into the present", () => {
    const predictor = new LocalPlayerPrediction();
    const result = predictor.apply(
      view(10, 34),
      frame(10, 34, 5, 0),
      null,
      1 / 60,
    );
    expect(result.home.players[0]!.x).toBeGreaterThan(10.4);
  });

  it("snaps on a large authoritative correction", () => {
    const predictor = new LocalPlayerPrediction();
    predictor.apply(view(10, 34), frame(10, 34), null, 1 / 60);
    const result = predictor.apply(
      view(20, 34),
      frame(20, 34),
      null,
      1 / 60,
    );
    expect(result.home.players[0]!.x).toBeCloseTo(20, 1);
  });

  it("does not predict outside live play", () => {
    const predictor = new LocalPlayerPrediction();
    predictor.apply(
      view(10, 34),
      frame(10, 34),
      { moveX: 1, moveY: 0, buttons: CONTROL_BUTTONS.SPRINT },
      1 / 60,
    );
    const result = predictor.apply(
      view(10, 34, "deadBall"),
      frame(10, 34),
      { moveX: 1, moveY: 0, buttons: CONTROL_BUTTONS.SPRINT },
      1 / 60,
    );
    expect(result.home.players[0]!.x).toBe(10);
  });
});
