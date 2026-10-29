// packages/sim/src/rules/referee.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import { stepMatch } from "../match";
import type { MatchState } from "../types";
import { advanceReferee, registerTouch, startThrowIn } from "./referee";

const dt = 1 / TUNING.sim.tickHz;

function putBall(
  state: MatchState,
  x: number,
  y: number,
  z = TUNING.ball.radiusM,
): void {
  state.ball.x = x;
  state.ball.y = y;
  state.ball.z = z;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
}

function makeLive(state: MatchState): void {
  state.referee.phase = "live";
  state.referee.restart = null;
  state.referee.timerSeconds = 0;
}

describe("referee match flow", () => {
  it("scores a goal, then restarts with the conceding side's kick-off", () => {
    const state = createMatch({ seed: 21 });
    makeLive(state);
    putBall(state, state.pitch.lengthM + 0.2, state.pitch.centreY);

    stepMatch(state);

    expect(state.referee.scoreHome).toBe(1);
    expect(state.referee.scoreAway).toBe(0);
    expect(state.referee.phase).toBe("deadBall");
    expect(state.referee.restart).toMatchObject({
      type: "kickoff",
      side: "away",
    });
  });

  it("turns a whole-ball touchline exit into a throw-in for the other side", () => {
    const state = createMatch({ seed: 22 });
    makeLive(state);
    state.lastTouch = {
      team: "home",
      playerId: "home-7",
      playerNumber: 7,
    };
    putBall(state, 30, -0.2);

    stepMatch(state);

    expect(state.referee.phase).toBe("deadBall");
    expect(state.referee.restart).toMatchObject({
      type: "throwIn",
      side: "away",
    });
    expect(state.referee.throwIn?.side).toBe("away");
  });

  it("turns a direct throw-in own goal into a corner", () => {
    const state = createMatch({ seed: 23 });
    startThrowIn(state, "away", state.pitch.centreX, 0);
    const thrower = state.away.players.find(
      (player) => player.id === state.referee.throwIn?.playerId,
    )!;
    state.lastTouch = {
      team: "away",
      playerId: thrower.id,
      playerNumber: thrower.number,
    };
    makeLive(state);
    putBall(state, state.pitch.lengthM + 0.2, state.pitch.centreY);

    stepMatch(state);

    expect(state.referee.scoreHome).toBe(0);
    expect(state.referee.scoreAway).toBe(0);
    expect(state.referee.restart).toMatchObject({
      type: "corner",
      side: "home",
    });
    expect(state.referee.throwIn).toBeNull();
  });

  it("turns a direct throw-in at the opponent goal into a goal kick", () => {
    const state = createMatch({ seed: 28 });
    startThrowIn(state, "away", state.pitch.centreX, 0);
    const thrower = state.away.players.find(
      (player) => player.id === state.referee.throwIn?.playerId,
    )!;
    state.lastTouch = {
      team: "away",
      playerId: thrower.id,
      playerNumber: thrower.number,
    };
    makeLive(state);
    putBall(state, -0.2, state.pitch.centreY);

    stepMatch(state);

    expect(state.referee.scoreHome).toBe(0);
    expect(state.referee.scoreAway).toBe(0);
    expect(state.referee.restart).toMatchObject({
      type: "goalKick",
      side: "home",
    });
    expect(state.referee.throwIn).toBeNull();
  });

  it("enters half-time, swaps ends and starts the second half", () => {
    const state = createMatch({
      seed: 24,
      rules: {
        realHalfSeconds: 1,
        halfTimeSeconds: 0.1,
        kickoffDelaySeconds: 0.01,
      },
    });
    makeLive(state);
    state.referee.clockSeconds = state.rules.gameSecondsPerHalf - 0.5;

    stepMatch(state);
    expect(state.referee.phase).toBe("halfTime");
    expect(state.referee.clockSeconds).toBe(state.rules.gameSecondsPerHalf);

    for (let i = 0; i < 7; i += 1) {
      stepMatch(state);
    }
    expect(state.referee.half).toBe(2);
    expect(state.referee.phase).toBe("deadBall");
    expect(state.home.attackDirection).toBe(-1);
    expect(state.away.attackDirection).toBe(1);
    expect(state.referee.restart).toMatchObject({
      type: "kickoff",
      side: "away",
    });
  });

  it("reaches full-time at the end of the second half", () => {
    const state = createMatch({
      seed: 25,
      rules: { realHalfSeconds: 1 },
    });
    makeLive(state);
    state.referee.half = 2;
    state.referee.clockSeconds = state.rules.gameSecondsPerHalf * 2 - 0.5;

    stepMatch(state);

    expect(state.referee.phase).toBe("fullTime");
    expect(state.referee.clockSeconds).toBe(
      state.rules.gameSecondsPerHalf * 2,
    );
  });

  it("keeps the clock advancing during dead-ball restarts", () => {
    const state = createMatch({ seed: 26 });
    const startClock = state.referee.clockSeconds;
    const advanced = advanceReferee(state, dt);
    expect(advanced).toBe(false);
    expect(state.referee.clockSeconds).toBeGreaterThan(startClock);
  });

  it("keeps a throw-in pending until an opponent touches the ball", () => {
    const state = createMatch({ seed: 27 });
    startThrowIn(state, "away", state.pitch.centreX, 0);
    const thrower = state.away.players.find(
      (player) => player.id === state.referee.throwIn?.playerId,
    )!;

    expect(advanceReferee(state, state.rules.restartDelaySeconds + dt)).toBe(
      true,
    );
    expect(state.referee.phase).toBe("live");
    expect(state.referee.throwIn).toMatchObject({
      side: "away",
      playerId: thrower.id,
    });

    registerTouch(state, {
      team: "away",
      playerId: thrower.id,
      playerNumber: thrower.number,
    });
    expect(state.referee.throwIn).not.toBeNull();

    registerTouch(state, {
      team: "home",
      playerId: "home-4",
      playerNumber: 4,
    });
    expect(state.referee.throwIn).toBeNull();
  });
});
