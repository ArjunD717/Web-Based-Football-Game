// packages/client/src/render/character-clip-plan.test.ts

import { describe, expect, it } from "vitest";
import { PLAYER_STATE_CODES } from "@fb/shared";
import {
  AUTHORED_CLIP_PLAN,
  clipSpecFor,
} from "./character-clip-plan";

describe("authored match clip plan", () => {
  it("covers every player state exactly once", () => {
    expect(AUTHORED_CLIP_PLAN.map((spec) => spec.state).sort()).toEqual(
      [...PLAYER_STATE_CODES].sort(),
    );
  });

  it("has positive durations and marks loops explicitly", () => {
    const loops = new Set(["idle", "jog", "sprint", "dribble", "injured", "celebrate"]);
    for (const spec of AUTHORED_CLIP_PLAN) {
      expect(spec.durationSeconds).toBeGreaterThan(0);
      expect(spec.loop).toBe(loops.has(spec.state));
    }
  });

  it("returns the configured clip for a state", () => {
    expect(clipSpecFor("shoot")?.durationSeconds).toBe(0.7);
    expect(clipSpecFor("shoot")?.loop).toBe(false);
    expect(clipSpecFor("idle")?.phaseScale).toBeCloseTo(1 / 0.75);
  });
});
