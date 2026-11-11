// packages/client/src/presentation/replay-taa-acceptance.test.ts

import { describe, expect, it } from "vitest";
import { TimelineResetTracker } from "../render/timeline-reset";
import type { MatchView } from "../render/view";
import { MatchReplayBuffer } from "./replay";

function replayView(index: number): MatchView {
  return {
    tick: index,
    elapsedSeconds: index / 10,
  } as MatchView;
}

describe("recorded replay to temporal AA acceptance", () => {
  it("resets only when recorded playback changes direction or jumps", () => {
    const frames = Array.from({ length: 21 }, (_, index) => ({
      view: replayView(index),
      recordedAtMs: index * 100,
    }));
    const replay = new MatchReplayBuffer({ speed: 1 });
    const tracker = new TimelineResetTracker();
    let resets = 0;

    expect(replay.loadSaved(frames)).toBe(true);
    expect(replay.startSaved(0)).toBe(true);

    const consume = (nowMs: number, loop = false): number => {
      const sample = replay.sample(nowMs, loop);
      expect(sample).not.toBeNull();
      if (tracker.update(sample!.view.elapsedSeconds, 0.5)) {
        resets += 1;
      }
      return sample!.view.tick;
    };

    for (const nowMs of [0, 500, 1_000, 1_500, 1_900]) {
      consume(nowMs);
    }
    expect(resets).toBe(0);

    expect(replay.pause(2_000)).toBe(true);
    expect(consume(2_000)).toBe(20);
    expect(replay.stepFrame(-1, 2_000)).toBe(true);
    expect(consume(2_000)).toBe(19);
    expect(resets).toBe(1);
    expect(replay.stepFrame(-1, 2_000)).toBe(true);
    expect(consume(2_000)).toBe(18);
    expect(resets).toBe(1);

    expect(replay.stepFrame(1, 2_000)).toBe(true);
    expect(consume(2_000)).toBe(19);
    expect(resets).toBe(2);

    expect(replay.seek(0.1, 2_000)).toBe(true);
    expect(consume(2_000)).toBe(2);
    expect(resets).toBe(3);

    expect(replay.resume(2_000)).toBe(true);
    expect(replay.seek(0.95, 2_000)).toBe(true);
    expect(consume(2_000)).toBe(19);
    expect(resets).toBe(4);

    expect(consume(2_200, true)).toBe(1);
    expect(resets).toBe(5);
  });
});
