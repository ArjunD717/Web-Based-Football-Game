// packages/client/src/presentation/review-queue-storage.test.ts
import { describe, expect, it } from "vitest";
import {
  parseReviewQueue,
  serializeReviewQueue,
  type StoredReviewClip,
} from "./review-queue-storage";

const clip = {
  id: "goal-1",
  kind: "goal" as const,
  scoreHome: 2,
  scoreAway: 1,
  clockSeconds: 1_800,
  half: 2 as const,
  createdAtMs: 1_760_000_000_000,
  frameCount: 90,
};

describe("review queue storage", () => {
  it("round-trips valid clips in selection order", () => {
    const items: StoredReviewClip[] = [
      { roomCode: "ABCD", clip },
      { roomCode: "WXYZ", clip: { ...clip, id: "goal-2" } },
    ];
    expect(parseReviewQueue(serializeReviewQueue(items))).toEqual(items);
  });

  it("rejects malformed entries and removes duplicates", () => {
    const raw = JSON.stringify([
      { roomCode: "ABCD", clip },
      { roomCode: "ABCD", clip },
      { roomCode: "bad", clip },
      { roomCode: "WXYZ", clip: { ...clip, half: 5 } },
      null,
    ]);
    expect(parseReviewQueue(raw)).toEqual([
      { roomCode: "ABCD", clip },
    ]);
  });

  it("treats missing or corrupt storage as an empty queue", () => {
    expect(parseReviewQueue(null)).toEqual([]);
    expect(parseReviewQueue("{not json")).toEqual([]);
    expect(parseReviewQueue(JSON.stringify({}))).toEqual([]);
  });
});
