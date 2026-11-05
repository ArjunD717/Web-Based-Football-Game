// packages/client/src/character/pose.test.ts

import { describe, expect, it } from "vitest";
import { poseFrame } from "./pose";

describe("character lab poses", () => {
  it("keeps the feet grounded during locomotion", () => {
    for (const name of ["idle", "jog", "sprint"] as const) {
      for (let t = 0; t < 2; t += 0.17) {
        expect(poseFrame(name, t).rootLift).toBeGreaterThanOrEqual(0);
        expect(poseFrame(name, t).rootLift).toBeLessThan(0.03);
      }
    }
  });

  it("lifts the character through a leap and brings them back down", () => {
    const heights = Array.from({ length: 24 }, (_, i) =>
      poseFrame("leap", i / 20).rootLift,
    );
    expect(Math.max(...heights)).toBeGreaterThan(0.25);
    expect(Math.min(...heights)).toBeLessThan(0.02);
  });

  it("raises both arms above the shoulders for a celebration", () => {
    const frame = poseFrame("celebrate", 0.4);
    expect(frame.rotations.upperarm_l?.z).toBeLessThan(-2);
    expect(frame.rotations.upperarm_r?.z).toBeGreaterThan(2);
  });
});
