// packages/client/src/camera/shots/endToEnd.ts

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
import { CAMERA_TUNING, type CameraTuning } from "../cameraTuning";
import type {
  CameraInputBasis,
  CameraPose,
  CameraRenderState,
  CameraShot,
  CameraShotDebug,
  CameraVec3,
} from "../types";
import type { MatchView } from "../../render/view";
import { findControlledPlayer } from "./sideTracking";

interface Point2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Behind-the-goal camera that looks down the length of the pitch. The own
 * goal is selected from the attacking direction, so both seats always look
 * toward the goal they attack and the half-time swap is animated.
 */
export class EndToEndShot implements CameraShot {
  readonly id = "end-to-end";
  readonly label = "End to end";

  private targetX = { value: 0, velocity: 0 };
  private targetZ = { value: 0, velocity: 0 };
  private zoom = { value: 0, velocity: 0 };
  private ballAnchor: Point2 = { x: 0, z: 0 };
  private attackFrom = 1;
  private attackTo = 1;
  private attackProgress = 1;
  private lastPose: CameraPose | null = null;

  constructor(private readonly tuning: CameraTuning = CAMERA_TUNING) {}

  get blendSeconds(): number {
    return this.tuning.endToEnd.blendSeconds;
  }

  enter(state: CameraRenderState): void {
    const view = state.view;
    this.ballAnchor = { x: view.ball.x, z: view.ball.y };
    const target = this.weightedTarget(view);
    this.targetX = { value: target.x, velocity: 0 };
    this.targetZ = { value: target.z, velocity: 0 };
    this.zoom = { value: this.desiredZoom(view, target), velocity: 0 };
    const attack = cameraSideSign(view.selfSide, view.half);
    this.attackFrom = attack;
    this.attackTo = attack;
    this.attackProgress = 1;
    this.lastPose = this.composePose(state);
  }

  update(dt: number, state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.endToEnd;
    this.ballAnchor = deadZonePoint(
      { x: view.ball.x, z: view.ball.y },
      this.ballAnchor,
      tuning.deadZoneM,
    );

    const target = this.weightedTarget(view);
    this.targetX = springStep(
      this.targetX,
      target.x,
      tuning.panXResponseSeconds,
      dt,
    );
    this.targetZ = springStep(
      this.targetZ,
      target.z,
      tuning.panZResponseSeconds,
      dt,
    );
    this.zoom = springStep(
      this.zoom,
      this.desiredZoom(view, target),
      tuning.zoomResponseSeconds,
      dt,
    );

    const attack = cameraSideSign(view.selfSide, view.half);
    if (attack !== this.attackTo) {
      this.attackFrom = this.currentAttack();
      this.attackTo = attack;
      this.attackProgress = 0;
    }
    if (this.attackProgress < 1) {
      this.attackProgress = Math.min(
        1,
        this.attackProgress + dt / Math.max(0.01, tuning.flipSeconds),
      );
    }

    this.lastPose = this.composePose(state);
    return this.lastPose;
  }

  exit(): void {
    // Keep springs alive for a seamless return to this camera.
  }

  debug(): CameraShotDebug {
    return { zoom: clamp01(this.zoom.value) };
  }

  inputBasis(): CameraInputBasis | null {
    return this.lastPose === null
      ? null
      : cameraGroundBasis(this.lastPose);
  }

  /** Weighted look-at point in simulation pitch coordinates. */
  pureTarget(view: MatchView): Point2 {
    return this.weightedTarget(view);
  }

  private weightedTarget(view: MatchView): Point2 {
    const tuning = this.tuning.endToEnd;
    const tracking = this.tuning.broadcast;
    const controlled = findControlledPlayer(view);
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
    let totalWeight = tracking.ballWeight;
    let rawX = ballX * tracking.ballWeight;
    let rawZ = ballZ * tracking.ballWeight;
    if (controlled !== null) {
      totalWeight += tracking.controlledWeight;
      rawX += controlled.x * tracking.controlledWeight;
      rawZ += controlled.y * tracking.controlledWeight;
    }
    return {
      x: softClamp(
        rawX / totalWeight,
        0,
        view.pitch.lengthM,
        tuning.edgeSoftnessM,
      ),
      z: softClamp(
        rawZ / totalWeight,
        tuning.edgeMarginZM,
        view.pitch.widthM - tuning.edgeMarginZM,
        tuning.edgeSoftnessM,
      ),
    };
  }

  private desiredZoom(view: MatchView, target: Point2): number {
    const attack = this.attackTo;
    const upfield =
      attack === 1 ? target.x / view.pitch.lengthM : 1 - target.x / view.pitch.lengthM;
    return clamp01(upfield);
  }

  private currentAttack(): number {
    return this.attackProgress >= 1
      ? this.attackTo
      : lerp(
          this.attackFrom,
          this.attackTo,
          easeInOutCubic(this.attackProgress),
        );
  }

  private composePose(state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.endToEnd;
    const zoom = clamp01(this.zoom.value);
    const attack = this.currentAttack();
    const flipLift =
      this.attackProgress < 1
        ? Math.sin(Math.PI * this.attackProgress) * tuning.flipLiftM
        : 0;
    const fromOwnGoalX = this.attackFrom >= 0 ? 0 : view.pitch.lengthM;
    const toOwnGoalX = this.attackTo >= 0 ? 0 : view.pitch.lengthM;
    const ownGoalX = lerp(
      fromOwnGoalX,
      toOwnGoalX,
      easeInOutCubic(this.attackProgress),
    );
    const halfLength = view.pitch.lengthM / 2;
    const halfWidth = view.pitch.widthM / 2;
    const targetX = this.targetX.value;
    const targetZ = this.targetZ.value;
    const worldTarget: CameraVec3 = {
      x: targetX - halfLength,
      y: tuning.targetHeightM + view.ball.z * tuning.ballHeightFollow,
      z: targetZ - halfWidth,
    };
    const worldPosition: CameraVec3 = {
      x: ownGoalX - attack * tuning.setbackM - halfLength,
      y: tuning.heightM + flipLift,
      z: (targetZ - halfWidth) * tuning.goalLineFollow,
    };
    return {
      position: worldPosition,
      target: worldTarget,
      fovDegrees: tuning.fovDegrees + tuning.wideFovDegrees * zoom,
    };
  }
}
