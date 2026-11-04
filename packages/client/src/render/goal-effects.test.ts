// packages/client/src/render/goal-effects.test.ts

import { describe, expect, it } from "vitest";
import {
  crowdCelebrationStrength,
  netRippleStrength,
} from "./goal-effects";

describe("goal moment envelopes", () => {
  it("starts quietly, peaks quickly then decays the net ripple", () => {
    expect(netRippleStrength(0, 1.4)).toBe(0);
    const early = netRippleStrength(0.02, 1.4);
    const peak = netRippleStrength(0.06, 1.4);
    const late = netRippleStrength(0.8, 1.4);
    expect(peak).toBeGreaterThan(early);
    expect(peak).toBeGreaterThan(late);
    expect(netRippleStrength(1.4, 1.4)).toBe(0);
    expect(netRippleStrength(2, 1.4)).toBe(0);
  });

  it("lights the crowd immediately and fades to zero", () => {
    expect(crowdCelebrationStrength(0, 2.8)).toBeCloseTo(1, 5);
    expect(crowdCelebrationStrength(1.4, 2.8)).toBeLessThan(0.5);
    expect(crowdCelebrationStrength(2.8, 2.8)).toBe(0);
    expect(crowdCelebrationStrength(-1, 2.8)).toBe(0);
  });
});
