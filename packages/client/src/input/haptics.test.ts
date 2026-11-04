// packages/client/src/input/haptics.test.ts

import type { PlayerStateName, SnapshotFrame } from "@fb/shared";
import { describe, expect, it } from "vitest";
import {
  hapticStateFromSnapshot,
  transitionHaptics,
  type HapticTransitionState,
} from "./haptics";

function state(
  overrides: Partial<HapticTransitionState> = {},
): HapticTransitionState {
  return {
    scoreHome: 0,
    scoreAway: 0,
    eventSeq: 0,
    eventType: null,
    controlledState: "idle",
    ...overrides,
  };
}

describe("haptic transitions", () => {
  it("starts quiet and pulses only when a score increases", () => {
    const first = transitionHaptics(null, state());
    expect(first.cue).toBeNull();
    expect(transitionHaptics(first.state, state()).cue).toBeNull();
    expect(
      transitionHaptics(first.state, state({ scoreHome: 1 })).cue,
    ).toBe("goal");
    expect(
      transitionHaptics(state({ scoreHome: 1 }), state({ scoreHome: 0 })).cue,
    ).toBeNull();
  });

  it("maps cards, whistles and shootout goals from the event stream", () => {
    expect(
      transitionHaptics(
        state(),
        state({ eventSeq: 4, eventType: "yellowCard" }),
      ).cue,
    ).toBe("card");
    expect(
      transitionHaptics(
        state(),
        state({ eventSeq: 5, eventType: "redCard" }),
      ).cue,
    ).toBe("card");
    expect(
      transitionHaptics(
        state(),
        state({ eventSeq: 6, eventType: "foul" }),
      ).cue,
    ).toBe("whistle");
    expect(
      transitionHaptics(
        state(),
        state({ eventSeq: 7, eventType: "shootoutGoal" }),
      ).cue,
    ).toBe("goal");
  });

  it("only reacts to controlled-player action state transitions", () => {
    expect(
      transitionHaptics(state(), state({ controlledState: "shoot" })).cue,
    ).toBe("shot");
    expect(
      transitionHaptics(state(), state({ controlledState: "header" })).cue,
    ).toBe("shot");
    expect(
      transitionHaptics(state(), state({ controlledState: "slide" })).cue,
    ).toBe("tackle");
    expect(
      transitionHaptics(state(), state({ controlledState: "pass" })).cue,
    ).toBe("pass");
    expect(
      transitionHaptics(state(), state({ controlledState: "sprint" })).cue,
    ).toBeNull();
    expect(
      transitionHaptics(
        state({ controlledState: "shoot" }),
        state({ controlledState: "shoot" }),
      ).cue,
    ).toBeNull();
  });

  it("prioritises goals and consumes the event in the same snapshot", () => {
    const next = state({
      scoreHome: 1,
      eventSeq: 9,
      eventType: "yellowCard",
    });
    const transition = transitionHaptics(state(), next);
    expect(transition.cue).toBe("goal");
    expect(transition.state.eventSeq).toBe(9);
    expect(transitionHaptics(transition.state, next).cue).toBeNull();
  });

  it("selects the controlled player from the correct team slice", () => {
    const players: { state: PlayerStateName }[] = Array.from(
      { length: 22 },
      () => ({ state: "idle" }),
    );
    players[13]!.state = "tackle";
    const frame = {
      controlledHome: 3,
      controlledAway: 13,
      players,
      match: { scoreHome: 0, scoreAway: 0, lastEvent: null },
    } as unknown as SnapshotFrame;

    expect(hapticStateFromSnapshot(frame, "home").controlledState).toBe(
      "idle",
    );
    expect(hapticStateFromSnapshot(frame, "away").controlledState).toBe(
      "tackle",
    );
    expect(hapticStateFromSnapshot(frame, null).controlledState).toBeNull();
  });
});
