// packages/client/src/camera/context/contextTrigger.test.ts

import { describe, expect, it } from "vitest";
import type { SnapshotEvent, SnapshotMatch } from "@fb/shared";
import { createPitch } from "@fb/sim";
import type { MatchView, RenderPlayer } from "../../render/view";
import {
  createContextMemory,
  nextContextTrigger,
} from "./contextTrigger";

const pitch = createPitch();

function player(
  id: string,
  team: "home" | "away",
  x: number,
  y: number,
  number = 1,
): RenderPlayer {
  return {
    id,
    number,
    team,
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
  };
}

function match(overrides: Partial<SnapshotMatch> = {}): SnapshotMatch {
  return {
    phase: "live",
    half: 1,
    clockSeconds: 0,
    addedTimeSeconds: 0,
    scoreHome: 0,
    scoreAway: 0,
    restartType: null,
    restartSide: null,
    lastEvent: null,
    ...overrides,
  };
}

function view(matchState: SnapshotMatch = match()): MatchView {
  return {
    matchId: "test-match",
    pitch,
    tick: 1,
    elapsedSeconds: 0,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#ff0" },
      players: [
        player("home:9", "home", 90, 34, 9),
        player("home:4", "home", 50, 34, 4),
      ],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#0f0" },
      players: [
        player("away:9", "away", 15, 34, 9),
        player("away:4", "away", 55, 34, 4),
      ],
    },
    ball: { x: 95, y: 34, z: 0.2, vx: 0, vy: 0, vz: 0, spinZ: 0 },
    selfSide: "home",
    half: 1,
    match: matchState,
  };
}

function event(
  seq: number,
  type: SnapshotEvent["type"],
  side: "home" | "away" = "home",
  playerNumber: number | null = 9,
): SnapshotEvent {
  return { seq, type, side, playerNumber };
}

describe("context trigger", () => {
  it("treats kick-off as the first presentation moment", () => {
    const memory = createContextMemory();
    expect(
      nextContextTrigger(
        view(match({ restartType: "kickoff", restartSide: "home" })),
        null,
        memory,
      ),
    ).toEqual({ kind: "kickoff" });
    expect(
      nextContextTrigger(
        view(match({ restartType: "kickoff", restartSide: "home" })),
        null,
        memory,
      ),
    ).toBeNull();
  });

  it("detects a goal and selects the nearest player from the scoring side", () => {
    const memory = createContextMemory();
    nextContextTrigger(view(), null, memory);
    const before = view();
    const after = view(match({ scoreHome: 1 }));
    const trigger = nextContextTrigger(after, before, memory);
    expect(trigger?.kind).toBe("goal");
    if (trigger?.kind === "goal") {
      expect(trigger.side).toBe("home");
      expect(trigger.scorer).toEqual({ x: 90, y: 34 });
    }
  });

  it("triggers each restart once and re-arms after the ball is live", () => {
    const memory = createContextMemory();
    nextContextTrigger(view(), null, memory);
    const corner = view(
      match({ restartType: "corner", restartSide: "home" }),
    );
    expect(nextContextTrigger(corner, null, memory)).toEqual({
      kind: "restart",
      restartType: "corner",
      side: "home",
    });
    expect(nextContextTrigger(corner, null, memory)).toBeNull();
    nextContextTrigger(view(match()), null, memory);
    expect(nextContextTrigger(corner, null, memory)).toEqual({
      kind: "restart",
      restartType: "corner",
      side: "home",
    });
  });

  it("triggers a foul only once per event sequence", () => {
    const memory = createContextMemory();
    nextContextTrigger(view(), null, memory);
    const foul = event(7, "foul");
    const incidentView = view(match({ lastEvent: foul }));
    expect(nextContextTrigger(incidentView, null, memory)).toMatchObject({
      kind: "incident",
      event: foul,
    });
    expect(nextContextTrigger(incidentView, null, memory)).toBeNull();
  });

  it("detects half-time and full-time transitions", () => {
    const memory = createContextMemory();
    nextContextTrigger(view(), null, memory);
    expect(
      nextContextTrigger(view(match({ phase: "halfTime" })), null, memory),
    ).toEqual({ kind: "phase", phase: "halfTime" });
    expect(
      nextContextTrigger(view(match({ phase: "fullTime" })), null, memory),
    ).toEqual({ kind: "phase", phase: "fullTime" });
  });

  it("prioritises a goal over a simultaneous restart and card", () => {
    const memory = createContextMemory();
    nextContextTrigger(view(), null, memory);
    const trigger = nextContextTrigger(
      view(
        match({
          scoreHome: 1,
          restartType: "kickoff",
          restartSide: "away",
          lastEvent: event(2, "yellowCard"),
        }),
      ),
      view(),
      memory,
    );
    expect(trigger?.kind).toBe("goal");
    expect(
      nextContextTrigger(view(match({ scoreHome: 1 })), null, memory),
    ).toBeNull();
  });
});
