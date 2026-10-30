// packages/sim/src/rules/management.test.ts

import { TUNING, type PlayerPosition } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import type { MatchState, PlayerState } from "../types";
import {
  applySubstitutions,
  ensureGoalkeeper,
  maxSubstitutions,
  maxWindows,
  resetSubstitutionWindows,
  substitutionsAllowed,
} from "./management";
import { substitutePlayers } from "./referee";

function addBenchPlayer(
  state: MatchState,
  source: PlayerState,
  id: string,
  number: number,
): { id: string } {
  const position: PlayerPosition =
    source.role === "GK" ? "GK" : (source.role as PlayerPosition);
  const player: PlayerState = { ...source, id, number };
  state.home.bench.push({
    player,
    positions: [position],
    preferredPosition: position,
  });
  return { id };
}

function replacementFor(
  state: MatchState,
  index: number,
  excludedOutIds: readonly string[] = [],
): { outId: string; inId: string } {
  const outgoing = state.home.players.find(
    (player) =>
      player.role !== "GK" &&
      !player.sentOff &&
      !excludedOutIds.includes(player.id),
  );
  if (outgoing === undefined) {
    throw new Error("No outfield player");
  }
  const source = state.home.players.find(
    (player) => player.role !== "GK" && player.id !== outgoing.id,
  );
  if (source === undefined) {
    throw new Error("No bench source");
  }
  const incoming = addBenchPlayer(
    state,
    source,
    `home:bench-${index}`,
    40 + index,
  );
  return { outId: outgoing.id, inId: incoming.id };
}

describe("substitutions", () => {
  it("is only allowed while the ball is dead or at half-time", () => {
    const state = createMatch({ seed: 7 });
    expect(state.referee.phase).toBe("deadBall");
    expect(substitutionsAllowed(state)).toBe(true);
    state.referee.phase = "live";
    expect(substitutionsAllowed(state)).toBe(false);
    state.referee.phase = "halfTime";
    expect(substitutionsAllowed(state)).toBe(true);
  });

  it("applies a substitution, consumes a window and records the stoppage", () => {
    const state = createMatch({ seed: 8 });
    const { outId, inId } = replacementFor(state, 1);
    const before = state.referee.stoppageSeconds;

    const result = substitutePlayers(state, "home", [{ outId, inId }]);

    expect(result).toMatchObject({ ok: true, applied: 1, windowUsed: true });
    expect(state.home.players.some((player) => player.id === outId)).toBe(false);
    expect(state.home.players.some((player) => player.id === inId)).toBe(true);
    expect(state.home.bench.some((sub) => sub.player.id === inId)).toBe(false);
    expect(state.home.substitutionsUsed).toBe(1);
    expect(state.home.substitutionWindowsUsed).toBe(1);
    expect(state.home.substitutionWindowUsed).toBe(true);
    expect(state.referee.stoppageSeconds).toBe(
      before + TUNING.match.addedTimeSubstitutionSeconds,
    );
    expect(state.referee.lastEvent?.type).toBe("substitution");
    expect(state.referee.lastEvent?.side).toBe("home");
  });

  it("groups several changes into one window and reuses the window once", () => {
    const state = createMatch({ seed: 9 });
    const first = replacementFor(state, 1);
    const second = replacementFor(state, 2, [first.outId]);
    const grouped = applySubstitutions(state, "home", [first, second]);
    expect(grouped).toMatchObject({ ok: true, applied: 2, windowUsed: true });
    expect(state.home.substitutionWindowsUsed).toBe(1);

    const third = replacementFor(state, 3);
    const sameWindow = applySubstitutions(state, "home", [third]);
    expect(sameWindow).toMatchObject({
      ok: true,
      applied: 1,
      windowUsed: false,
    });
    expect(state.home.substitutionWindowsUsed).toBe(1);
    expect(state.home.substitutionsUsed).toBe(3);

    resetSubstitutionWindows(state);
    const fourth = replacementFor(state, 4);
    const nextWindow = applySubstitutions(state, "home", [fourth]);
    expect(nextWindow.windowUsed).toBe(true);
    expect(state.home.substitutionWindowsUsed).toBe(2);
  });

  it("rejects sent-off players, non-goalkeeper replacements and exhausted allowances", () => {
    const state = createMatch({ seed: 10 });
    const sentOff = state.home.players.find((player) => player.role !== "GK");
    if (sentOff === undefined) {
      throw new Error("No outfielder");
    }
    sentOff.sentOff = true;
    const source = state.home.players.find(
      (player) => player.id !== sentOff.id && player.role !== "GK",
    );
    if (source === undefined) {
      throw new Error("No bench source");
    }
    const incoming = addBenchPlayer(state, source, "home:bench-sent-off", 41);
    const rejected = applySubstitutions(state, "home", [
      { outId: sentOff.id, inId: incoming.id },
    ]);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toContain("sent-off");

    const goalkeeper = state.home.players.find((player) => player.role === "GK");
    if (goalkeeper === undefined) {
      throw new Error("No goalkeeper");
    }
    const outfieldSub = addBenchPlayer(state, source, "home:bench-gk", 42);
    const gkRejected = applySubstitutions(state, "home", [
      { outId: goalkeeper.id, inId: outfieldSub.id },
    ]);
    expect(gkRejected.ok).toBe(false);
    expect(gkRejected.reason).toContain("goalkeeper");

    state.home.substitutionsUsed = maxSubstitutions(state);
    const exhausted = replacementFor(state, 5);
    const noAllowance = applySubstitutions(state, "home", [exhausted]);
    expect(noAllowance.ok).toBe(false);
    expect(noAllowance.reason).toContain("allowance");
  });

  it("adds one substitution and one window in extra time", () => {
    const state = createMatch({ seed: 11 });
    const regulation = maxSubstitutions(state);
    const regulationWindows = maxWindows(state);
    state.referee.half = 3;
    expect(maxSubstitutions(state)).toBe(regulation + 1);
    expect(maxWindows(state)).toBe(regulationWindows + 1);
  });

  it("promotes the best outfielder when the goalkeeper is sent off", () => {
    const state = createMatch({ seed: 12 });
    const goalkeeper = state.home.players.find((player) => player.role === "GK");
    if (goalkeeper === undefined) {
      throw new Error("No goalkeeper");
    }
    goalkeeper.sentOff = true;
    const promoted = ensureGoalkeeper(state, "home");
    expect(promoted).not.toBeNull();
    expect(promoted?.role).toBe("GK");
    expect(promoted?.sentOff).toBe(false);
    expect(ensureGoalkeeper(state, "home")?.id).toBe(promoted?.id);
  });
});
