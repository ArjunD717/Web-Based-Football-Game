// packages/client/src/net/interpolation.test.ts
import { TUNING, type SnapshotFrame, type SnapshotPlayer } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { SnapshotInterpolator } from "./interpolation";

const delay = TUNING.network.snapshotInterpolationDelayMs;

function makeFrame(
  seq: number,
  x: number,
  facing: number,
): SnapshotFrame {
  const players: SnapshotPlayer[] = Array.from(
    { length: 22 },
    (_, index) => ({
      x,
      y: index,
      vx: 1,
      vy: 2,
      facing,
      state: "jog",
      stamina: 1,
      sentOff: false,
      unavailable: false,
      yellowCards: 0,
    }),
  );
  return {
    seq,
    tick: seq * 2,
    baseSeq: 0,
    controlledHome: 0,
    controlledAway: 11,
    match: {
      phase: "live",
      half: 1,
      clockSeconds: seq * 30,
      addedTimeSeconds: 0,
      scoreHome: 0,
      scoreAway: 0,
      restartType: null,
      restartSide: null,
      lastEvent: null,
    },
    ball: { x, y: 0, z: 0.11, vx: 0, vy: 0, vz: 0 },
    players,
  };
}

describe("SnapshotInterpolator", () => {
  it("interpolates between the snapshots bracketing playback time", () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.add(makeFrame(1, 0, 3.1), 1_000);
    interpolator.add(makeFrame(2, 10, -3.1), 1_033);

    const mid = interpolator.sample(1_000 + delay + 16.5);
    expect(mid).not.toBeNull();
    expect(mid?.seq).toBe(2);
    expect(mid?.ball.x).toBeCloseTo(5, 6);
    expect(mid?.match.phase).toBe("live");
    expect(mid?.match.clockSeconds).toBe(60);
    expect(Math.abs(mid?.players[0]?.facing ?? 0)).toBeCloseTo(Math.PI, 4);
    expect(mid?.players[0]?.state).toBe("jog");
  });

  it("clamps before the oldest and after the newest snapshot", () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.add(makeFrame(1, 0, 0), 1_000);
    interpolator.add(makeFrame(2, 10, 0), 1_033);

    expect(interpolator.sample(500)?.seq).toBe(1);
    expect(interpolator.sample(9_000)?.seq).toBe(2);
    expect(interpolator.bufferedCount).toBe(2);
  });

  it("returns the only frame and resets", () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.add(makeFrame(1, 4, 0), 1_000);
    expect(interpolator.sample(1_100)?.ball.x).toBe(4);
    expect(interpolator.latest()?.seq).toBe(1);
    interpolator.reset();
    expect(interpolator.sample(1_100)).toBeNull();
    expect(interpolator.bufferedCount).toBe(0);
  });

  it("ignores duplicate or older sequences", () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.add(makeFrame(2, 10, 0), 1_000);
    interpolator.add(makeFrame(1, 0, 0), 1_010);
    interpolator.add(makeFrame(2, 99, 0), 1_020);
    expect(interpolator.latest()?.ball.x).toBe(10);
  });
});
