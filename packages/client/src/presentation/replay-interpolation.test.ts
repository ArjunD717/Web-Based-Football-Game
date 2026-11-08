// packages/client/src/presentation/replay-interpolation.test.ts

import { describe, expect, it } from "vitest";
import { createPitch } from "@fb/sim";
import type {
  MatchView,
  RenderBall,
  RenderPlayer,
} from "../render/view";
import { MatchReplayBuffer } from "./replay";

const pitch = createPitch();

function player(
  id: string,
  x: number,
  facing: number,
  state: RenderPlayer["state"],
  yellowCards = 0,
): RenderPlayer {
  return {
    id,
    number: 9,
    team: "home",
    goalkeeper: false,
    x,
    y: 34,
    facing,
    state,
    stamina: 1,
    sprintSpeed: 80,
    sentOff: false,
    yellowCards,
    controlled: false,
    switchTarget: false,
  };
}

function ball(x: number): RenderBall {
  return { x, y: 34, z: 0.11, vx: 0, vy: 0, vz: 0, spinZ: 0 };
}

function view(
  tick: number,
  x: number,
  facing: number,
  ballX: number,
  state: RenderPlayer["state"],
  yellowCards = 0,
  id = "home-9",
): MatchView {
  return {
    matchId: "interpolation",
    pitch,
    tick,
    elapsedSeconds: tick / 60,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#fc0" },
      players: [player(id, x, facing, state, yellowCards)],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#fc0" },
      players: [player("away-9", 60, 0, "idle")],
    },
    ball: ball(ballX),
    selfSide: "home",
    half: 1,
    match: null,
  };
}

function savedReplay(
  first: MatchView,
  second: MatchView,
  interpolate = true,
): MatchReplayBuffer {
  const replay = new MatchReplayBuffer({ speed: 1, interpolate });
  expect(
    replay.loadSaved([
      { view: first, recordedAtMs: 0 },
      { view: second, recordedAtMs: 1_000 },
    ]),
  ).toBe(true);
  expect(replay.startSaved(0)).toBe(true);
  return replay;
}

describe("replay snapshot interpolation", () => {
  it("blends player and ball transforms between 30 Hz snapshots", () => {
    const replay = savedReplay(
      view(0, 10, Math.PI - 0.1, 20, "jog", 0),
      view(60, 20, -Math.PI + 0.1, 30, "sprint", 1),
    );
    const sample = replay.sample(500);
    expect(sample).not.toBeNull();
    if (sample === null) {
      return;
    }
    expect(sample.view.tick).toBe(30);
    expect(sample.view.elapsedSeconds).toBeCloseTo(0.5, 5);
    const home = sample.view.home.players[0];
    expect(home?.x).toBeCloseTo(15, 5);
    expect(home?.y).toBeCloseTo(34, 5);
    expect(Math.abs(Math.abs(home?.facing ?? 0) - Math.PI)).toBeLessThan(1e-6);
    expect(sample.view.ball.x).toBeCloseTo(25, 5);
    // At the exact midpoint, discrete state keeps the earlier snapshot.
    expect(home?.state).toBe("jog");
    expect(home?.yellowCards).toBe(0);

    const later = replay.sample(999);
    expect(later?.view.tick).toBe(60);
    expect(later?.view.home.players[0]?.x).toBeCloseTo(19.99, 2);
    expect(later?.view.home.players[0]?.state).toBe("sprint");
    expect(later?.view.home.players[0]?.yellowCards).toBe(1);
  });

  it("falls back to a discrete frame when lineups do not match", () => {
    const replay = savedReplay(
      view(0, 10, 0, 20, "jog", 0, "home-a"),
      view(60, 20, 0, 30, "sprint", 1, "home-b"),
    );
    const sample = replay.sample(750);
    expect(sample?.view.home.players[0]).toMatchObject({
      id: "home-b",
      x: 20,
      state: "sprint",
    });
  });

  it("can disable interpolation for exact snapshot playback", () => {
    const replay = savedReplay(
      view(0, 10, 0, 20, "jog"),
      view(60, 20, 0, 30, "sprint"),
      false,
    );
    const sample = replay.sample(600);
    expect(sample?.view.tick).toBe(60);
    expect(sample?.view.home.players[0]?.x).toBe(20);
    expect(sample?.view.ball.x).toBe(30);
  });
});
