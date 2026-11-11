// packages/client/src/render/timeline-reset.test.ts

import { describe, expect, it } from "vitest";
import { shouldResetTimeline, timelineDirection } from "./timeline-reset";

describe("temporal timeline reset", () => {
  it("classifies forward, paused and reverse frames", () => {
    expect(timelineDirection(10, 10.2)).toBe(1);
    expect(timelineDirection(10, 10)).toBe(0);
    expect(timelineDirection(10, 9.8)).toBe(-1);
  });

  it("resets when replay changes direction", () => {
    expect(shouldResetTimeline(1, -1, -0.1, 0.5)).toBe(true);
    expect(shouldResetTimeline(-1, 1, 0.1, 0.5)).toBe(true);
    expect(shouldResetTimeline(1, 1, 0.1, 0.5)).toBe(false);
    expect(shouldResetTimeline(1, 0, 0, 0.5)).toBe(false);
  });

  it("resets on a large seek or loop jump", () => {
    expect(shouldResetTimeline(1, 1, 1.2, 0.5)).toBe(true);
    expect(shouldResetTimeline(-1, -1, -1.2, 0.5)).toBe(true);
    expect(shouldResetTimeline(1, 1, 0.5, 0.5)).toBe(false);
  });
});
