// packages/client/src/camera/shots/sideTracking.ts

import {
  cameraGroundBasis,
  cameraSideSign,
  clamp01,
  deadZonePoint,
  easeInOutCubic,
  lerp,
  softClamp,
  springStep,
} from "../cameraMath";
import type {
  SideCameraFrameTuning,
  SideTrackingTuning,
} from "../cameraTuning";
import type {
  CameraInputBasis,
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
 * Touchline camera shared by broadcast, tele, wide and drone presets.
 *
 * The look-at point is deliberately not the ball: it is a weighted blend of
 * the ball, the user's player and the players around the ball. Each component
 * of the rig has its own critically damped response, so a short touch cannot
 * shake the shot while a long switch still gets followed quickly.
 */
export class SideTrackingShot implements CameraShot {
  readonly id: string;
  readonly label: string;

  private targetX = { value: 0, velocity: 0 };
  private targetZ = { value: 0, velocity: 0 };
  private zoom = { value: 0, velocity: 0 };
  private fast = { value: 0, velocity: 0 };
  private ballAnchor: Point2 = { x: 0, z: 0 };
  private sideFrom = 1;
  private sideTo = 1;
  private sideProgress = 1;
  private lastPose: CameraPose | null = null;

  constructor(
    id: string,
    label: string,
    private readonly frame: SideCameraFrameTuning,
    private readonly tracking: SideTrackingTuning,
  ) {
    this.id = id;
    this.label = label;
  }

  get blendSeconds(): number {
    return this.frame.blendSeconds;
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
    const tracking = this.tracking;

    this.ballAnchor = deadZonePoint(
      { x: view.ball.x, z: view.ball.y },
      this.ballAnchor,
      tracking.deadZoneM,
    );
    const ballSpeed = Math.hypot(view.ball.vx, view.ball.vy, view.ball.vz);
    const fullSpeed = Math.max(
      tracking.fastBallFullMps,
      tracking.fastBallStartMps + 0.001,
    );
    const fastTarget = clamp01(
      (ballSpeed - tracking.fastBallStartMps) /
        (fullSpeed - tracking.fastBallStartMps),
    );
    this.fast = springStep(
      this.fast,
      fastTarget,
      tracking.fastResponseSeconds,
      dt,
    );

    const target = this.weightedTarget(view);
    const trackingScale = 1 + this.fast.value * tracking.fastTrackingBoost;
    const panXResponse = tracking.panXResponseSeconds / trackingScale;
    const panZResponse = tracking.panZResponseSeconds / trackingScale;
    this.targetX = springStep(this.targetX, target.x, panXResponse, dt);
    this.targetZ = springStep(this.targetZ, target.z, panZResponse, dt);

    const desiredZoom = clamp01(
      this.desiredZoom(view) + this.fast.value * tracking.fastZoomBonus,
    );
    this.zoom = springStep(
      this.zoom,
      desiredZoom,
      tracking.zoomResponseSeconds,
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
        this.sideProgress +
          dt / Math.max(0.01, this.frame.sideFlipSeconds),
      );
    }

    this.lastPose = this.composePose(state);
    return this.lastPose;
  }

  exit(): void {
    // Springs keep their state so returning to this shot can blend smoothly.
  }

  debug(): CameraShotDebug {
    return { zoom: clamp01(this.zoom.value) };
  }

  inputBasis(): CameraInputBasis | null {
    return this.lastPose === null
      ? null
      : cameraGroundBasis(this.lastPose);
  }

  /** Weighted tracking point in simulation pitch coordinates. */
  pureTarget(view: MatchView): Point2 {
    return this.weightedTarget(view);
  }

  private weightedTarget(view: MatchView): Point2 {
    const tracking = this.tracking;
    const controlled = findControlledPlayer(view);
    const nearest = nearestPlayers(
      view,
      view.ball.x,
      view.ball.y,
      Math.round(tracking.nearestPlayerCount),
    );
    const speed = Math.hypot(view.ball.vx, view.ball.vy);
    const lead =
      speed <= 0
        ? { x: 0, z: 0 }
        : {
            x:
              (view.ball.vx / speed) *
              Math.min(
                speed * tracking.lookAheadSeconds,
                tracking.lookAheadMaxM,
              ),
            z:
              (view.ball.vy / speed) *
              Math.min(
                speed * tracking.lookAheadSeconds,
                tracking.lookAheadMaxM,
              ),
          };
    const ballX = this.ballAnchor.x + lead.x;
    const ballZ = this.ballAnchor.z + lead.z;

    let totalWeight = tracking.ballWeight;
    let x = ballX * tracking.ballWeight;
    let z = ballZ * tracking.ballWeight;
    if (controlled !== null) {
      totalWeight += tracking.controlledWeight;
      x += controlled.x * tracking.controlledWeight;
      z += controlled.y * tracking.controlledWeight;
    }
    if (nearest.length > 0) {
      const centroid = centroidOf(nearest);
      totalWeight += tracking.nearestWeight;
      x += centroid.x * tracking.nearestWeight;
      z += centroid.z * tracking.nearestWeight;
    }

    const raw =
      totalWeight <= 0
        ? { x: view.pitch.centreX, z: view.pitch.centreY }
        : { x: x / totalWeight, z: z / totalWeight };
    return {
      x: softClamp(
        raw.x,
        tracking.edgeMarginXM,
        view.pitch.lengthM - tracking.edgeMarginXM,
        tracking.edgeSoftnessM,
      ),
      z: softClamp(
        raw.z,
        tracking.edgeMarginZM,
        view.pitch.widthM - tracking.edgeMarginZM,
        tracking.edgeSoftnessM,
      ),
    };
  }

  private desiredZoom(view: MatchView): number {
    const tracking = this.tracking;
    const controlled = findControlledPlayer(view);
    const nearest = nearestPlayers(
      view,
      view.ball.x,
      view.ball.y,
      Math.round(tracking.nearestPlayerCount),
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
    const range = tracking.spreadMaxM - tracking.spreadMinM;
    return range <= 0
      ? 0
      : clamp01((spread - tracking.spreadMinM) / range);
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
    const frame = this.frame;
    const zoom = clamp01(this.zoom.value);
    const side = this.currentSide();
    const flipLift =
      this.sideProgress < 1
        ? Math.sin(Math.PI * this.sideProgress) * frame.sideFlipLiftM
        : 0;
    const setback =
      frame.sideSetbackM +
      frame.tightSetbackM +
      (frame.wideSetbackM - frame.tightSetbackM) * zoom;
    const height =
      frame.heightM +
      frame.tightHeightM +
      (frame.wideHeightM - frame.tightHeightM) * zoom;
    const halfWidth = view.pitch.widthM / 2;
    const halfLength = view.pitch.lengthM / 2;
    const targetX = this.targetX.value;
    const targetZ = this.targetZ.value;
    const worldTarget: CameraVec3 = {
      x: targetX - halfLength,
      y: frame.targetHeightM + view.ball.z * frame.ballHeightFollow,
      z: targetZ - halfWidth,
    };
    const worldPosition: CameraVec3 = {
      x: worldTarget.x,
      y: height + flipLift,
      z:
        side * (halfWidth + setback) +
        (targetZ - halfWidth) * frame.sideFollowZ,
    };
    return {
      position: worldPosition,
      target: worldTarget,
      fovDegrees:
        frame.fovDegrees + frame.wideFovDegrees * clamp01(zoom),
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
