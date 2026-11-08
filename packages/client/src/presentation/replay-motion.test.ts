// packages/client/src/presentation/replay-motion.test.ts

import { describe, expect, it } from "vitest";
import type { MatchView, RenderPlayer } from "../render/view";
import {
  findReplayMotionWindow,
  measureReplayMotion,
} from "./replay-motion";

function player(id: string, team: "home" | "away", x: number): RenderPlayer {
  return {
    id,
    number: 9,
    team,
    goalkeeper: false,
    x,
    y: 34,
    facing: 0,
    state: "jog",
    stamina: 1,
    sentOff: false,
    yellowCards: 0,
    controlled: false,
    switchTarget: false,
  };
}

function view(
  homeX: number,
  awayX: number,
  ballX: number,
): MatchView {
  return {
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#fc0" },
      players: [player("h9", "home", homeX)],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#fc0" },
      players: [player("a9", "away", awayX)],
    },
    ball: { x: ballX, y: 34, z: 0.11, vx: 0, vy: 0, vz: 0, spinZ: 0 },
  } as unknown as MatchView;
}

describe("replay motion measurement", () => {
  it("measures the largest player and ball displacement", () => {
    const motion = measureReplayMotion(view(10, 50, 20), view(13, 52, 24));
    expect(motion.playerDeltaM).toBeCloseTo(3, 6);
    expect(motion.ballDeltaM).toBeCloseTo(4, 6);
    expect(motion.moved).toBe(true);
  });

  it("does not report static or sub-millimetre frames as movement", () => {
    expect(measureReplayMotion(view(10, 50, 20), view(10, 50, 20))).toEqual({
      playerDeltaM: 0,
      ballDeltaM: 0,
      moved: false,
    });
    expect(
      measureReplayMotion(view(10, 50, 20), view(10.00001, 50, 20)).moved,
    ).toBe(false);
  });
});

describe("replay motion window selection", () => {
  it("returns a sub-frame window inside the pair with the largest movement", () => {
    const frames = [
      { view: view(10, 50, 20), recordedAtMs: 0 },
      { view: view(10.5, 50, 20), recordedAtMs: 1_000 },
      { view: view(17, 50, 20), recordedAtMs: 2_000 },
    ];
    const motion = findReplayMotionWindow(frames);
    expect(motion).not.toBeNull();
    if (motion === null) {
      return;
    }
    expect(motion.fromOffsetMs).toBeGreaterThan(1_000);
    expect(motion.toOffsetMs).toBeGreaterThan(motion.fromOffsetMs);
    expect(motion.toOffsetMs).toBeLessThan(2_000);
    expect(motion.playerDeltaM).toBeCloseTo(6.5, 6);
  });

  it("returns null when a consecutive pair looks like a reset teleport", () => {
    expect(
      findReplayMotionWindow([
        { view: view(10, 50, 20), recordedAtMs: 0 },
        { view: view(1_000, 50, 20), recordedAtMs: 100 },
      ]),
    ).toBeNull();
  });

  it("returns null when every consecutive pair is static", () => {
    expect(
      findReplayMotionWindow([
        { view: view(10, 50, 20), recordedAtMs: 0 },
        { view: view(10, 50, 20), recordedAtMs: 100 },
      ]),
    ).toBeNull();
  });
});
