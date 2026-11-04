// packages/client/src/camera/types.ts

import type { Pitch, TeamSide } from "@fb/sim";
import type { MatchView } from "../render/view";

export interface CameraVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly position: CameraVec3;
  /** World-space point the camera is aimed at. */
  readonly target: CameraVec3;
  readonly fovDegrees: number;
}

export interface CameraShotDebug {
  /** Smoothed 0 = compact, 1 = wide. */
  readonly zoom: number;
}

/**
 * Screen-relative movement basis on the pitch plane. `forward` is screen-up
 * and `right` is screen-right, both in simulation x/y coordinates.
 */
export interface CameraInputBasis {
  readonly rightX: number;
  readonly rightY: number;
  readonly forwardX: number;
  readonly forwardY: number;
}

export interface CameraRenderState {
  readonly view: MatchView;
  /** Viewport aspect ratio; used for framing and debug output. */
  readonly aspect: number;
  /** Side this client is playing, or null for an unaffiliated/practice view. */
  readonly selfSide: TeamSide | null;
  /** Current half; controls which end the client attacks. */
  readonly half: number;
  readonly pitch: Pitch;
}

/**
 * A camera shot is a pure presentation strategy. It owns only its own spring
 * state; it must never read or mutate the simulation.
 */
export interface CameraShot {
  readonly id: string;
  readonly label: string;
  /** Blend-in time when the director activates this shot. */
  readonly blendSeconds: number;
  /** Called once when the shot becomes active. */
  enter(state: CameraRenderState): void;
  /** Called once per rendered frame after interpolation. */
  update(dt: number, state: CameraRenderState): CameraPose;
  /** Called when the shot leaves the active stack. */
  exit(): void;
  debug(): CameraShotDebug;
  /**
   * Current screen orientation for camera-relative input. Context shots omit
   * it so the base gameplay camera keeps controlling movement during a cut.
   */
  inputBasis?(): CameraInputBasis | null;
}

export interface CameraDirectorFrame {
  readonly pose: CameraPose;
  readonly shotId: string;
  readonly shotLabel: string;
  readonly target: CameraVec3;
  readonly fovDegrees: number;
  readonly zoom: number;
  /** True while a shot-to-shot blend is running. */
  readonly blending: boolean;
}
