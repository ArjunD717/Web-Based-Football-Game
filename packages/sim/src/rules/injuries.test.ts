// packages/sim/src/rules/injuries.test.ts

import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import { assessInjury } from "./injuries";

describe("injury assessment", () => {
  it("is deterministic for the same seed, tick and contact", () => {
    const state = createMatch({ seed: 91 });
    const player = state.home.players[4];
    if (player === undefined) {
      throw new Error("No player");
    }
    const first = assessInjury(91, 120, player, 0.7, true);
    const second = assessInjury(91, 120, player, 0.7, true);
    expect(second).toEqual(first);
  });

  it("increases risk with contact severity, proneness and contact from behind", () => {
    const state = createMatch({ seed: 92 });
    const base = state.home.players[4];
    if (base === undefined) {
      throw new Error("No player");
    }
    const light = assessInjury(92, 200, base, 0.1, false);
    const heavy = assessInjury(92, 200, base, 1.2, false);
    const behind = assessInjury(92, 200, base, 1.2, true);
    const pronePlayer = {
      ...base,
      attributes: { ...base.attributes, injuryProneness: 99 },
    };
    const prone = assessInjury(92, 200, pronePlayer, 1.2, true);

    expect(heavy.risk).toBeGreaterThan(light.risk);
    expect(behind.risk).toBeGreaterThan(heavy.risk);
    expect(prone.risk).toBeGreaterThan(behind.risk);
    expect(behind.risk).toBeLessThanOrEqual(0.9);
    expect(prone.risk).toBeLessThanOrEqual(0.9);
  });

  it("marks serious contact as potentially unplayable", () => {
    const state = createMatch({ seed: 93 });
    const player = state.home.players[4];
    if (player === undefined) {
      throw new Error("No player");
    }
    const serious = assessInjury(93, 300, player, 1.2, true);
    if (serious.injured && serious.severity > 0.55) {
      expect(typeof serious.canPlayOn).toBe("boolean");
    }
    expect(serious.severity).toBeGreaterThan(0.55);
  });
});
