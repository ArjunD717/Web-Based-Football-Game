// packages/sim/src/rules/restarts.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  isInsidePenaltyArea,
} from "../pitch";
import {
  setupCorner,
  setupGoalKick,
  setupKickoff,
  setupThrowIn,
} from "./restarts";
import type { MatchState, PlayerState } from "../types";

function allPlayers(state: MatchState): PlayerState[] {
  return [...state.home.players, ...state.away.players];
}

describe("kick-off law", () => {
  it("places every player in their own half and outside the centre circle", () => {
    const state = createMatch({ seed: 11 });
    const taker = state.home.players.find((player) => player.role === "ST")!;

    setupKickoff(state, "home");
    expect(state.ball.x).toBeCloseTo(state.pitch.centreX, 8);
    expect(state.ball.y).toBeCloseTo(state.pitch.centreY, 8);

    for (const player of state.home.players) {
      expect(player.x).toBeLessThanOrEqual(state.pitch.centreX);
    }
    for (const player of state.away.players) {
      expect(player.x).toBeGreaterThanOrEqual(state.pitch.centreX);
    }
    for (const player of allPlayers(state)) {
      if (player === taker) {
        continue;
      }
      expect(
        Math.hypot(
          player.x - state.pitch.centreX,
          player.y - state.pitch.centreY,
        ),
      ).toBeGreaterThanOrEqual(
        TUNING.match.centreCircleRadiusM - 1e-6,
      );
    }
    expect(taker.x).toBeCloseTo(
      state.pitch.centreX - TUNING.match.kickoffTakerOffsetM,
      6,
    );
  });
});

describe("throw-in law", () => {
  it("puts the ball on the touchline and keeps opponents two metres away", () => {
    const state = createMatch({ seed: 12 });
    const takerId = setupThrowIn(state, "away", 30, 0);
    expect(takerId).not.toBeNull();
    expect(state.ball.y).toBe(0);
    expect(state.ball.x).toBe(30);
    const taker = state.away.players.find((player) => player.id === takerId)!;
    expect(taker.y).toBeCloseTo(TUNING.match.throwInTakerInsetM, 6);
    for (const player of state.home.players) {
      expect(
        Math.hypot(player.x - 30, player.y),
      ).toBeGreaterThanOrEqual(TUNING.match.throwInOpponentDistanceM - 1e-6);
    }
  });
});

describe("goal-kick law", () => {
  it("places the ball in the goal area and clears opponents from the box", () => {
    const state = createMatch({ seed: 13 });
    setupGoalKick(state, "home");
    expect(state.ball.x).toBeCloseTo(
      TUNING.match.goalKickSpotFromLineM,
      6,
    );
    expect(state.ball.y).toBeCloseTo(state.pitch.centreY, 6);
    const goalkeeper = state.home.players.find((player) => player.role === "GK")!;
    expect(goalkeeper.x).toBeLessThan(state.ball.x);
    for (const player of state.away.players) {
      expect(
        isInsidePenaltyArea(state.pitch, "home", player.x, player.y),
      ).toBe(false);
    }
  });
});

describe("corner law", () => {
  it("places the ball in the arc and keeps defenders 9.15 m away", () => {
    const state = createMatch({ seed: 14 });
    setupCorner(state, "away", 0, 0);
    expect(state.ball.x).toBe(0);
    expect(state.ball.y).toBe(0);
    for (const player of state.home.players) {
      expect(
        Math.hypot(player.x, player.y),
      ).toBeGreaterThanOrEqual(TUNING.match.cornerOpponentDistanceM - 1e-6);
    }
  });
});
