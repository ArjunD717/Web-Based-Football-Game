// packages/client/src/camera/shots/player.ts

import {
  cameraGroundBasis,
  cameraSideSign,
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

const MIN_DIRECTION_LENGTH = 0.0001;

/**
 * Low chase camera behind the controlled player. The look direction is
 * damped so quick turns do not whip the view around; movement stays mapped
 * to the rendered camera basis.
 */
export class PlayerShot implements CameraShot {
  readonly id = "player";
  readonly label = "Player";

  private directionX = { value: 1, velocity: 0 };
  private directionZ = { value: 0, velocity: 0 };
  private positionX = { value: 0, velocity: 0 };
  private positionZ = { value: 0, velocity: 0 };
  private targetX = { value: 0, velocity: 0 };
  private targetZ = { value: 0, velocity: 0 };
  private lastPose: CameraPose | null = null;

  constructor(private readonly tuning: CameraTuning = CAMERA_TUNING) {}

  get blendSeconds(): number {
    return this.tuning.player.blendSeconds;
  }

  enter(state: CameraRenderState): void {
    const view = state.view;
    const point = focusPoint(view);
    const direction = facingDirection(view, point.facing);
    this.directionX = { value: direction.x, velocity: 0 };
    this.directionZ = { value: direction.z, velocity: 0 };
    this.positionX = {
      value: point.x - direction.x * this.tuning.player.distanceM,
      velocity: 0,
    };
    this.positionZ = {
      value: point.z - direction.z * this.tuning.player.distanceM,
      velocity: 0,
    };
    this.targetX = {
      value: point.x + direction.x * this.tuning.player.lookAheadM,
      velocity: 0,
    };
    this.targetZ = {
      value: point.z + direction.z * this.tuning.player.lookAheadM,
      velocity: 0,
    };
    this.lastPose = this.composePose(state);
  }

  update(dt: number, state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.player;
    const point = focusPoint(view);
    const facing = facingDirection(view, point.facing);
    this.directionX = springStep(
      this.directionX,
      facing.x,
      tuning.lookResponseSeconds,
      dt,
    );
    this.directionZ = springStep(
      this.directionZ,
      facing.z,
      tuning.lookResponseSeconds,
      dt,
    );

    const length = Math.hypot(this.directionX.value, this.directionZ.value);
    const direction =
      length < MIN_DIRECTION_LENGTH
        ? facing
        : {
            x: this.directionX.value / length,
            z: this.directionZ.value / length,
          };
    const pitch = view.pitch;
    const desiredX = softClamp(
      point.x - direction.x * tuning.distanceM,
      -tuning.boundsMarginM,
      pitch.lengthM + tuning.boundsMarginM,
      tuning.boundsMarginM,
    );
    const desiredZ = softClamp(
      point.z - direction.z * tuning.distanceM,
      -tuning.boundsMarginM,
      pitch.widthM + tuning.boundsMarginM,
      tuning.boundsMarginM,
    );
    this.positionX = springStep(
      this.positionX,
      desiredX,
      tuning.positionResponseSeconds,
      dt,
    );
    this.positionZ = springStep(
      this.positionZ,
      desiredZ,
      tuning.positionResponseSeconds,
      dt,
    );
    this.targetX = springStep(
      this.targetX,
      point.x + direction.x * tuning.lookAheadM,
      tuning.targetResponseSeconds,
      dt,
    );
    this.targetZ = springStep(
      this.targetZ,
      point.z + direction.z * tuning.lookAheadM,
      tuning.targetResponseSeconds,
      dt,
    );

    this.lastPose = this.composePose(state);
    return this.lastPose;
  }

  exit(): void {
    // Keep the chase state for a smooth return to the player camera.
  }

  debug(): CameraShotDebug {
    return { zoom: 0 };
  }

  inputBasis(): CameraInputBasis | null {
    return this.lastPose === null
      ? null
      : cameraGroundBasis(this.lastPose);
  }

  private composePose(state: CameraRenderState): CameraPose {
    const view = state.view;
    const tuning = this.tuning.player;
    const halfLength = view.pitch.lengthM / 2;
    const halfWidth = view.pitch.widthM / 2;
    const worldTarget: CameraVec3 = {
      x: this.targetX.value - halfLength,
      y: tuning.targetHeightM,
      z: this.targetZ.value - halfWidth,
    };
    const worldPosition: CameraVec3 = {
      x: this.positionX.value - halfLength,
      y: tuning.heightM,
      z: this.positionZ.value - halfWidth,
    };
    return {
      position: worldPosition,
      target: worldTarget,
      fovDegrees: tuning.fovDegrees,
    };
  }
}

interface FocusPoint {
  readonly x: number;
  readonly z: number;
  readonly facing: number | null;
}

function focusPoint(view: MatchView): FocusPoint {
  const controlled = findControlledPlayer(view);
  if (controlled !== null) {
    return {
      x: controlled.x,
      z: controlled.y,
      facing: controlled.facing,
    };
  }
  return { x: view.ball.x, z: view.ball.y, facing: null };
}

function facingDirection(
  view: MatchView,
  facing: number | null,
): { readonly x: number; readonly z: number } {
  if (facing !== null) {
    return { x: Math.cos(facing), z: Math.sin(facing) };
  }
  const attack = cameraSideSign(view.selfSide, view.half);
  return { x: attack, z: 0 };
}
