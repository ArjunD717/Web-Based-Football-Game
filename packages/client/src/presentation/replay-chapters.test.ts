// packages/client/src/presentation/replay-chapters.test.ts
import { describe, expect, it } from "vitest";
import type { SnapshotEvent, SnapshotFrame } from "@fb/shared";
import { buildReplayChapters } from "./replay-chapters";

function frame(
  options: {
    home?: number;
    away?: number;
    phase?: SnapshotFrame["match"]["phase"];
    event?: SnapshotEvent | null;
  } = {},
): SnapshotFrame {
  return {
    match: {
      scoreHome: options.home ?? 0,
      scoreAway: options.away ?? 0,
      phase: options.phase ?? "live",
      lastEvent: options.event ?? null,
    },
  } as unknown as SnapshotFrame;
}

function event(
  seq: number,
  type: SnapshotEvent["type"],
  playerNumber: number | null = 7,
): SnapshotEvent {
  return { seq, type, side: "home", playerNumber };
}

describe("replay chapters", () => {
  it("marks score changes, cards and the final whistle once", () => {
    const frames = [
      frame(),
      frame(),
      frame({ home: 1 }),
      frame({ home: 1, event: event(9, "yellowCard") }),
      frame({ home: 1, event: event(9, "yellowCard") }),
      frame({ home: 1, event: event(10, "redCard") }),
      frame({ home: 1, phase: "fullTime" }),
      frame({ home: 1, phase: "fullTime" }),
    ];
    const chapters = buildReplayChapters(frames, 1_000);

    expect(chapters.map((chapter) => chapter.kind)).toEqual([
      "goal",
      "yellowCard",
      "redCard",
      "fullTime",
    ]);
    expect(chapters.map((chapter) => chapter.frameIndex)).toEqual([
      2, 3, 5, 6,
    ]);
    expect(chapters[0]?.label).toBe("Goal 1–0");
    expect(chapters[1]?.label).toBe("Yellow · home #7");
    expect(chapters[3]?.progress).toBeCloseTo(6 / 7, 5);
  });

  it("ignores an event already active at the start of the clip", () => {
    const frames = [
      frame({ event: event(4, "yellowCard") }),
      frame({ event: event(4, "yellowCard") }),
      frame(),
    ];
    expect(buildReplayChapters(frames, 1_000)).toEqual([]);
  });
});
