// packages/client/src/match/switch-target.test.ts
import { describe, expect, it } from "vitest";
import type { RenderPlayer } from "../render/view";
import { findNextSwitchTarget } from "./switch-target";

function player(
  id: string,
  x: number,
  y: number,
  options: Partial<RenderPlayer> = {},
): RenderPlayer {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    team: "home",
    goalkeeper: false,
    x,
    y,
    facing: 0,
    state: "idle",
    stamina: 1,
    sentOff: false,
    yellowCards: 0,
    controlled: false,
    switchTarget: false,
    ...options,
  };
}

describe("switch target preview", () => {
  it("cycles to the next player in ball-distance order", () => {
    const players = [
      player("p1", 10, 0, { controlled: true }),
      player("p2", 9, 0),
      player("p3", 12, 0),
      player("p4", 14, 0),
    ];
    const next = findNextSwitchTarget(players, 0, 0, false);
    expect(next?.id).toBe("p3");
  });

  it("includes the goalkeeper only when the ball is in the box", () => {
    const players = [
      player("p1", 10, 0, { controlled: true }),
      player("p2", 9, 0),
      player("p3", 1, 0, { goalkeeper: true }),
    ];
    expect(findNextSwitchTarget(players, 0, 0, false)?.id).toBe("p2");
    expect(findNextSwitchTarget(players, 0, 0, true)?.id).toBe("p3");
  });

  it("hides the preview without a controlled player or a second candidate", () => {
    expect(findNextSwitchTarget([], 0, 0, false)).toBeNull();
    const only = [player("p1", 1, 0, { controlled: true })];
    expect(findNextSwitchTarget(only, 0, 0, false)).toBeNull();
  });
});
