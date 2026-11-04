// packages/client/src/camera/presets.test.ts

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createPitch, type TeamSide } from "@fb/sim";
import { pitchToWorld } from "../render/three-layout";
import type { MatchView, RenderPlayer } from "../render/view";
import { cameraSideSign, movementToWorld } from "./cameraMath";
import { CAMERA_MODES, createCameraShot, parseCameraMode } from "./modes";
import { EndToEndShot } from "./shots/endToEnd";
import { PlayerShot } from "./shots/player";
import type {
  CameraPose,
  CameraRenderState,
  CameraShot,
} from "./types";

const pitch = createPitch();

function player(
  id: string,
  team: "home" | "away",
  x: number,
  y: number,
  controlled = false,
  facing = 0,
): RenderPlayer {
  return {
    id,
    number: 1,
    team,
    goalkeeper: false,
    x,
    y,
    facing,
    state: "idle",
    stamina: 1,
    sentOff: false,
    yellowCards: 0,
    controlled,
    switchTarget: false,
  };
}

function view(options: {
  readonly selfSide?: TeamSide | null;
  readonly half?: number;
  readonly ballX?: number;
  readonly ballY?: number;
} = {}): MatchView {
  const ballX = options.ballX ?? 52;
  const ballY = options.ballY ?? 34;
  return {
    matchId: "preset-test",
    pitch,
    tick: 1,
    elapsedSeconds: 1,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#ff0" },
      players: [
        player("home:9", "home", ballX + 3, ballY + 1, true),
        player("home:4", "home", ballX - 8, ballY - 4),
      ],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#0f0" },
      players: [
        player("away:9", "away", ballX - 3, ballY + 5),
        player("away:4", "away", ballX + 9, ballY - 2),
      ],
    },
    ball: {
      x: ballX,
      y: ballY,
      z: 0.2,
      vx: 0,
      vy: 0,
      vz: 0,
      spinZ: 0,
    },
    selfSide: options.selfSide === undefined ? "home" : options.selfSide,
    half: options.half ?? 1,
    match: null,
  };
}

function context(match: MatchView): CameraRenderState {
  return {
    view: match,
    aspect: 16 / 9,
    selfSide: match.selfSide,
    half: match.half,
    pitch,
  };
}

function settle(shot: CameraShot, match: MatchView): CameraPose {
  const state = context(match);
  shot.enter(state);
  let pose = shot.update(0, state);
  for (let frame = 0; frame < 180; frame += 1) {
    pose = shot.update(1 / 60, state);
  }
  return pose;
}

function projected(
  pose: CameraPose,
  x: number,
  y: number,
  z: number,
): { readonly x: number; readonly y: number } {
  const camera = new THREE.PerspectiveCamera(pose.fovDegrees, 16 / 9, 0.25, 600);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  const world = pitchToWorld(pitch, x, y, z);
  const point = new THREE.Vector3(world.x, world.y, world.z).project(camera);
  return { x: point.x, y: point.y };
}

describe("selectable camera presets", () => {
  it("parses known values and falls back for invalid storage", () => {
    expect(parseCameraMode("player")).toBe("player");
    expect(parseCameraMode("endToEnd")).toBe("endToEnd");
    expect(parseCameraMode("sideways")).toBe("broadcast");
    expect(parseCameraMode(null)).toBe("broadcast");
  });

  it("creates a shot for every selectable camera", () => {
    for (const option of CAMERA_MODES) {
      const shot = createCameraShot(option.id);
      expect(shot.id.length).toBeGreaterThan(0);
      expect(shot.label).toBe(option.label);
    }
  });

  it("keeps the ball and controlled player visible in every gameplay camera", () => {
    const match = view();
    const controlled = match.home.players[0]!;
    for (const option of CAMERA_MODES) {
      const pose = settle(createCameraShot(option.id), match);
      const ball = projected(pose, match.ball.x, match.ball.y, match.ball.z);
      const subject = projected(pose, controlled.x, controlled.y, 0);
      expect(Math.abs(ball.x), option.id).toBeLessThanOrEqual(1);
      expect(Math.abs(ball.y), option.id).toBeLessThanOrEqual(1);
      expect(Math.abs(subject.x), option.id).toBeLessThanOrEqual(1);
      expect(Math.abs(subject.y), option.id).toBeLessThanOrEqual(1);
    }
  });

  it("orders tele, broadcast, wide and drone from low to high", () => {
    const match = view();
    const heights = ["tele", "broadcast", "wide", "drone"].map(
      (mode) =>
        settle(createCameraShot(mode as "tele"), match).position.y,
    );
    expect(heights[0]).toBeLessThan(heights[1]!);
    expect(heights[1]).toBeLessThan(heights[2]!);
    expect(heights[2]).toBeLessThan(heights[3]!);
  });
});

describe("camera-relative movement", () => {
  it("maps broadcast up to away from the touchline and right to attack", () => {
    const match = view({ selfSide: "home", half: 1 });
    const shot = createCameraShot("broadcast");
    const pose = settle(shot, match);
    const basis = shot.inputBasis?.();
    expect(basis).not.toBeNull();
    const right = movementToWorld(1, 0, basis!);
    const up = movementToWorld(0, -1, basis!);
    expect(right.x).toBeGreaterThan(0.9);
    expect(Math.abs(right.y)).toBeLessThan(0.1);
    expect(up.y).toBeLessThan(-0.9);
    expect(Math.abs(up.x)).toBeLessThan(0.1);
    expect(pose.position.z).toBeGreaterThan(0);
  });

  it("keeps the away and second-half views attack-rightward", () => {
    for (const [selfSide, half] of [
      ["home", 1],
      ["away", 1],
      ["home", 2],
      ["away", 2],
    ] as const) {
      const match = view({ selfSide, half });
      const shot = createCameraShot("broadcast");
      settle(shot, match);
      const basis = shot.inputBasis?.();
      expect(basis).not.toBeNull();
      const right = movementToWorld(1, 0, basis!);
      const up = movementToWorld(0, -1, basis!);
      const attack = cameraSideSign(selfSide, half);
      expect(right.x).toBeCloseTo(attack, 2);
      expect(up.y).toBeCloseTo(-attack, 2);
    }
  });

  it("maps end-to-end up down the pitch toward the attacked goal", () => {
    const match = view({ selfSide: "home", half: 1, ballX: 60 });
    const shot = new EndToEndShot();
    const pose = settle(shot, match);
    const basis = shot.inputBasis();
    const up = movementToWorld(0, -1, basis!);
    expect(up.x).toBeGreaterThan(0.9);
    expect(Math.abs(up.y)).toBeLessThan(0.1);
    expect(pose.position.x).toBeLessThan(0);
  });

  it("keeps player camera movement aligned with the chase view", () => {
    const match = view({ selfSide: "home", half: 1 });
    const shot = new PlayerShot();
    const pose = settle(shot, match);
    const basis = shot.inputBasis();
    expect(basis).not.toBeNull();
    const mapped = movementToWorld(0.6, -0.8, basis!);
    expect(Math.hypot(mapped.x, mapped.y)).toBeCloseTo(1, 5);
    expect(pose.position.y).toBeGreaterThan(2);
  });

  it("moves the end-to-end camera across at half-time", () => {
    const shot = new EndToEndShot();
    const first = settle(shot, view({ selfSide: "home", half: 1 }));
    const secondState = context(view({ selfSide: "home", half: 2 }));
    shot.enter(context(view({ selfSide: "home", half: 1 })));
    shot.update(1 / 60, secondState);
    let pose = shot.update(1 / 60, secondState);
    for (let frame = 0; frame < 180; frame += 1) {
      pose = shot.update(1 / 60, secondState);
    }
    expect(first.position.x).toBeLessThan(0);
    expect(pose.position.x).toBeGreaterThan(0);
  });
});
