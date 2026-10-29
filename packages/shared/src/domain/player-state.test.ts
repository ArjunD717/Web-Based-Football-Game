// packages/shared/src/domain/player-state.test.ts
import { describe, expect, it } from "vitest";
import {
  PLAYER_STATE_CODES,
  isPlayerStateCode,
  playerStateCode,
  playerStateName,
} from "./player-state";

describe("player state codes", () => {
  it("round-trips every state", () => {
    for (const state of PLAYER_STATE_CODES) {
      expect(playerStateName(playerStateCode(state))).toBe(state);
    }
  });

  it("rejects out-of-range codes", () => {
    expect(isPlayerStateCode(-1)).toBe(false);
    expect(isPlayerStateCode(PLAYER_STATE_CODES.length)).toBe(false);
    expect(isPlayerStateCode(0)).toBe(true);
    expect(() => playerStateName(999)).toThrow(RangeError);
  });
});
