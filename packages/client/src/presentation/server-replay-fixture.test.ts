// packages/client/src/presentation/server-replay-fixture.test.ts

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplayExport } from "../match/replay-gallery";
import { WireViewBuilder } from "../match/view-from-wire";
import { MatchReplayBuffer } from "./replay";

const fixtureUrl = new URL(
  "../../public/fixtures/server-goal-replay.json",
  import.meta.url,
);

describe("server-captured replay fixture", () => {
  it("round-trips real room frames through the client replay path", () => {
    const value: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    const parsed = parseReplayExport(value);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(parsed.code).toBe("ABCD");
    expect(parsed.id).toBe("g2");
    expect(parsed.setup.snapshotHz).toBe(30);
    expect(parsed.frames.length).toBeGreaterThan(90);

    const builder = new WireViewBuilder(parsed.setup, null);
    const views = parsed.frames.flatMap((frame) => {
      const view = builder.build(frame);
      return view === null ? [] : [view];
    });
    expect(views).toHaveLength(parsed.frames.length);
    for (let index = 0; index < parsed.frames.length; index += 1) {
      const frame = parsed.frames[index];
      if (frame === undefined) {
        continue;
      }
      expect(frame.players).toHaveLength(22);
      expect(views[index]?.home.players).toHaveLength(11);
      expect(views[index]?.away.players).toHaveLength(11);
      if (index > 0) {
        expect(frame.tick).toBeGreaterThan(
          parsed.frames[index - 1]?.tick ?? -1,
        );
        expect(frame.match.clockSeconds).toBeGreaterThanOrEqual(
          parsed.frames[index - 1]?.match.clockSeconds ?? 0,
        );
      }
    }
  });

  it("interpolates between the captured 30 Hz snapshots", () => {
    const value: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    const parsed = parseReplayExport(value);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    const builder = new WireViewBuilder(parsed.setup, null);
    const frames = parsed.frames.flatMap((frame, index) => {
      const view = builder.build(frame);
      return view === null
        ? []
        : [{ view, recordedAtMs: index * (1_000 / parsed.setup.snapshotHz) }];
    });
    const replay = new MatchReplayBuffer({ speed: 1, interpolate: true });
    expect(replay.loadSaved(frames)).toBe(true);
    expect(replay.startSaved(0)).toBe(true);
    const first = replay.sample(1_400);
    const between = replay.sample(1_416);
    expect(first).not.toBeNull();
    expect(between).not.toBeNull();
    if (first === null || between === null) {
      return;
    }
    expect(between.view.tick).toBe(first.view.tick + 1);
    expect(between.view.elapsedSeconds).toBeGreaterThan(
      first.view.elapsedSeconds,
    );
    const firstPlayer = first.view.home.players[0];
    const blendedPlayer = between.view.home.players[0];
    expect(firstPlayer).toBeDefined();
    expect(blendedPlayer).toBeDefined();
    const moved =
      firstPlayer !== undefined &&
      blendedPlayer !== undefined &&
      (Math.abs(blendedPlayer.x - firstPlayer.x) > 1e-6 ||
        Math.abs(blendedPlayer.y - firstPlayer.y) > 1e-6 ||
        Math.abs(blendedPlayer.facing - firstPlayer.facing) > 1e-6);
    const ballMoved = Math.abs(between.view.ball.x - first.view.ball.x) > 1e-6;
    expect(moved || ballMoved).toBe(true);
  });
});
