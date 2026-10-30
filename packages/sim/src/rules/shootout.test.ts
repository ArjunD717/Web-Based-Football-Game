// packages/sim/src/rules/shootout.test.ts

import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import type { ShootoutState } from "../types";
import { advanceReferee } from "./referee";
import { createShootout, takeShootoutKick } from "./shootout";
import { periodNominalEndSeconds } from "./clock";

function prepare(seed: number): {
  state: ReturnType<typeof createMatch>;
  shootout: ShootoutState;
} {
  const state = createMatch({ seed });
  const shootout = createShootout(state);
  state.referee.shootout = shootout;
  return { state, shootout };
}

describe("penalty shootout", () => {
  it("starts with the side that did not kick off and alternates", () => {
    const { state, shootout } = prepare(21);
    expect(shootout.firstSide).not.toBe(state.referee.firstKickoffSide);
    expect(shootout.index).toBe(0);

    const first = takeShootoutKick(state);
    const second = takeShootoutKick(state);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.side).toBe(shootout.firstSide);
    expect(second?.side).not.toBe(shootout.firstSide);
    expect(shootout.index).toBe(2);
    expect(shootout.kicks).toHaveLength(2);
    expect(shootout.lastKick).toBe(second);
  });

  it("finishes deterministically and never takes a kick after a winner", () => {
    const first = prepare(33);
    const second = prepare(33);
    for (let index = 0; index < 30 && first.shootout.winner === null; index += 1) {
      const kickA = takeShootoutKick(first.state);
      const kickB = takeShootoutKick(second.state);
      expect(kickA).toEqual(kickB);
    }
    expect(first.shootout.winner).not.toBeNull();
    expect(second.shootout.winner).toBe(first.shootout.winner);
    const winner = first.shootout.winner;
    expect(takeShootoutKick(first.state)).toBeNull();
    expect(first.shootout.winner).toBe(winner);
    expect(first.shootout.kicks.length).toBeGreaterThan(0);
  });

  it("moves from a level extra-time tie into a shootout and full time", () => {
    const state = createMatch({
      seed: 55,
      rules: { extraTimeEnabled: true, shootoutEnabled: true },
    });
    state.referee.half = 2;
    state.referee.phase = "deadBall";
    state.referee.timerSeconds = 10;
    state.referee.clockSeconds = periodNominalEndSeconds(2) - 0.1;
    state.referee.scoreHome = 1;
    state.referee.scoreAway = 1;
    state.referee.regulationExpired = false;

    advanceReferee(state, 1 / 60);
    expect(state.referee.phase).toBe("halfTime");
    advanceReferee(state, 10);
    expect(state.referee.half).toBe(3);

    state.referee.phase = "deadBall";
    state.referee.timerSeconds = 10;
    state.referee.clockSeconds = periodNominalEndSeconds(3) - 0.1;
    advanceReferee(state, 1 / 60);
    expect(state.referee.phase).toBe("halfTime");
    advanceReferee(state, 10);
    expect(state.referee.half).toBe(4);

    state.referee.phase = "deadBall";
    state.referee.timerSeconds = 10;
    state.referee.clockSeconds = periodNominalEndSeconds(4) - 0.1;
    advanceReferee(state, 1 / 60);
    expect(state.referee.phase).toBe("shootout");
    expect(state.referee.shootout).not.toBeNull();

    for (let index = 0; index < 40; index += 1) {
      advanceReferee(state, 2);
      if ((state.referee.phase as string) === "fullTime") {
        break;
      }
    }
    expect(state.referee.phase).toBe("fullTime");
    expect(state.referee.shootout?.winner).not.toBeNull();
  });

  it("ends early once the remaining kicks cannot change the result", () => {
    const { state, shootout } = prepare(44);
    const misses = Array.from({ length: TUNING.shootout.regulationKicks }, () => ({
      side: "away" as const,
      playerId: "away:p1",
      playerNumber: 1,
      scored: false,
    }));
    shootout.index = TUNING.shootout.regulationKicks * 2;
    shootout.homeScore = TUNING.shootout.regulationKicks;
    shootout.awayScore = 0;
    shootout.kicks.push(...misses);
    for (let index = 0; index < TUNING.shootout.regulationKicks; index += 1) {
      shootout.kicks.unshift({
        side: "home",
        playerId: "home:p1",
        playerNumber: 1,
        scored: true,
      });
    }

    takeShootoutKick(state);

    expect(shootout.winner).toBe("home");
    expect(shootout.timerSeconds).toBe(TUNING.shootout.finishDelaySeconds);
  });
});
