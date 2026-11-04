// packages/client/src/camera/context/contextShots.test.ts

import { describe, expect, it } from "vitest";
import type { SnapshotMatch } from "@fb/shared";
import { createPitch } from "@fb/sim";
import type { MatchView, RenderPlayer } from "../../render/view";
import { pitchToWorld } from "../../render/three-layout";
import type { CameraRenderState } from "../types";
import { CAMERA_TUNING } from "../cameraTuning";
import {
  createHalfTimeShot,
  createKickoffShot,
  createRestartShot,
  createSubstitutionShot,
  FullTimeShot,
  GoalCelebrationShot,
  IncidentShot,
} from "./contextShots";

const pitch = createPitch();

function player(
  id: string,
  team: "home" | "away",
  x: number,
  y: number,
): RenderPlayer {
  return {
    id,
    number: 9,
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
    phase: "deadBall",
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

function view(matchState = match()): MatchView {
  return {
    matchId: "test-match",
    pitch,
    tick: 1,
    elapsedSeconds: 0,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#ff0" },
      players: [player("home:9", "home", 100, 34)],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#0f0" },
      players: [player("away:9", "away", 5, 34)],
    },
    ball: { x: 94, y: 34, z: 0.2, vx: 0, vy: 0, vz: 0, spinZ: 0 },
    selfSide: "home",
    half: 1,
    match: matchState,
  };
}

function state(matchState = match()): CameraRenderState {
  const matchView = view(matchState);
  return {
    view: matchView,
    pitch,
    selfSide: matchView.selfSide,
    half: matchView.half,
    aspect: 16 / 9,
  };
}

describe("context shots", () => {
  it("uses a wide establishing shot at kick-off", () => {
    const shot = createKickoffShot();
    const ctx = state(
      match({ restartType: "kickoff", restartSide: "home" }),
    );
    shot.enter(ctx);
    const pose = shot.update(0, ctx);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    expect(pose.position.z).toBeGreaterThan(0);
    expect(pose.fovDegrees).toBe(
      CAMERA_TUNING.context.kickoffFovDegrees,
    );
    expect(shot.durationSeconds).toBe(
      CAMERA_TUNING.context.kickoffDurationSeconds,
    );
  });

  it("frames a corner from behind the corner toward the penalty spot", () => {
    const shot = createRestartShot("corner");
    const corner = {
      ...view(match({ restartType: "corner", restartSide: "home" })),
      ball: {
        x: pitch.lengthM,
        y: pitch.widthM,
        z: 0.2,
        vx: 0,
        vy: 0,
        vz: 0,
        spinZ: 0,
      },
    };
    const ctx: CameraRenderState = {
      view: corner,
      pitch,
      selfSide: "home",
      half: 1,
      aspect: 16 / 9,
    };
    shot.enter(ctx);
    const pose = shot.update(0, ctx);
    const expectedTarget = pitchToWorld(
      pitch,
      pitch.lengthM - pitch.penaltySpotDistanceM,
      pitch.centreY,
      0,
    );
    expect(pose.target.x).toBeCloseTo(expectedTarget.x, 4);
    expect(pose.target.z).toBeCloseTo(expectedTarget.z, 4);
    expect(pose.position.x).toBeGreaterThan(pitch.lengthM / 2);
    expect(pose.position.z).toBeGreaterThan(pitch.widthM / 2);
    expect(pose.fovDegrees).toBe(CAMERA_TUNING.context.restartFovDegrees);
  });

  it("puts the penalty camera behind the taker looking at the goal", () => {
    const shot = createRestartShot("penalty");
    const penalty = {
      ...view(match({ restartType: "penalty", restartSide: "home" })),
      ball: {
        x: pitch.lengthM - pitch.penaltySpotDistanceM,
        y: pitch.centreY,
        z: 0.2,
        vx: 0,
        vy: 0,
        vz: 0,
        spinZ: 0,
      },
    };
    const ctx: CameraRenderState = {
      view: penalty,
      pitch,
      selfSide: "home",
      half: 1,
      aspect: 16 / 9,
    };
    shot.enter(ctx);
    const pose = shot.update(0, ctx);
    const goalX = pitch.lengthM - pitch.lengthM / 2;
    expect(pose.position.x).toBeLessThan(goalX);
    expect(pose.target.x).toBeCloseTo(goalX, 4);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    expect(shot.durationSeconds).toBe(
      CAMERA_TUNING.context.penaltyDurationSeconds,
    );
  });

  it("orbits the scorer during a celebration", () => {
    const shot = new GoalCelebrationShot({ x: 50, y: 30 });
    const ctx = state();
    shot.enter(ctx);
    const first = shot.update(0.1, ctx);
    const second = shot.update(0.1, ctx);
    expect(first.position.x).not.toBe(second.position.x);
    expect(first.position.y).toBeGreaterThan(second.target.y);
    expect(first.fovDegrees).toBe(
      CAMERA_TUNING.context.celebrationFovDegrees,
    );
    expect(shot.durationSeconds).toBe(
      CAMERA_TUNING.context.celebrationDurationSeconds,
    );
  });

  it("pushes in on an incident and returns a valid close pose", () => {
    const shot = new IncidentShot({ x: 70, y: 20 });
    const ctx = state();
    shot.enter(ctx);
    const pose = shot.update(0.5, ctx);
    expect(Number.isFinite(pose.position.x)).toBe(true);
    expect(pose.position.y).toBe(CAMERA_TUNING.context.incidentHeightM);
    expect(pose.target.y).toBe(
      CAMERA_TUNING.context.incidentTargetHeightM,
    );
  });

  it("builds calm substitution/half-time shots and a full-time orbit", () => {
    const substitution = createSubstitutionShot();
    const halfTime = createHalfTimeShot();
    const fullTime = new FullTimeShot();
    expect(substitution.durationSeconds).toBe(
      CAMERA_TUNING.context.substitutionDurationSeconds,
    );
    expect(halfTime.durationSeconds).toBe(
      CAMERA_TUNING.context.halfTimeDurationSeconds,
    );
    expect(fullTime.durationSeconds).toBe(
      CAMERA_TUNING.context.fullTimeDurationSeconds,
    );
    fullTime.enter(state());
    const first = fullTime.update(0.1, state());
    const later = fullTime.update(1, state());
    expect(first.position.x).not.toBe(later.position.x);
  });
});
