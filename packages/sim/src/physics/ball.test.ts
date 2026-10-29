// packages/sim/src/physics/ball.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createPitch } from "../pitch";
import type { BallState, PlayerAttributes, PlayerState } from "../types";
import { kickBall, stepBall } from "./ball";

const pitch = createPitch();
const dt = 1 / TUNING.sim.tickHz;

function makeBall(overrides: Partial<BallState> = {}): BallState {
  return {
    x: pitch.centreX,
    y: pitch.centreY,
    z: TUNING.ball.radiusM,
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    ...overrides,
  };
}

const attributes: PlayerAttributes = {
  sprintSpeed: 80,
  acceleration: 80,
  agility: 80,
  stamina: 80,
  ballControl: 80,
  standingTackle: 70,
  slidingTackle: 70,
  aggression: 65,
  balance: 75,
  strength: 75,
  finishing: 70,
  shotPower: 74,
  longShots: 66,
  attPosition: 70,
  shortPassing: 72,
  vision: 68,
  crossing: 64,
  longPassing: 70,
  curve: 66,
  dribbling: 70,
  reactions: 50,
  composure: 60,
  interceptions: 70,
  headingAccuracy: 64,
  defAwareness: 65,
  jumping: 68,
  skillMoves: 3,
  weakFoot: 3,
  goalkeeper: null,
};

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "home-9",
    team: "home",
    role: "ST",
    number: 9,
    attributes,
    roleFamiliarity: 1,
    formationX: 0.6,
    formationY: 0.5,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    state: "idle",
    actionTimer: 0,
    kickCooldown: 0,
    stamina: 1,
    yellowCards: 0,
    sentOff: false,
    isUserControlled: false,
    targetX: 0,
    targetY: 0,
    targetSpeed: 0,
    ...overrides,
  };
}

describe("ball flight", () => {
  it("falls under gravity", () => {
    const ball = makeBall({ z: 3 });
    const beforeZ = ball.z;
    stepBall(ball, [], [], pitch, dt);
    expect(ball.z).toBeLessThan(beforeZ);
    expect(ball.vz).toBeLessThan(0);
  });

  it("bounces off the ground and stays above it", () => {
    const ball = makeBall({ z: TUNING.ball.radiusM + 0.2, vz: -5 });
    let minimumZ = ball.z;
    let sawUpwardVelocity = false;
    for (let i = 0; i < 120; i += 1) {
      stepBall(ball, [], [], pitch, dt);
      minimumZ = Math.min(minimumZ, ball.z);
      if (ball.vz > 0) {
        sawUpwardVelocity = true;
      }
    }
    expect(minimumZ).toBeGreaterThanOrEqual(TUNING.ball.radiusM - 1e-9);
    expect(sawUpwardVelocity).toBe(true);
  });

  it("rolls to a stop under rolling resistance", () => {
    const ball = makeBall({ vx: 5 });
    for (let i = 0; i < 300; i += 1) {
      stepBall(ball, [], [], pitch, dt);
    }
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(5);
    expect(ball.spinY).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ball.x)).toBe(true);
  });

  it("applies quadratic drag to a fast ball", () => {
    const ball = makeBall({ z: 3, vx: 30 });
    stepBall(ball, [], [], pitch, dt);
    expect(ball.vx).toBeLessThan(30);
  });

  it("curves with sidespin via the Magnus effect", () => {
    const plain = makeBall({ z: 3, vx: 20 });
    const curling = makeBall({ z: 3, vx: 20, spinZ: 80 });
    stepBall(plain, [], [], pitch, dt);
    stepBall(curling, [], [], pitch, dt);
    expect(curling.vy).toBeGreaterThan(0);
    expect(Math.abs(plain.vy)).toBeLessThan(1e-9);
  });

  it("holds a backspinning shot up longer than a plain ball", () => {
    const plain = makeBall({ z: 3, vx: 20 });
    const lifted = makeBall({ z: 3, vx: 20, spinY: -80 });
    stepBall(plain, [], [], pitch, dt);
    stepBall(lifted, [], [], pitch, dt);
    expect(lifted.vz).toBeGreaterThan(plain.vz);
  });

  it("clamps ball speed and spin", () => {
    const ball = makeBall({ vx: 500, spinX: 5000 });
    stepBall(ball, [], [], pitch, dt);
    expect(
      Math.hypot(ball.vx, ball.vy, ball.vz),
    ).toBeLessThanOrEqual(TUNING.ball.maxSpeedMps + 1e-9);
    expect(Math.abs(ball.spinX)).toBeLessThanOrEqual(
      TUNING.ball.maxSpinRadPerS + 1e-9,
    );
  });
});

describe("goal frame collisions", () => {
  it("rebounds from a post", () => {
    const goal = pitch.homeGoal;
    const ball = makeBall({
      x: 0.3,
      y: goal.centreY - goal.widthM / 2,
      z: 1,
      vx: -12,
    });
    stepBall(ball, [], [], pitch, dt);
    expect(ball.vx).toBeGreaterThan(0);
    expect(Number.isFinite(ball.x)).toBe(true);
  });

  it("rebounds from the crossbar", () => {
    const ball = makeBall({
      x: 0.3,
      y: pitch.centreY,
      z: pitch.homeGoal.heightM,
      vx: -12,
    });
    stepBall(ball, [], [], pitch, dt);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it("catches a ball in the net instead of letting it pass through", () => {
    const goal = pitch.homeGoal;
    const backX = goal.lineX + goal.netDirection * goal.netDepthM;
    const ball = makeBall({
      x: -0.5,
      y: goal.centreY,
      z: 0.5,
      vx: -18,
    });
    let minX = ball.x;
    for (let i = 0; i < 180; i += 1) {
      stepBall(ball, [], [], pitch, dt);
      minX = Math.min(minX, ball.x);
    }
    expect(minX).toBeGreaterThanOrEqual(
      backX + TUNING.ball.radiusM - 1e-6,
    );
    expect(Number.isFinite(ball.x)).toBe(true);
  });
});

describe("player and kick interactions", () => {
  it("deflects the ball out of a player's body and reports the touch", () => {
    const player = makePlayer({ x: 0, y: 0 });
    const ball = makeBall({ x: 0.2, y: 0, vx: -2 });
    const contact = stepBall(ball, [player], [], pitch, dt);
    expect(contact).not.toBeNull();
    expect(contact?.playerId).toBe(player.id);
    const distance = Math.hypot(ball.x - player.x, ball.y - player.y);
    expect(distance).toBeGreaterThanOrEqual(
      TUNING.ball.radiusM + TUNING.player.radiusM - 1e-6,
    );
  });

  it("kicks the ball away from the kicker with the requested lift and spin", () => {
    const player = makePlayer({ x: 10, y: 10, vx: 2, facing: 0 });
    const ball = makeBall({ x: 10.5, y: 10 });
    kickBall(ball, player, {
      targetX: 30,
      targetY: 10,
      speed: 20,
      lift: 4,
      spinY: -30,
      spinZ: 40,
    });
    expect(ball.x).toBeGreaterThan(player.x + TUNING.player.radiusM);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vz).toBe(4);
    expect(ball.spinY).toBe(-30);
    expect(ball.spinZ).toBe(40);
    expect(ball.z).toBe(TUNING.ball.radiusM);
  });

  it("clamps kick spin to the tuning limit", () => {
    const player = makePlayer();
    const ball = makeBall({ x: 0.5 });
    kickBall(ball, player, {
      targetX: 20,
      targetY: 0,
      speed: 10,
      lift: 0,
      spinX: 1e6,
    });
    expect(ball.spinX).toBe(TUNING.ball.maxSpinRadPerS);
  });
});
