// packages/sim/src/physics/players.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { FORMATION_433 } from "../formations";
import { createPitch } from "../pitch";
import type { PlayerAttributes, PlayerState, TeamState } from "../types";
import {
  accelerationFor,
  resolvePlayerCollisions,
  staminaSpeedFactor,
  tickPlayerTimers,
  topSpeedFor,
  updateTeamMovement,
} from "./players";

const pitch = createPitch();
const dt = 1 / TUNING.sim.tickHz;

const defaultAttributes: PlayerAttributes = {
  sprintSpeed: 90,
  acceleration: 90,
  agility: 80,
  stamina: 80,
  ballControl: 80,
};

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "home-9",
    team: "home",
    role: "ST",
    number: 9,
    attributes: defaultAttributes,
    formationX: 0.66,
    formationY: 0.5,
    x: 10,
    y: 10,
    vx: 0,
    vy: 0,
    facing: 0,
    state: "idle",
    actionTimer: 0,
    kickCooldown: 0,
    stamina: 1,
    isUserControlled: false,
    targetX: 10,
    targetY: 10,
    targetSpeed: 0,
    ...overrides,
  };
}

function makeTeam(players: PlayerState[]): TeamState {
  return {
    side: "home",
    name: "Test",
    colors: { primary: "#fff", secondary: "#000", keeper: "#0f0" },
    formation: FORMATION_433,
    attackDirection: 1,
    players,
  };
}

describe("attribute mapping", () => {
  it("maps sprint rating to the tuned speed band", () => {
    const min = TUNING.player.minTopSpeedMps;
    const max = TUNING.player.maxTopSpeedMps;
    expect(
      topSpeedFor({ ...defaultAttributes, sprintSpeed: 0 }),
    ).toBeCloseTo(min + (max - min) / 99, 10);
    expect(
      topSpeedFor({ ...defaultAttributes, sprintSpeed: 99 }),
    ).toBeCloseTo(max, 10);
    expect(topSpeedFor({ ...defaultAttributes, sprintSpeed: 50 })).toBeGreaterThan(
      topSpeedFor({ ...defaultAttributes, sprintSpeed: 40 }),
    );
  });

  it("maps acceleration rating to higher acceleration", () => {
    expect(
      accelerationFor({ ...defaultAttributes, acceleration: 99 }),
    ).toBeGreaterThan(
      accelerationFor({ ...defaultAttributes, acceleration: 1 }),
    );
  });

  it("slows players as stamina falls", () => {
    expect(staminaSpeedFactor(makePlayer({ stamina: 0 }))).toBeCloseTo(
      TUNING.player.minStaminaSpeedFactor,
      10,
    );
    expect(staminaSpeedFactor(makePlayer({ stamina: 1 }))).toBeCloseTo(1, 10);
  });
});

describe("player movement", () => {
  it("accelerates toward a target without exceeding top speed", () => {
    const player = makePlayer({
      targetX: 100,
      targetY: 10,
      targetSpeed: 99,
    });
    const team = makeTeam([player]);
    const beforeX = player.x;

    for (let i = 0; i < 180; i += 1) {
      updateTeamMovement(team, pitch, dt);
    }

    expect(player.x).toBeGreaterThan(beforeX + 5);
    expect(Math.hypot(player.vx, player.vy)).toBeLessThanOrEqual(
      topSpeedFor(player.attributes) + 1e-9,
    );
    expect(player.stamina).toBeLessThan(1);
    expect(player.stamina).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(player.x)).toBe(true);
  });

  it("recovers stamina when below sprint speed", () => {
    const player = makePlayer({
      stamina: 0.4,
      x: 10,
      y: 10,
      targetX: 10,
      targetY: 10,
      targetSpeed: 0,
    });
    const team = makeTeam([player]);
    for (let i = 0; i < 60; i += 1) {
      updateTeamMovement(team, pitch, dt);
    }
    expect(player.stamina).toBeGreaterThan(0.4);
    expect(player.stamina).toBeLessThanOrEqual(1);
  });

  it("keeps players inside the playable margin", () => {
    const player = makePlayer({
      x: 1,
      y: 1,
      targetX: -100,
      targetY: -100,
      targetSpeed: 99,
    });
    for (let i = 0; i < 120; i += 1) {
      updateTeamMovement(makeTeam([player]), pitch, dt);
    }
    expect(player.x).toBeGreaterThanOrEqual(TUNING.player.pitchMarginM - 1e-9);
    expect(player.y).toBeGreaterThanOrEqual(TUNING.player.pitchMarginM - 1e-9);
  });

  it("turns facing toward the movement target", () => {
    const player = makePlayer({
      facing: 0,
      x: 10,
      y: 10,
      targetX: 10,
      targetY: 0,
      targetSpeed: 4,
    });
    for (let i = 0; i < 10; i += 1) {
      updateTeamMovement(makeTeam([player]), pitch, dt);
    }
    expect(Math.abs(player.facing)).toBeGreaterThan(0);
  });
});

describe("timers and collisions", () => {
  it("counts down cooldowns and action timers", () => {
    const player = makePlayer({ actionTimer: 0.2, kickCooldown: 0.1 });
    tickPlayerTimers([player], dt);
    expect(player.actionTimer).toBeCloseTo(0.2 - dt, 10);
    expect(player.kickCooldown).toBeCloseTo(0.1 - dt, 10);
  });

  it("separates overlapping players", () => {
    const a = makePlayer({ id: "a", x: 10, y: 10 });
    const b = makePlayer({ id: "b", team: "away", x: 10.1, y: 10 });
    resolvePlayerCollisions([a], [b]);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    expect(distance).toBeGreaterThanOrEqual(TUNING.player.radiusM * 2 - 1e-9);
  });
});
