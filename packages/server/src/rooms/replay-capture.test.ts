// packages/server/src/rooms/replay-capture.test.ts
import { describe, expect, it } from "vitest";
import type { SnapshotFrame } from "@fb/shared";
import {
  GOAL_REPLAY_POST_SNAPSHOTS,
  GOAL_REPLAY_PRE_SNAPSHOTS,
  advanceGoalReplay,
  beginGoalReplay,
  finishGoalReplay,
} from "./replay-capture";

function frame(
  seq: number,
  scoreHome = 0,
  scoreAway = 0,
): SnapshotFrame {
  return { seq, match: { scoreHome, scoreAway } } as unknown as SnapshotFrame;
}

describe("goal replay capture", () => {
  it("keeps the last pre-goal window and closes after the post window", () => {
    const history = Array.from(
      { length: GOAL_REPLAY_PRE_SNAPSHOTS + 10 },
      (_, index) => frame(index + 1, 1, 0),
    );
    const capture = beginGoalReplay("g1", history, 5_000);

    expect(capture.frames).toHaveLength(GOAL_REPLAY_PRE_SNAPSHOTS);
    expect(capture.frames[0]?.seq).toBe(11);
    expect(capture.frames.at(-1)?.seq).toBe(100);
    expect(capture.scoreHome).toBe(1);
    expect(capture.scoreAway).toBe(0);

    for (let index = 0; index < GOAL_REPLAY_POST_SNAPSHOTS - 1; index += 1) {
      expect(advanceGoalReplay(capture, frame(101 + index))).toBeNull();
    }
    const clip = advanceGoalReplay(
      capture,
      frame(100 + GOAL_REPLAY_POST_SNAPSHOTS),
    );

    expect(clip).not.toBeNull();
    expect(clip?.id).toBe("g1");
    expect(clip?.createdAtMs).toBe(5_000);
    expect(clip?.frames).toHaveLength(
      GOAL_REPLAY_PRE_SNAPSHOTS + GOAL_REPLAY_POST_SNAPSHOTS,
    );
  });

  it("can finish early without mutating the retained identity", () => {
    const capture = beginGoalReplay("g2", [frame(1, 2, 1)], 9_000);
    const clip = finishGoalReplay(capture);
    expect(clip).toMatchObject({
      id: "g2",
      createdAtMs: 9_000,
      scoreHome: 2,
      scoreAway: 1,
    });
    expect(clip.frames).toHaveLength(1);
  });
});
