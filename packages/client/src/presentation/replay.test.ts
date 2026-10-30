// packages/client/src/presentation/replay.test.ts

import { describe, expect, it } from "vitest";
import type { MatchView } from "../render/view";
import { MatchReplayBuffer } from "./replay";

function view(tick: number): MatchView {
  return { tick } as MatchView;
}

describe("match replay buffer", () => {
  it("keeps live frames and only exposes a clip after a goal", () => {
    const replay = new MatchReplayBuffer({
      captureMs: 10_000,
      goalWindowMs: 4_000,
      speed: 0.5,
    });
    expect(replay.record(view(1), 0, 0, 0)).toBe(false);
    expect(replay.record(view(2), 0, 0, 1_000)).toBe(false);
    expect(replay.hasClip).toBe(false);
    expect(replay.record(view(3), 1, 0, 2_000)).toBe(true);
    expect(replay.hasClip).toBe(true);
    expect(replay.durationMs).toBe(2_000);
  });

  it("samples the clip at the configured slow-motion speed and stops", () => {
    const replay = new MatchReplayBuffer({
      captureMs: 10_000,
      goalWindowMs: 10_000,
      speed: 0.5,
    });
    replay.record(view(1), 0, 0, 0);
    replay.record(view(2), 0, 0, 1_000);
    replay.record(view(3), 1, 0, 2_000);
    expect(replay.start(10_000)).toBe(true);
    expect(replay.active).toBe(true);

    const middle = replay.sample(12_000);
    expect(middle).not.toBeNull();
    expect(middle?.progress).toBeCloseTo(0.5, 5);
    expect(middle?.view.tick).toBe(2);

    expect(replay.sample(14_001)).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("does not create a clip without a score change and can be stopped", () => {
    const replay = new MatchReplayBuffer();
    replay.record(view(1), 0, 0, 0);
    replay.record(view(2), 0, 0, 100);
    expect(replay.start(200)).toBe(false);
    expect(replay.active).toBe(false);

    replay.record(view(3), 0, 1, 300);
    expect(replay.start(400)).toBe(true);
    replay.stop();
    expect(replay.active).toBe(false);
    expect(replay.sample(500)).toBeNull();
  });
});
