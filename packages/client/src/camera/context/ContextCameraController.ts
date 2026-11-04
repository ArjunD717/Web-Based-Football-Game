// packages/client/src/camera/context/ContextCameraController.ts

import type { MatchView } from "../../render/view";
import { CameraDirector } from "../CameraDirector";
import { CAMERA_TUNING, type CameraTuning } from "../cameraTuning";
import type { CameraRenderState } from "../types";
import {
  createHalfTimeShot,
  createIncidentShot,
  createKickoffShot,
  createRestartShot,
  createSubstitutionShot,
  findPlayerPoint,
  FullTimeShot,
  GoalCelebrationShot,
  type ContextShot,
} from "./contextShots";
import {
  createContextMemory,
  nextContextTrigger,
  type ContextMemory,
  type ContextTrigger,
} from "./contextTrigger";

const SKIP_KEY = "Enter";
const SKIP_HINT = "Enter · skip camera";

/**
 * Turns match phase/restart/event metadata into temporary camera shots.
 *
 * The base broadcast shot stays at the bottom of the director stack. A context
 * is consumed exactly once, runs for its own duration, and can be dismissed by
 * Enter or the on-screen skip control.
 */
export class ContextCameraController {
  private readonly memory: ContextMemory = createContextMemory();
  private readonly skipButton: HTMLButtonElement | null;
  private active: ContextShot | null = null;
  private elapsedSeconds = 0;
  private previousView: MatchView | null = null;
  private lastState: CameraRenderState | null = null;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      this.active === null ||
      event.code !== SKIP_KEY ||
      event.repeat ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.requestSkip();
  };

  constructor(
    private readonly director: CameraDirector,
    private readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    this.skipButton =
      typeof document === "undefined" ? null : this.createSkipButton();
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  update(dt: number, state: CameraRenderState): void {
    this.lastState = state;
    if (this.active !== null) {
      this.elapsedSeconds += Math.max(0, dt);
      if (this.elapsedSeconds >= this.active.durationSeconds) {
        this.clear(state);
      }
    }

    const trigger = nextContextTrigger(
      state.view,
      this.previousView,
      this.memory,
    );
    this.previousView = state.view;
    if (trigger === null) {
      return;
    }

    if (this.active !== null) {
      const canReplace =
        trigger.kind === "goal" ||
        trigger.kind === "phase";
      if (!canReplace) {
        return;
      }
      this.clear(state);
    }

    const shot = this.createShot(trigger, state.view);
    if (shot === null) {
      return;
    }
    this.director.push(shot, state);
    this.active = shot;
    this.elapsedSeconds = 0;
    this.setSkipHint(true);
  }


  reset(): void {
    this.active = null;
    this.elapsedSeconds = 0;
    this.previousView = null;
    this.lastState = null;
    Object.assign(this.memory, createContextMemory());
    this.setSkipHint(false);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.skipButton?.remove();
    this.active = null;
  }

  private clear(state: CameraRenderState): void {
    if (this.active === null) {
      return;
    }
    this.active = null;
    this.elapsedSeconds = 0;
    this.director.pop(state);
    this.setSkipHint(false);
  }

  private requestSkip(): void {
    if (this.active === null || this.lastState === null) {
      return;
    }
    this.clear(this.lastState);
  }

  private createShot(
    trigger: ContextTrigger,
    view: MatchView,
  ): ContextShot | null {
    switch (trigger.kind) {
      case "goal":
        return new GoalCelebrationShot(
          trigger.scorer ?? { x: view.ball.x, y: view.ball.y },
          this.tuning,
        );
      case "phase":
        return trigger.phase === "halfTime"
          ? createHalfTimeShot(this.tuning)
          : new FullTimeShot(this.tuning);
      case "incident":
        return createIncidentShot(
          findPlayerPoint(view, trigger.event),
          this.tuning,
        );
      case "substitution":
        return createSubstitutionShot(this.tuning);
      case "restart":
        return createRestartShot(trigger.restartType, this.tuning);
      case "kickoff":
        return createKickoffShot(this.tuning);
    }
  }

  private createSkipButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-skip";
    button.textContent = SKIP_HINT;
    button.setAttribute("aria-label", "Skip the current camera shot");
    button.hidden = true;
    button.style.position = "fixed";
    button.style.left = "50%";
    button.style.bottom = "92px";
    button.style.transform = "translateX(-50%)";
    button.style.zIndex = "30";
    button.style.pointerEvents = "auto";
    button.addEventListener("click", () => {
      this.requestSkip();
    });
    document.body.append(button);
    return button;
  }

  private setSkipHint(visible: boolean): void {
    if (this.skipButton === null) {
      return;
    }
    this.skipButton.hidden = !visible;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}
