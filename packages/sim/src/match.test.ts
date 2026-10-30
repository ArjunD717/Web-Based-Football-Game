// packages/sim/src/match.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { hashMatchState } from "./hash";
import { createMatch, stepMatch } from "./match";
import type { MatchState, PlayerState } from "./types";

const dt = 1 / TUNING.sim.tickHz;

describe("createMatch", () => {
  it("starts an 11v11 kickabout at the centre spot", () => {
    const match = createMatch({ seed: 123 });
    expect(match.home.players).toHaveLength(11);
    expect(match.away.players).toHaveLength(11);
    expect(match.home.players.filter((p) => p.role === "GK")).toHaveLength(1);
    expect(match.away.players.filter((p) => p.role === "GK")).toHaveLength(1);
    expect(match.ball.x).toBeCloseTo(match.pitch.centreX, 10);
    expect(match.ball.y).toBeCloseTo(match.pitch.centreY, 10);
    expect(match.ball.z).toBe(TUNING.ball.radiusM);
    expect(match.tick).toBe(0);
    expect(match.elapsedSeconds).toBe(0);
    expect(match.lastTouch).toBeNull();
    expect(match.seed).toBe(123);
  });

  it("accepts stadium and team overrides", () => {
    const match = createMatch({
      seed: 5,
      pitch: { lengthM: 100, widthM: 64 },
      home: { name: "Blue" },
      away: { name: "Red" },
    });
    expect(match.pitch.lengthM).toBe(100);
    expect(match.home.name).toBe("Blue");
    expect(match.away.name).toBe("Red");
  });

  it("rejects a non-integer seed", () => {
    expect(() => createMatch({ seed: 1.5 })).toThrow(RangeError);
  });
});

describe("stepMatch", () => {
  it("advances exactly one fixed tick", () => {
    const match = createMatch({ seed: 1 });
    stepMatch(match);
    expect(match.tick).toBe(1);
    expect(match.elapsedSeconds).toBeCloseTo(dt, 12);
  });

  it("moves the chaser and gets the ball into play headlessly", () => {
    const match = createMatch({ seed: 2026 });
    const initial = snapshotPositions(match);

    for (let i = 0; i < 600; i += 1) {
      stepMatch(match);
    }

    expect(match.lastTouch).not.toBeNull();
    expect(match.ball.x !== match.pitch.centreX || match.ball.y !== match.pitch.centreY).toBe(true);
    expect(movedDistance(match, initial)).toBeGreaterThan(5);
    assertFiniteMatch(match);
  });

  it("is deterministic from the seed", () => {
    const a = createMatch({ seed: 987654 });
    const b = createMatch({ seed: 987654 });

    for (let i = 0; i < 900; i += 1) {
      stepMatch(a);
      stepMatch(b);
      if (i % 150 === 0) {
        expect(hashMatchState(a)).toBe(hashMatchState(b));
      }
    }
    expect(hashMatchState(a)).toBe(hashMatchState(b));
  });

  it("diverges with a different seed", () => {
    const a = createMatch({ seed: 1 });
    const b = createMatch({ seed: 2 });
    for (let i = 0; i < 120; i += 1) {
      stepMatch(a);
      stepMatch(b);
    }
    expect(hashMatchState(a)).not.toBe(hashMatchState(b));
  });

  it("reaches full time within a generous real-time bound", () => {
    const match = createMatch({ seed: 20261030 });
    // Twenty real minutes covers both halves, half-time, added time and the
    // period safety whistle; a live match must never exceed this bound.
    const limit = TUNING.sim.tickHz * 60 * 20;
    let ticks = 0;
    while (match.referee.phase !== "fullTime" && ticks < limit) {
      stepMatch(match);
      ticks += 1;
    }
    expect(match.referee.phase).toBe("fullTime");
    expect(ticks).toBeLessThan(limit);
    assertFiniteMatch(match);
  });

  it("stays finite and bounded through a simulated minute", () => {
    const match = createMatch({ seed: 424242 });
    for (let i = 0; i < 3_600; i += 1) {
      stepMatch(match);
    }
    assertFiniteMatch(match);
    expect(match.tick).toBe(3_600);
    expect(match.elapsedSeconds).toBeCloseTo(60, 8);
  });
});

function snapshotPositions(match: MatchState): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const player of allPlayers(match)) {
    positions.set(player.id, { x: player.x, y: player.y });
  }
  return positions;
}

function movedDistance(
  match: MatchState,
  initial: Map<string, { x: number; y: number }>,
): number {
  let best = 0;
  for (const player of allPlayers(match)) {
    const start = initial.get(player.id);
    if (start === undefined) {
      continue;
    }
    best = Math.max(best, Math.hypot(player.x - start.x, player.y - start.y));
  }
  return best;
}

function allPlayers(match: MatchState): PlayerState[] {
  return [...match.home.players, ...match.away.players];
}

function assertFiniteMatch(match: MatchState): void {
  const numbers = [
    match.ball.x,
    match.ball.y,
    match.ball.z,
    match.ball.vx,
    match.ball.vy,
    match.ball.vz,
    match.ball.spinX,
    match.ball.spinY,
    match.ball.spinZ,
    ...allPlayers(match).flatMap((player) => [
      player.x,
      player.y,
      player.vx,
      player.vy,
      player.facing,
      player.stamina,
      player.targetX,
      player.targetY,
      player.targetSpeed,
    ]),
  ];
  for (const value of numbers) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(
    Math.hypot(match.ball.vx, match.ball.vy, match.ball.vz),
  ).toBeLessThanOrEqual(TUNING.ball.maxSpeedMps + 1e-6);
  for (const player of allPlayers(match)) {
    expect(player.stamina).toBeGreaterThanOrEqual(0);
    expect(player.stamina).toBeLessThanOrEqual(1);
    expect(
      Math.hypot(player.vx, player.vy),
    ).toBeLessThanOrEqual(TUNING.player.maxTopSpeedMps + 1e-6);
  }
}
