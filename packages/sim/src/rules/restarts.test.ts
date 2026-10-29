// packages/sim/src/rules/restarts.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  isInsidePenaltyArea,
} from "../pitch";
import {
  beginKick,
  heldBySetPiece,
  startFreeKick,
  startPenalty,
} from "./referee";
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

describe("free-kick law", () => {
  it("forms a wall 9.15 m from the ball and clears every other defender", () => {
    const state = createMatch({ seed: 15 });
    const goal = state.pitch.awayGoal;
    const spotX = goal.lineX - 11;
    const spotY = state.pitch.centreY;
    const keeper = state.away.players.find(
      (player) => player.role === "GK",
    )!;
    keeper.x = goal.lineX - 0.5;
    keeper.y = state.pitch.centreY;
    startFreeKick(state, "home", "directFreeKick", spotX, spotY);

    const setPiece = state.referee.setPiece!;
    expect(setPiece.takerId).not.toBeNull();
    expect(setPiece.wallPlayerIds.length).toBeGreaterThanOrEqual(
      TUNING.referee.wallMinDefenders,
    );
    expect(setPiece.wallPlayerIds.length).toBeLessThanOrEqual(
      TUNING.referee.wallMaxDefenders,
    );

    const taker = allPlayers(state).find(
      (player) => player.id === setPiece.takerId,
    )!;
    expect(taker.x).toBeLessThan(spotX);
    for (const player of allPlayers(state)) {
      if (setPiece.wallPlayerIds.includes(player.id)) {
        expect(Math.hypot(player.x - spotX, player.y - spotY)).toBeGreaterThanOrEqual(
          TUNING.referee.wallDistanceM - 1e-6,
        );
      }
    }
    for (const opponent of state.away.players) {
      if (setPiece.wallPlayerIds.includes(opponent.id)) {
        continue;
      }
      expect(
        Math.hypot(opponent.x - spotX, opponent.y - spotY),
      ).toBeGreaterThanOrEqual(TUNING.referee.wallDistanceM - 1e-6);
    }

    const wall = state.away.players.filter((player) =>
      setPiece.wallPlayerIds.includes(player.id),
    );
    const goalkeeper = state.away.players.find(
      (player) => player.role === "GK",
    )!;
    expect(goalkeeper.x).toBeGreaterThan(goal.lineX - 2);
    state.referee.phase = "live";
    state.referee.restart = null;
    for (const player of wall) {
      expect(heldBySetPiece(state, player)).toBe(true);
    }
    expect(heldBySetPiece(state, taker)).toBe(false);
  });

  it("does not build a wall for a free kick outside shooting range", () => {
    const state = createMatch({ seed: 16 });
    startFreeKick(
      state,
      "home",
      "directFreeKick",
      state.pitch.centreX,
      state.pitch.centreY,
    );
    expect(state.referee.setPiece?.wallPlayerIds).toEqual([]);
  });
});

describe("penalty-kick law", () => {
  it("places the taker, keeper and every other player legally", () => {
    const state = createMatch({ seed: 17 });
    startPenalty(state, "home");
    const setPiece = state.referee.setPiece!;
    const penalty = setPiece.penalty!;
    expect(penalty.takerId).toBe(setPiece.takerId);
    expect(penalty.takerId).not.toBeNull();
    expect(penalty.goalkeeperId).not.toBeNull();

    const spotX = state.ball.x;
    const spotY = state.ball.y;
    expect(state.ball.y).toBeCloseTo(state.pitch.centreY, 8);

    const taker = allPlayers(state).find(
      (player) => player.id === penalty.takerId,
    )!;
    const goalkeeper = allPlayers(state).find(
      (player) => player.id === penalty.goalkeeperId,
    )!;
    expect(taker.x).toBeLessThan(spotX);
    expect(goalkeeper.x).toBeCloseTo(
      state.pitch.awayGoal.lineX - TUNING.referee.penaltyGoalkeeperLineOffsetM,
      6,
    );
    expect(goalkeeper.y).toBeCloseTo(spotY, 6);

    for (const player of allPlayers(state)) {
      if (player.id === penalty.takerId || player.id === penalty.goalkeeperId) {
        continue;
      }
      expect(
        isInsidePenaltyArea(state.pitch, "away", player.x, player.y),
      ).toBe(false);
      expect(
        Math.hypot(player.x - spotX, player.y - spotY),
      ).toBeGreaterThanOrEqual(state.pitch.penaltyArcRadiusM - 1e-6);
    }
  });

  it("holds non-takers until the kick and the taker after it", () => {
    const state = createMatch({ seed: 18 });
    startPenalty(state, "away");
    const penalty = state.referee.setPiece!.penalty!;
    const taker = allPlayers(state).find(
      (player) => player.id === penalty.takerId,
    )!;
    const other = state.away.players.find(
      (player) => player.id !== penalty.takerId && player.role !== "GK",
    )!;
    state.referee.phase = "live";
    state.referee.restart = null;
    expect(heldBySetPiece(state, other)).toBe(true);
    expect(heldBySetPiece(state, taker)).toBe(false);

    expect(beginKick(state, taker, "shot")).toBe(true);
    expect(state.referee.setPiece?.penalty?.kicked).toBe(true);
    expect(heldBySetPiece(state, taker)).toBe(true);
    expect(heldBySetPiece(state, other)).toBe(false);
  });
});
