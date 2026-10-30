// packages/sim/src/rules/clock.test.ts

import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  addStoppage,
  addedTimeRemainingSeconds,
  finaliseAddedTime,
  isPastAddedTime,
  periodNominalEndSeconds,
  periodStartSeconds,
  updateMatchClock,
} from "./clock";

describe("match clock", () => {
  it("maps regulation and extra-time periods onto a continuous clock", () => {
    expect(periodStartSeconds(1)).toBe(0);
    expect(periodStartSeconds(2)).toBe(
      TUNING.match.gameMinutesPerHalf * 60,
    );
    expect(periodStartSeconds(3)).toBe(90 * 60);
    expect(periodStartSeconds(4)).toBe(105 * 60);
    expect(periodNominalEndSeconds(1)).toBe(45 * 60);
    expect(periodNominalEndSeconds(2)).toBe(90 * 60);
    expect(periodNominalEndSeconds(4)).toBe(120 * 60);
  });

  it("rounds accumulated stoppages up to the board increment and caps them", () => {
    const state = createMatch({ seed: 101 });
    state.referee.stoppageSeconds = 61;
    expect(finaliseAddedTime(state)).toBe(120);
    state.referee.stoppageSeconds = 0;
    expect(finaliseAddedTime(state)).toBe(0);
    state.referee.stoppageSeconds = 10_000;
    expect(finaliseAddedTime(state)).toBe(
      TUNING.match.addedTimeCapSeconds,
    );
  });

  it("ignores late stoppages once the board is finalised", () => {
    const state = createMatch({ seed: 102 });
    state.referee.stoppageSeconds = 30;
    addStoppage(state, 20);
    expect(state.referee.stoppageSeconds).toBe(50);
    state.referee.regulationExpired = true;
    addStoppage(state, 20);
    expect(state.referee.stoppageSeconds).toBe(50);
    state.referee.regulationExpired = false;
    state.referee.phase = "fullTime";
    addStoppage(state, 20);
    expect(state.referee.stoppageSeconds).toBe(50);
  });

  it("arms the board at regulation time and ends only at a natural pause", () => {
    const state = createMatch({ seed: 103 });
    state.referee.phase = "live";
    state.referee.stoppageSeconds = 61;
    state.referee.clockSeconds = periodNominalEndSeconds(1) - 0.1;
    state.referee.regulationExpired = false;

    expect(updateMatchClock(state, 1 / 60)).toBe(false);
    expect(state.referee.regulationExpired).toBe(true);
    expect(state.referee.addedTimeSeconds).toBe(120);
    expect(state.referee.clockSeconds).toBeGreaterThanOrEqual(
      periodNominalEndSeconds(1),
    );
    expect(isPastAddedTime(state)).toBe(false);

    state.referee.clockSeconds =
      periodNominalEndSeconds(1) + state.referee.addedTimeSeconds - 0.1;
    expect(updateMatchClock(state, 1 / 60)).toBe(false);
    expect(isPastAddedTime(state)).toBe(true);
    expect(addedTimeRemainingSeconds(state)).toBe(0);

    state.referee.phase = "deadBall";
    expect(updateMatchClock(state, 1 / 60)).toBe(true);
    state.referee.phase = "fullTime";
    expect(updateMatchClock(state, 1)).toBe(false);
  });
});
