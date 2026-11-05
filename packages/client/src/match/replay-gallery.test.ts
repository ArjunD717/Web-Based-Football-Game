// packages/client/src/match/replay-gallery.test.ts
import { describe, expect, it } from "vitest";
import type { WireReplayClip } from "@fb/shared";
import {
  buildReplayGalleryItems,
  formatGoalMinute,
  formatHalf,
  parseReplayLibrary,
} from "./replay-gallery";

function clip(
  id: string,
  clockSeconds: number,
  half: WireReplayClip["half"],
): WireReplayClip {
  return {
    id,
    kind: "goal",
    scoreHome: 1,
    scoreAway: 0,
    clockSeconds,
    half,
    createdAtMs: 0,
    frameCount: 135,
  };
}

describe("replay gallery", () => {
  it("lists newest clips first with room-scoped downloads", () => {
    const items = buildReplayGalleryItems("ABCD", [
      clip("g1", 240, 1),
      clip("g2", 3_600, 2),
    ]);

    expect(items.map((item) => item.id)).toEqual(["g2", "g1"]);
    expect(items[0]).toMatchObject({
      href: "/api/replay/ABCD/g2.json",
      download: "replay-ABCD-g2.json",
      score: "1 – 0",
      meta: "60' · 2nd half · 135 frames",
    });
  });

  it("rejects malformed persisted library payloads", () => {
    expect(parseReplayLibrary(null)).toBeNull();
    expect(parseReplayLibrary({ rooms: "bad" })).toBeNull();
    expect(
      parseReplayLibrary({
        rooms: [
          {
            code: "ABCD",
            updatedAtMs: 10,
            clips: [{ ...clip("g1", 60, 1), half: 9 }],
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseReplayLibrary({
        rooms: [
          {
            code: "ABCD",
            updatedAtMs: 10,
            clips: [clip("g1", 60, 1)],
          },
        ],
      })?.rooms[0]?.clips,
    ).toHaveLength(1);
  });

  it("formats match minutes and extra time", () => {
    expect(formatGoalMinute(0)).toBe("1'");
    expect(formatGoalMinute(89 * 60)).toBe("89'");
    expect(formatGoalMinute(89 * 60 + 30)).toBe("90'");
    expect(formatGoalMinute(10_000)).toBe("120'");
    expect(formatHalf(1)).toBe("1st half");
    expect(formatHalf(2)).toBe("2nd half");
    expect(formatHalf(3)).toBe("extra time");
  });
});
