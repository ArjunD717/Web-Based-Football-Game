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

  it("replays the full retained capture without requiring a goal", () => {
    const replay = new MatchReplayBuffer({
      captureMs: 10_000,
      speed: 1,
    });
    replay.record(view(1), 0, 0, 0);
    expect(replay.hasCapture).toBe(false);
    expect(replay.captureDurationMs).toBe(0);

    replay.record(view(2), 0, 0, 1_000);
    expect(replay.hasCapture).toBe(true);
    expect(replay.captureDurationMs).toBe(1_000);
    replay.record(view(3), 0, 0, 2_000);
    expect(replay.startCapture(3_000)).toBe(true);
    expect(replay.active).toBe(true);

    const sample = replay.sample(4_000);
    expect(sample?.durationMs).toBe(2_000);
    expect(sample?.view.tick).toBe(2);
    expect(replay.sample(4_999)?.view.tick).toBe(3);
  });

  it("plays a saved clip with synthetic timestamps", () => {
    const replay = new MatchReplayBuffer({ speed: 1 });
    expect(replay.loadSaved([])).toBe(false);
    expect(
      replay.loadSaved([
        { view: view(10), recordedAtMs: 0 },
        { view: view(11), recordedAtMs: 1_000 },
        { view: view(12), recordedAtMs: 2_000 },
      ]),
    ).toBe(true);
    expect(replay.hasSavedClip).toBe(true);
    expect(replay.startSaved(5_000)).toBe(true);
    expect(replay.sample(6_000)).toMatchObject({
      progress: 0.5,
      durationMs: 2_000,
      view: { tick: 11 },
    });
    expect(replay.sample(7_001)).toBeNull();
  });

  it("pauses, seeks and steps through a saved clip", () => {
    const replay = new MatchReplayBuffer({ speed: 1 });
    replay.loadSaved([
      { view: view(10), recordedAtMs: 0 },
      { view: view(11), recordedAtMs: 1_000 },
      { view: view(12), recordedAtMs: 2_000 },
    ]);
    expect(replay.startSaved(0)).toBe(true);
    expect(replay.pause(500)).toBe(true);
    expect(replay.sample(5_000)).toMatchObject({
      progress: 0.25,
      paused: true,
    });
    expect(replay.stepFrame(1, 5_000)).toBe(true);
    expect(replay.sample(5_000)?.view.tick).toBe(11);
    expect(replay.stepFrame(1, 5_000)).toBe(true);
    expect(replay.sample(5_000)?.view.tick).toBe(12);
    expect(replay.seek(0.5, 5_000)).toBe(true);
    expect(replay.sample(5_000)).toMatchObject({
      progress: 0.5,
      paused: true,
    });
    expect(replay.resume(5_000)).toBe(true);
    expect(replay.sample(6_100)).toBeNull();
  });

  it("changes speed without jumping the clip position", () => {
    const replay = new MatchReplayBuffer({ speed: 0.5 });
    replay.loadSaved([
      { view: view(10), recordedAtMs: 0 },
      { view: view(11), recordedAtMs: 1_000 },
      { view: view(12), recordedAtMs: 2_000 },
      { view: view(13), recordedAtMs: 3_000 },
    ]);
    expect(replay.startSaved(0)).toBe(true);
    expect(replay.sample(1_000)?.elapsedMs).toBeCloseTo(500, 5);
    replay.setSpeed(1, 1_000);
    expect(replay.sample(1_500)?.elapsedMs).toBeCloseTo(1_000, 5);
    expect(replay.speed).toBe(1);
  });

  it("loops the whole clip when requested", () => {
    const replay = new MatchReplayBuffer({ speed: 1 });
    replay.loadSaved([
      { view: view(10), recordedAtMs: 0 },
      { view: view(11), recordedAtMs: 1_000 },
      { view: view(12), recordedAtMs: 2_000 },
    ]);
    expect(replay.startSaved(0)).toBe(true);
    const looped = replay.sample(2_500, true);
    expect(looped).toMatchObject({
      progress: 0.25,
      elapsedMs: 500,
      wrapped: true,
      view: { tick: 10 },
    });
    expect(replay.active).toBe(true);
    expect(replay.sample(3_500, true)?.progress).toBeCloseTo(0.75, 5);
  });

  it("keeps the shorter goal clip available after a full replay", () => {
    const replay = new MatchReplayBuffer({
      captureMs: 10_000,
      goalWindowMs: 1_000,
      speed: 1,
    });
    replay.record(view(1), 0, 0, 0);
    replay.record(view(2), 0, 0, 1_000);
    replay.record(view(3), 1, 0, 2_000);

    expect(replay.hasClip).toBe(true);
    expect(replay.startCapture(3_000)).toBe(true);
    replay.stop();
    expect(replay.start(4_000)).toBe(true);
    expect(replay.sample(4_500)?.durationMs).toBe(1_000);
  });
});
