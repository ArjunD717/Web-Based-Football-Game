// packages/client/src/camera/shots/broadcast.test.ts

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createPitch } from "@fb/sim";
import type { MatchView, RenderPlayer } from "../../render/view";
import { pitchToWorld } from "../../render/three-layout";
import { BroadcastShot, findControlledPlayer } from "./broadcast";

const pitch = createPitch();

function player(
  id: string,
  team: "home" | "away",
  x: number,
  y: number,
  controlled = false,
): RenderPlayer {
  return {
    id,
    number: 1,
    team,
    goalkeeper: false,
    x,
    y,
    facing: 0,
    state: "idle",
    stamina: 1,
    sentOff: false,
    yellowCards: 0,
    controlled,
    switchTarget: false,
  };
}

function view(options: {
  readonly ballX?: number;
  readonly ballY?: number;
  readonly controlledX?: number;
  readonly nearestX?: number;
  readonly spread?: number;
  readonly selfSide?: "home" | "away";
  readonly half?: number;
} = {}): MatchView {
  const ballX = options.ballX ?? pitch.centreX;
  const ballY = options.ballY ?? pitch.centreY;
  const controlledX = options.controlledX ?? ballX + 3;
  const nearestX = options.nearestX ?? ballX;
  const spread = options.spread ?? 4;
  return {
    pitch,
    tick: 1,
    elapsedSeconds: 1 / 60,
    home: {
      name: "Home",
      colors: { primary: "#fff", secondary: "#000", keeper: "#ff0" },
      players: [
        player("home:controlled", "home", controlledX, ballY, true),
        player("home:near", "home", nearestX - spread, ballY + spread),
      ],
    },
    away: {
      name: "Away",
      colors: { primary: "#00f", secondary: "#fff", keeper: "#0f0" },
      players: [
        player("away:near", "away", nearestX + spread, ballY - spread),
        player("away:deep", "away", nearestX + spread * 2, ballY + spread * 2),
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
    selfSide: options.selfSide ?? "home",
    half: options.half ?? 1,
  };
}

function context(matchView: MatchView, aspect = 16 / 9) {
  return {
    view: matchView,
    aspect,
    selfSide: matchView.selfSide,
    half: matchView.half,
    pitch,
  };
}

describe("BroadcastShot", () => {
  it("keeps the ball and controlled player in a weighted target", () => {
    const matchView = view({ ballX: 40, ballY: 30, controlledX: 55 });
    const shot = new BroadcastShot();
    shot.enter(context(matchView));
    const target = shot.pureTarget(matchView);
    expect(target.x).toBeGreaterThan(40);
    expect(target.x).toBeLessThan(55);
    expect(target.z).toBeGreaterThan(25);
    expect(target.z).toBeLessThan(35);
  });

  it("ignores a short dribble but follows a longer ball movement", () => {
    const stationary = { ballX: 50, controlledX: 53, nearestX: 50 };
    const shot = new BroadcastShot();
    shot.enter(context(view(stationary)));
    const settled = shot.update(1 / 60, context(view(stationary)));
    const nudged = shot.update(
      1 / 60,
      context(view({ ...stationary, ballX: 51 })),
    );
    expect(nudged.target.x).toBeCloseTo(settled.target.x, 6);
    expect(nudged.position.z).toBeCloseTo(settled.position.z, 6);

    let moved = shot.update(1 / 60, context(view({ ballX: 60 })));
    for (let frame = 0; frame < 30; frame += 1) {
      moved = shot.update(1 / 60, context(view({ ballX: 60 })));
    }
    expect(moved.target.x).toBeGreaterThan(settled.target.x);
  });

  it("places the away camera on the opposite touchline but keeps the attack rightward", () => {
    const home = new BroadcastShot();
    home.enter(context(view({ selfSide: "home" })));
    const homePose = home.update(1 / 60, context(view({ selfSide: "home" })));
    const away = new BroadcastShot();
    away.enter(context(view({ selfSide: "away" })));
    const awayPose = away.update(1 / 60, context(view({ selfSide: "away" })));
    expect(Math.sign(homePose.position.z)).toBe(1);
    expect(Math.sign(awayPose.position.z)).toBe(-1);
    expect(homePose.target.z).toBeCloseTo(awayPose.target.z, 5);
  });

  it("pulls back and widens as the action spreads", () => {
    const compact = new BroadcastShot();
    compact.enter(context(view({ spread: 2 })));
    const compactPose = compact.update(1 / 60, context(view({ spread: 2 })));
    const wide = new BroadcastShot();
    wide.enter(context(view({ spread: 26 })));
    const widePose = wide.update(1 / 60, context(view({ spread: 26 })));
    expect(widePose.position.y).toBeGreaterThan(compactPose.position.y);
    expect(widePose.fovDegrees).toBeGreaterThan(compactPose.fovDegrees);
  });

  it("produces the same settled pose when stepped at 60 Hz and 144 Hz", () => {
    const shot60 = new BroadcastShot();
    const shot144 = new BroadcastShot();
    const start = view({ ballX: 40, controlledX: 42 });
    const target = view({ ballX: 64, controlledX: 66 });
    shot60.enter(context(start));
    shot144.enter(context(start));
    for (let frame = 0; frame < 120; frame += 1) {
      shot60.update(1 / 60, context(target));
    }
    for (let frame = 0; frame < 288; frame += 1) {
      shot144.update(1 / 144, context(target));
    }
    const pose60 = shot60.update(0, context(target));
    const pose144 = shot144.update(0, context(target));
    expect(pose60.position.x).toBeCloseTo(pose144.position.x, 3);
    expect(pose60.position.y).toBeCloseTo(pose144.position.y, 3);
    expect(pose60.position.z).toBeCloseTo(pose144.position.z, 3);
    expect(pose60.fovDegrees).toBeCloseTo(pose144.fovDegrees, 4);
  });

  it("moves smoothly to the other touchline at half-time", () => {
    const shot = new BroadcastShot();
    shot.enter(context(view({ half: 1, selfSide: "home" })));
    const first = shot.update(1 / 60, context(view({ half: 1, selfSide: "home" })));
    const firstHalf = context(view({ half: 2, selfSide: "home" }));
    const early = shot.update(1 / 60, firstHalf);
    expect(Math.sign(early.position.z)).toBe(Math.sign(first.position.z));
    let last = early;
    let maxY = early.position.y;
    for (let frame = 0; frame < 120; frame += 1) {
      last = shot.update(1 / 60, firstHalf);
      maxY = Math.max(maxY, last.position.y);
    }
    expect(Math.sign(last.position.z)).not.toBe(Math.sign(first.position.z));
    expect(maxY).toBeGreaterThan(first.position.y);
  });
});

describe("BroadcastShot framing", () => {
  function visibleInFrame(
    matchView: MatchView,
  ): { ball: { x: number; y: number }; controlled: { x: number; y: number } } {
    const shot = new BroadcastShot();
    const frameContext = context(matchView);
    shot.enter(frameContext);
    const pose = shot.update(0, frameContext);
    const camera = new THREE.PerspectiveCamera(
      pose.fovDegrees,
      frameContext.aspect,
      0.25,
      600,
    );
    camera.position.set(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();

    const projected = (x: number, y: number, z: number) => {
      const world = pitchToWorld(pitch, x, y, z);
      const point = new THREE.Vector3(world.x, world.y, world.z);
      point.project(camera);
      return { x: point.x, y: point.y };
    };
    const controlled = findControlledPlayer(matchView);
    return {
      ball: projected(matchView.ball.x, matchView.ball.y, matchView.ball.z),
      controlled: projected(
        controlled?.x ?? matchView.ball.x,
        controlled?.y ?? matchView.ball.y,
        0,
      ),
    };
  }

  it("keeps the ball and controlled player visible at both ends", () => {
    for (const matchView of [
      view(),
      view({ ballX: 1.5, ballY: 2, controlledX: 4 }),
      view({ ballX: 103, ballY: 66, controlledX: 100 }),
      view({ ballX: 1, ballY: 66, controlledX: 5 }),
      view({ ballX: 103, ballY: 2, controlledX: 99 }),
    ]) {
      const frame = visibleInFrame(matchView);
      expect(Math.abs(frame.ball.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.ball.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.controlled.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.controlled.y)).toBeLessThanOrEqual(1);
    }
  });
});
