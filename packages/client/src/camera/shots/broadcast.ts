// packages/client/src/camera/shots/broadcast.ts

import {
  cameraSideSign,
  clamp01,
  deadZonePoint,
  easeInOutCubic,
  lerp,
  softClamp,
  springStep,
} from "../cameraMath";
import { CAMERA_TUNING, type CameraTuning } from "../cameraTuning";
import type {
  CameraPose,
  CameraRenderState,
  CameraShot,
  CameraShotDebug,
  CameraVec3,
} from "../types";
import type { MatchView, RenderPlayer } from "../../render/view";

interface Point2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Television-style side-on camera.
 *
 * The look-at point is deliberately not the ball: it is a weighted blend of
 * the ball, the user's player and the players around the ball. Each component
 * of the rig has its own critically damped response, so a short touch cannot
 * shake the shot while a long switch still gets followed quickly.
 */
export class BroadcastShot implements CameraShot {
  readonly id = "broadcast";
  readonly label = "Broadcast";

  private targetX = { value: 0, velocity: 0 };
  private targetZ = { value: 0, velocity: 0 };
  private zoom = { value: 0, velocity: 0 };
  private fast = { value: 0, velocity: 0 };
  private ballAnchor: Point2 = { x: 0, z: 0 };
  private sideFrom = 1;
  private sideTo = 1;
  private sideProgress = 1;
  private lastPose: CameraPose | null = null;

  constructor(private readonly tuning: CameraTuning = CAMERA_TUNING) {}

  get blendSeconds(): number {
    return this.tuning.broadcast.blendSeconds;
  }

  enter(state: CameraRenderState): void {
    const view = state.view;
    this.ballAnchor = { x: view.ball.x, z: view.ball.y };
    const target = this.weightedTarget(view);
    const zoom = this.desiredZoom(view);
    this.targetX = { value: target.x, velocity: 0 };
    this.targetZ = { value: target.z, velocity: 0 };
    this.zoom = { value: zoom, velocity: 0 };
    this.fast = { value: 0, velocity: 0 };
    const side = cameraSideSign(view.selfSide, view.half);
    this.sideFrom = side;
    this.sideTo = side;
    this.sideProgress = 1;
    this.lastPose = this.composePose(state);
  }

  update(dt: number, state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.broadcast;

    this.ballAnchor = deadZonePoint(
      { x: view.ball.x, z: view.ball.y },
      this.ballAnchor,
      tuning.deadZoneM,
    );
    const ballSpeed = Math.hypot(view.ball.vx, view.ball.vy, view.ball.vz);
    const fullSpeed = Math.max(
      tuning.fastBallFullMps,
      tuning.fastBallStartMps + 0.001,
    );
    const fastTarget = clamp01(
      (ballSpeed - tuning.fastBallStartMps) /
        (fullSpeed - tuning.fastBallStartMps),
    );
    this.fast = springStep(
      this.fast,
      fastTarget,
      tuning.fastResponseSeconds,
      dt,
    );

    const target = this.weightedTarget(view);
    const trackingScale = 1 + this.fast.value * tuning.fastTrackingBoost;
    const panXResponse = tuning.panXResponseSeconds / trackingScale;
    const panZResponse = tuning.panZResponseSeconds / trackingScale;
    this.targetX = springStep(this.targetX, target.x, panXResponse, dt);
    this.targetZ = springStep(this.targetZ, target.z, panZResponse, dt);

    const desiredZoom = clamp01(
      this.desiredZoom(view) + this.fast.value * tuning.fastZoomBonus,
    );
    this.zoom = springStep(
      this.zoom,
      desiredZoom,
      tuning.zoomResponseSeconds,
      dt,
    );

    const side = cameraSideSign(view.selfSide, view.half);
    if (side !== this.sideTo) {
      this.sideFrom = this.currentSide();
      this.sideTo = side;
      this.sideProgress = 0;
    }
    if (this.sideProgress < 1) {
      this.sideProgress = Math.min(
        1,
        this.sideProgress + dt / Math.max(0.01, tuning.sideFlipSeconds),
      );
    }

    this.lastPose = this.composePose(state);
    return this.lastPose;
  }

  exit(): void {
    // Springs keep their state so returning to broadcast can blend smoothly.
  }

  debug(): CameraShotDebug {
    return { zoom: clamp01(this.zoom.value) };
  }

  /** Weighted tracking point in simulation pitch coordinates. */
  pureTarget(view: MatchView): Point2 {
    return this.weightedTarget(view);
  }

  private weightedTarget(view: MatchView): Point2 {
    const tuning = this.tuning.broadcast;
    const controlled = findControlledPlayer(view);
    const nearest = nearestPlayers(
      view,
      view.ball.x,
      view.ball.y,
      Math.round(tuning.nearestPlayerCount),
    );
    const speed = Math.hypot(view.ball.vx, view.ball.vy);
    const lead =
      speed <= 0
        ? { x: 0, z: 0 }
        : {
            x:
              (view.ball.vx / speed) *
              Math.min(speed * tuning.lookAheadSeconds, tuning.lookAheadMaxM),
            z:
              (view.ball.vy / speed) *
              Math.min(speed * tuning.lookAheadSeconds, tuning.lookAheadMaxM),
          };
    const ballX = this.ballAnchor.x + lead.x;
    const ballZ = this.ballAnchor.z + lead.z;

    let totalWeight = tuning.ballWeight;
    let x = ballX * tuning.ballWeight;
    let z = ballZ * tuning.ballWeight;
    if (controlled !== null) {
      totalWeight += tuning.controlledWeight;
      x += controlled.x * tuning.controlledWeight;
      z += controlled.y * tuning.controlledWeight;
    }
    if (nearest.length > 0) {
      const centroid = centroidOf(nearest);
      totalWeight += tuning.nearestWeight;
      x += centroid.x * tuning.nearestWeight;
      z += centroid.z * tuning.nearestWeight;
    }

    const raw =
      totalWeight <= 0
        ? { x: view.pitch.centreX, z: view.pitch.centreY }
        : { x: x / totalWeight, z: z / totalWeight };
    return {
      x: softClamp(
        raw.x,
        tuning.edgeMarginXM,
        view.pitch.lengthM - tuning.edgeMarginXM,
        tuning.edgeSoftnessM,
      ),
      z: softClamp(
        raw.z,
        tuning.edgeMarginZM,
        view.pitch.widthM - tuning.edgeMarginZM,
        tuning.edgeSoftnessM,
      ),
    };
  }

  private desiredZoom(view: MatchView): number {
    const controlled = findControlledPlayer(view);
    const nearest = nearestPlayers(
      view,
      view.ball.x,
      view.ball.y,
      Math.round(this.tuning.broadcast.nearestPlayerCount),
    );
    const points: Point2[] = [{ x: view.ball.x, z: view.ball.y }];
    if (controlled !== null) {
      points.push({ x: controlled.x, z: controlled.y });
    }
    for (const player of nearest) {
      points.push({ x: player.x, z: player.y });
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const spread = Math.max(maxX - minX, maxZ - minZ);
    const range =
      this.tuning.broadcast.spreadMaxM - this.tuning.broadcast.spreadMinM;
    return range <= 0
      ? 0
      : clamp01((spread - this.tuning.broadcast.spreadMinM) / range);
  }

  private currentSide(): number {
    return this.sideProgress >= 1
      ? this.sideTo
      : lerp(
          this.sideFrom,
          this.sideTo,
          easeInOutCubic(this.sideProgress),
        );
  }

  private composePose(state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.broadcast;
    const zoom = clamp01(this.zoom.value);
    const side = this.currentSide();
    const flipLift =
      this.sideProgress < 1
        ? Math.sin(Math.PI * this.sideProgress) * tuning.sideFlipLiftM
        : 0;
    const setback =
      tuning.sideSetbackM +
      tuning.tightSetbackM +
      (tuning.wideSetbackM - tuning.tightSetbackM) * zoom;
    const height =
      tuning.heightM +
      tuning.tightHeightM +
      (tuning.wideHeightM - tuning.tightHeightM) * zoom;
    const halfWidth = view.pitch.widthM / 2;
    const halfLength = view.pitch.lengthM / 2;
    const targetX = this.targetX.value;
    const targetZ = this.targetZ.value;
    const worldTarget: CameraVec3 = {
      x: targetX - halfLength,
      y: tuning.targetHeightM + view.ball.z * tuning.ballHeightFollow,
      z: targetZ - halfWidth,
    };
    const worldPosition: CameraVec3 = {
      x: worldTarget.x,
      y: height + flipLift,
      z:
        side * (halfWidth + setback) +
        (targetZ - halfWidth) * tuning.sideFollowZ,
    };
    return {
      position: worldPosition,
      target: worldTarget,
      fovDegrees:
        tuning.fovDegrees + tuning.wideFovDegrees * clamp01(zoom),
    };
  }
}

export function findControlledPlayer(view: MatchView): RenderPlayer | null {
  for (const team of [view.home, view.away]) {
    const player = team.players.find((candidate) => candidate.controlled);
    if (player !== undefined) {
      return player;
    }
  }
  return null;
}

export function nearestPlayers(
  view: MatchView,
  x: number,
  z: number,
  count: number,
): readonly RenderPlayer[] {
  const players = [...view.home.players, ...view.away.players].filter(
    (player) => !player.sentOff,
  );
  players.sort((a, b) => {
    const da = (a.x - x) ** 2 + (a.y - z) ** 2;
    const db = (b.x - x) ** 2 + (b.y - z) ** 2;
    return da - db;
  });
  return players.slice(0, Math.max(0, count));
}

function centroidOf(players: readonly RenderPlayer[]): Point2 {
  let x = 0;
  let z = 0;
  for (const player of players) {
    x += player.x;
    z += player.y;
  }
  return {
    x: x / Math.max(1, players.length),
    z: z / Math.max(1, players.length),
  };
}
