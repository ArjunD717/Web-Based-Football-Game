// packages/client/src/camera/CameraDirector.ts

import { lerpPose } from "./cameraMath";
import { CAMERA_TUNING } from "./cameraTuning";
import type {
  CameraDirectorFrame,
  CameraPose,
  CameraRenderState,
  CameraShot,
} from "./types";

/**
 * Owns the active camera stack and the transition between shots.
 *
 * A shot is only updated while it is on top of the stack. Pushing a contextual
 * shot preserves the base shot underneath; popping it re-enters the base shot
 * and blends from whatever the contextual shot last rendered.
 */
export class CameraDirector {
  private readonly stack: CameraShot[] = [];
  private lastPose: CameraPose | null = null;
  private blend:
    | {
        from: CameraPose;
        remainingSeconds: number;
        durationSeconds: number;
      }
    | null = null;

  constructor(private readonly tuning = CAMERA_TUNING) {}

  get depth(): number {
    return this.stack.length;
  }

  get activeShot(): CameraShot | null {
    return this.stack.at(-1) ?? null;
  }

  /** Replace the whole stack with a new base shot. Used on match install. */
  setBase(shot: CameraShot, state: CameraRenderState): void {
    this.exitAll();
    this.stack.push(shot);
    this.activeShot?.enter(state);
    this.blend = null;
    this.lastPose = null;
  }

  /**
   * Swap the gameplay base without discarding an active context shot. With no
   * context on top, the new base blends from the last rendered pose.
   */
  replaceBase(
    shot: CameraShot,
    state: CameraRenderState,
    blendSeconds: number,
  ): void {
    if (this.stack.length === 0) {
      this.setBase(shot, state);
      return;
    }
    const contextIsActive = this.stack.length > 1;
    this.stack[0]?.exit();
    this.stack[0] = shot;
    if (contextIsActive) {
      return;
    }
    shot.enter(state);
    this.startBlend(blendSeconds);
  }

  /** Push a contextual shot over the current view. */
  push(shot: CameraShot, state: CameraRenderState): void {
    if (this.stack.length === 0) {
      this.setBase(shot, state);
      return;
    }
    this.activeShot?.exit();
    this.stack.push(shot);
    shot.enter(state);
    this.startBlend(shot.blendSeconds);
  }

  /** Remove the top contextual shot and return to the shot underneath. */
  pop(state: CameraRenderState): void {
    if (this.stack.length <= 1) {
      return;
    }
    this.activeShot?.exit();
    this.stack.pop();
    this.activeShot?.enter(state);
    this.startBlend(this.activeShot?.blendSeconds ?? 0);
  }

  /** Clear all camera state; the next update snaps to the active shot. */
  reset(): void {
    this.exitAll();
    this.stack.length = 0;
    this.lastPose = null;
    this.blend = null;
  }

  update(dt: number, state: CameraRenderState): CameraDirectorFrame | null {
    const shot = this.activeShot;
    if (shot === null) {
      return null;
    }
    const safeDt = Math.min(
      this.tuning.director.maxFrameDeltaSeconds,
      Math.max(0, dt),
    );
    const measured = shot.update(safeDt, state);
    let pose = measured;

    if (this.blend !== null && this.lastPose !== null) {
      this.blend.remainingSeconds = Math.max(
        0,
        this.blend.remainingSeconds - safeDt,
      );
      const duration = Math.max(0.001, this.blend.durationSeconds);
      const progress = 1 - this.blend.remainingSeconds / duration;
      pose = lerpPose(this.blend.from, measured, progress);
      if (this.blend.remainingSeconds <= 0) {
        this.blend = null;
      }
    }

    this.lastPose = pose;
    const debug = shot.debug();
    return {
      pose,
      shotId: shot.id,
      shotLabel: shot.label,
      target: pose.target,
      fovDegrees: pose.fovDegrees,
      zoom: debug.zoom,
      blending: this.blend !== null,
    };
  }

  private startBlend(seconds: number): void {
    const duration =
      seconds > 0 ? seconds : this.tuning.director.defaultBlendSeconds;
    this.blend = {
      from: this.lastPose ?? emptyPose(),
      remainingSeconds: duration,
      durationSeconds: duration,
    };
  }

  private exitAll(): void {
    for (const shot of this.stack) {
      shot.exit();
    }
    this.stack.length = 0;
  }
}

function emptyPose(): CameraPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    fovDegrees: CAMERA_TUNING.broadcast.fovDegrees,
  };
}
