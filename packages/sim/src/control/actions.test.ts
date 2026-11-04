// packages/sim/src/control/actions.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch, stepMatch } from "../match";
import type { MatchState, PlayerState } from "../types";
import {
  playDribbleTouch,
  playPass,
  playShot,
  playSkillMove,
  playTackle,
} from "./actions";

function placeBallAtFeet(state: MatchState, player: PlayerState): void {
  state.referee.phase = "live";
  state.referee.restart = null;
  state.referee.timerSeconds = 0;
  state.referee.setPiece = null;
  state.ball.x = player.x + 0.3;
  state.ball.y = player.y;
  state.ball.z = TUNING.ball.radiusM;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
}

describe("human actions", () => {
  it("plays a ground pass toward an aimed teammate", () => {
    const state = createMatch({ seed: 11 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    const teammate = state.home.players.find((entry) => entry.role === "CM")!;
    teammate.x = player.x + 8;
    teammate.y = player.y;
    placeBallAtFeet(state, player);

    expect(playPass(state, player, "pass", 1, 0)).toBe(true);
    expect(state.ball.vx).toBeGreaterThan(0);
    expect(Math.abs(state.ball.vy)).toBeLessThan(Math.abs(state.ball.vx));
    expect(state.lastTouch?.playerId).toBe(player.id);
    expect(player.state).toBe("pass");
    expect(player.kickCooldown).toBeGreaterThan(0);
  });

  it("charges a ground pass from a tap to a driven ball", () => {
    const state = createMatch({ seed: 111 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    const teammate = state.home.players.find((entry) => entry.role === "CM")!;
    teammate.x = player.x + 8;
    teammate.y = player.y;
    placeBallAtFeet(state, player);

    expect(playPass(state, player, "pass", 1, 0)).toBe(true);
    const tapSpeed = Math.hypot(state.ball.vx, state.ball.vy);

    player.kickCooldown = 0;
    placeBallAtFeet(state, player);
    expect(playPass(state, player, "pass", 1, 0, 1)).toBe(true);
    const drivenSpeed = Math.hypot(state.ball.vx, state.ball.vy);

    expect(drivenSpeed).toBeGreaterThan(tapSpeed);
    expect(drivenSpeed).toBeLessThanOrEqual(
      TUNING.control.maxPassSpeedMps * 1.1,
    );
  });

  it("drives a ground pass lower and faster", () => {
    const state = createMatch({ seed: 112 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    const teammate = state.home.players.find((entry) => entry.role === "CM")!;
    teammate.x = player.x + 8;
    teammate.y = player.y;
    placeBallAtFeet(state, player);

    expect(playPass(state, player, "pass", 1, 0)).toBe(true);
    const normalLift = state.ball.vz;
    const normalSpeed = Math.hypot(state.ball.vx, state.ball.vy);

    player.kickCooldown = 0;
    placeBallAtFeet(state, player);
    expect(playPass(state, player, "pass", 1, 0, 0.35, true)).toBe(true);
    expect(state.ball.vz).toBeLessThan(normalLift);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(
      normalSpeed,
    );
  });

  it("lifts a lob and drives a through ball", () => {
    const state = createMatch({ seed: 12 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    placeBallAtFeet(state, player);

    expect(playPass(state, player, "lob", 1, 0)).toBe(true);
    expect(state.ball.vz).toBeGreaterThan(1);

    player.kickCooldown = 0;
    placeBallAtFeet(state, player);
    const speedBefore = Math.hypot(state.ball.vx, state.ball.vy);
    expect(playPass(state, player, "through", 1, 0)).toBe(true);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(
      speedBefore,
    );
  });

  it("shoots with power and optional finesse", () => {
    const state = createMatch({ seed: 13 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    placeBallAtFeet(state, player);

    expect(playShot(state, player, 0, 0.2, 1, true)).toBe(true);
    expect(state.lastTouch?.playerId).toBe(player.id);
    expect(player.state).toBe("shoot");
    expect(Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz)).toBeGreaterThan(
      TUNING.control.minShotSpeedMps * 0.7,
    );
    expect(state.ball.spinZ).not.toBe(0);
    expect(state.ball.vx).toBeGreaterThan(0);
  });

  it("performs a directional skill touch with its own cooldown", () => {
    const state = createMatch({ seed: 171 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    placeBallAtFeet(state, player);

    expect(playSkillMove(state, player, 0, 1)).toBe(true);
    expect(player.state).toBe("dribble");
    expect(player.kickCooldown).toBe(
      TUNING.control.skillMoveCooldownSeconds,
    );
    expect(state.ball.vy).toBeGreaterThan(Math.abs(state.ball.vx));
    expect(player.stamina).toBeLessThan(1);

    state.ball.x = player.x + 8;
    player.kickCooldown = 0;
    expect(playSkillMove(state, player, 1, 0)).toBe(false);
  });

  it("wins the ball with a tackle and does nothing when too far away", () => {
    const state = createMatch({ seed: 14 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    placeBallAtFeet(state, player);

    expect(playTackle(state, player)).toBe(true);
    expect(player.state).toBe("slide");
    expect(state.lastTouch?.playerId).toBe(player.id);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(1);

    player.kickCooldown = 0;
    state.ball.x = player.x + 8;
    state.ball.vx = 0;
    state.ball.vy = 0;
    expect(playTackle(state, player)).toBe(false);
  });

  it("nudges the ball ahead with a close-control touch", () => {
    const state = createMatch({ seed: 151 });
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    placeBallAtFeet(state, player);

    expect(playDribbleTouch(state, player, 1, 0, false)).toBe(true);
    expect(state.lastTouch?.playerId).toBe(player.id);
    expect(state.ball.vx).toBeGreaterThan(0);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(0.5);

    state.ball.x = player.x + 8;
    state.ball.vx = 0;
    state.ball.vy = 0;
    expect(playDribbleTouch(state, player, 1, 0, false)).toBe(false);
  });

  it("rejects actions when the ball is out of reach", () => {
    const state = createMatch({ seed: 15 });
    state.referee.phase = "live";
    state.referee.restart = null;
    state.referee.setPiece = null;
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    state.ball.x = player.x + 10;
    state.ball.y = player.y;

    expect(playPass(state, player, "pass", 1, 0)).toBe(false);
    expect(playShot(state, player, 0, 0, 1, false)).toBe(false);
    expect(state.lastTouch).toBeNull();
  });
});

describe("controlled-player AI suppression", () => {
  it("leaves controlled targets alone and does not auto-kick", () => {
    const state = createMatch({ seed: 16 });
    state.referee.phase = "live";
    state.referee.restart = null;
    state.referee.timerSeconds = 0;
    state.referee.setPiece = null;
    const player = state.home.players.find((entry) => entry.role === "ST")!;
    player.isUserControlled = true;
    player.targetX = 10;
    player.targetY = 34;
    player.targetSpeed = 0;

    state.ball.x = player.x + 0.5;
    state.ball.y = player.y;
    state.ball.z = TUNING.ball.radiusM;
    state.ball.vx = 0;
    state.ball.vy = 0;

    stepMatch(state);

    expect(player.targetX).toBe(10);
    expect(player.targetY).toBe(34);
    expect(state.ball.vx).toBe(0);
    expect(state.ball.vy).toBe(0);
    expect(state.lastTouch).toBeNull();
  });
});
