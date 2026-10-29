// packages/sim/src/rules/out-of-play.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createPitch } from "../pitch";
import type { BallState, LastTouch } from "../types";
import { classifyBoundary, detectGoal } from "./out-of-play";

const pitch = createPitch();

function ballAt(x: number, y: number, z = TUNING.ball.radiusM): BallState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
  };
}

function touch(team: "home" | "away"): LastTouch {
  return { team, playerId: `${team}-1`, playerNumber: 1 };
}

describe("detectGoal", () => {
  it("awards a home goal when the whole ball crosses the away line legally", () => {
    const ball = ballAt(pitch.lengthM + TUNING.ball.radiusM + 0.01, pitch.centreY);
    expect(detectGoal(pitch, ball)).toEqual({
      kind: "goal",
      scoringSide: "home",
      goal: "away",
    });
  });

  it("does not award a goal until the whole ball is over the line", () => {
    const ball = ballAt(pitch.lengthM + TUNING.ball.radiusM, pitch.centreY);
    expect(detectGoal(pitch, ball)).toBeNull();
  });

  it("rejects a ball outside the posts or above the bar", () => {
    const wide = ballAt(
      pitch.lengthM + 0.2,
      pitch.centreY - pitch.goalWidthM / 2 - 0.1,
    );
    const high = ballAt(pitch.lengthM + 0.2, pitch.centreY);
    high.z = pitch.goalHeightM;
    expect(detectGoal(pitch, wide)).toBeNull();
    expect(detectGoal(pitch, high)).toBeNull();
  });

  it("credits an own goal at the home end to the away side", () => {
    const ball = ballAt(-TUNING.ball.radiusM - 0.01, pitch.centreY);
    expect(detectGoal(pitch, ball)?.scoringSide).toBe("away");
  });
});

describe("classifyBoundary", () => {
  it("awards a throw-in to the opposition of the last toucher", () => {
    const ball = ballAt(30, -TUNING.ball.radiusM - 0.01);
    expect(classifyBoundary(pitch, ball, touch("home"))).toEqual({
      kind: "restart",
      type: "throwIn",
      side: "away",
      x: 30,
      y: 0,
    });
  });

  it("awards a corner when the defending side puts the ball over its goal line", () => {
    const ball = ballAt(-TUNING.ball.radiusM - 0.01, 10);
    expect(classifyBoundary(pitch, ball, touch("home"))).toEqual({
      kind: "restart",
      type: "corner",
      side: "away",
      x: 0,
      y: 0,
    });
  });

  it("awards a goal kick when the attacking side puts the ball over the goal line", () => {
    const ball = ballAt(-TUNING.ball.radiusM - 0.01, 10);
    const event = classifyBoundary(pitch, ball, touch("away"));
    expect(event).toMatchObject({
      kind: "restart",
      type: "goalKick",
      side: "home",
    });
    if (event?.kind === "restart") {
      expect(event.x).toBeCloseTo(TUNING.match.goalKickSpotFromLineM, 8);
      expect(event.y).toBeCloseTo(pitch.centreY, 8);
    }
  });

  it("uses the nearest corner at the away end", () => {
    const ball = ballAt(pitch.lengthM + 0.2, pitch.widthM - 2);
    expect(classifyBoundary(pitch, ball, touch("away"))).toMatchObject({
      kind: "restart",
      type: "corner",
      side: "home",
      x: pitch.lengthM,
      y: pitch.widthM,
    });
  });

  it("returns null while the whole ball is still in play", () => {
    expect(
      classifyBoundary(
        pitch,
        ballAt(pitch.centreX, pitch.centreY),
        touch("home"),
      ),
    ).toBeNull();
  });
});
