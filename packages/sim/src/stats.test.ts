// packages/sim/src/stats.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "./match";
import { beginKick, registerTouch, startThrowIn } from "./rules/referee";
import { playPass } from "./control/actions";
import type { MatchState, PlayerState } from "./types";

function makePass(state: MatchState): PlayerState {
  const passer = state.home.players.find((entry) => entry.role === "ST")!;
  const receiver = state.home.players.find((entry) => entry.role === "CM")!;
  receiver.x = passer.x + 8;
  receiver.y = passer.y;
  state.referee.phase = "live";
  state.referee.restart = null;
  state.referee.timerSeconds = 0;
  state.referee.setPiece = null;
  state.ball.x = passer.x + 0.3;
  state.ball.y = passer.y;
  state.ball.z = TUNING.ball.radiusM;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
  expect(playPass(state, passer, "pass", 1, 0)).toBe(true);
  return passer;
}

function contactFor(state: MatchState, player: PlayerState) {
  return {
    playerId: player.id,
    team: player.team,
    playerNumber: player.number,
    ballHeightM: state.ball.z,
    relativeSpeedMps: 0,
    contactX: state.ball.x,
    contactY: state.ball.y,
  } as const;
}

describe("pass statistics", () => {
  it("counts an attempted pass and a teammate's first touch as completed", () => {
    const state = createMatch({ seed: 41 });
    const passer = makePass(state);
    const receiver = state.home.players.find((entry) => entry.role === "CM")!;

    expect(state.stats.home.passes).toBe(1);
    expect(state.stats.home.passesCompleted).toBe(0);
    registerTouch(state, contactFor(state, receiver));
    expect(state.stats.home.passesCompleted).toBe(1);
    expect(state.passInFlight).toBeNull();
    expect(state.lastTouch?.playerId).toBe(receiver.id);
    expect(state.lastTouch?.playerId).not.toBe(passer.id);
  });

  it("does not complete a pass touched first by an opponent", () => {
    const state = createMatch({ seed: 42 });
    makePass(state);
    const opponent = state.away.players[0]!;

    registerTouch(state, contactFor(state, opponent));
    expect(state.stats.home.passes).toBe(1);
    expect(state.stats.home.passesCompleted).toBe(0);
    expect(state.passInFlight).toBeNull();
  });

  it("counts a teammate's next kick as a completed pass", () => {
    const state = createMatch({ seed: 44 });
    makePass(state);
    const receiver = state.home.players.find((entry) => entry.role === "CM")!;
    state.ball.x = receiver.x + 0.3;
    state.ball.y = receiver.y;
    expect(beginKick(state, receiver, "dribble")).toBe(true);
    expect(state.stats.home.passesCompleted).toBe(1);
  });

  it("clears an unfinished pass at a restart", () => {
    const state = createMatch({ seed: 43 });
    makePass(state);
    startThrowIn(state, "away", 20, 0);
    expect(state.passInFlight).toBeNull();
  });
});
