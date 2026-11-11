// packages/client/src/render/timeline-reset.test.ts

import { describe, expect, it } from "vitest";
import {
  TimelineResetTracker,
  shouldResetTimeline,
  timelineDirection,
} from "./timeline-reset";

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

describe("automated replay timeline acceptance", () => {
  it("resets once on reverse, pause, resume and seek without resetting normal playback", () => {
    const tracker = new TimelineResetTracker();
    let resets = 0;
    const step = (elapsed: number): void => {
      if (tracker.update(elapsed, 0.5)) {
        resets += 1;
      }
    };

    for (let frame = 0; frame <= 60; frame += 1) {
      step(frame / 10);
    }
    expect(resets).toBe(0);

    for (let frame = 60; frame >= 20; frame -= 1) {
      step(frame / 10);
    }
    expect(resets).toBe(1);

    for (let frame = 20; frame >= 10; frame -= 1) {
      step(frame / 10);
    }
    expect(resets).toBe(1);

    step(1.0);
    step(1.0);
    expect(resets).toBe(1);

    for (let frame = 11; frame <= 20; frame += 1) {
      step(frame / 10);
    }
    expect(resets).toBe(2);

    step(20);
    expect(resets).toBe(3);

    step(19);
    expect(resets).toBe(4);

    tracker.reset();
    step(3);
    expect(resets).toBe(4);
  });
});
