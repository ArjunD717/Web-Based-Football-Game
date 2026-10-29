// packages/client/src/input/touch-controls.ts
import { CONTROL_BUTTONS, TUNING, clamp } from "@fb/shared";
import type { ControlFrame } from "./desktop-controls";

const CONTROL_BITS: Readonly<Record<string, number>> = {
  pass: CONTROL_BUTTONS.PASS,
  through: CONTROL_BUTTONS.THROUGH,
  lob: CONTROL_BUTTONS.LOB,
  shoot: CONTROL_BUTTONS.SHOOT,
  tackle: CONTROL_BUTTONS.TACKLE,
  switch: CONTROL_BUTTONS.SWITCH,
  sprint: CONTROL_BUTTONS.SPRINT,
  finesse: CONTROL_BUTTONS.FINESSE,
};

/** Virtual joystick + holdable action buttons for the phone controller page. */
export class TouchControls {
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<number, HTMLElement>();
  private readonly pointerControl = new Map<number, string>();
  private stickPointerId: number | null = null;
  private moveX = 0;
  private moveY = 0;
  private shootStartedAtMs: number | null = null;
  private charge = 0;
  private pendingButtons = 0;

  constructor(root: HTMLElement) {
    const stick = root.querySelector<HTMLElement>(".touch-stick");
    const knob = root.querySelector<HTMLElement>(".touch-knob");
    if (stick === null || knob === null) {
      throw new Error("Touch controls require .touch-stick and .touch-knob");
    }
    this.stick = stick;
    this.knob = knob;

    for (const button of root.querySelectorAll<HTMLElement>("[data-control]")) {
      const control = button.dataset.control;
      if (control === undefined) {
        continue;
      }
      this.buttons.set(this.buttons.size, button);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (!CONTROL_BITS[control]) {
          return;
        }
        button.setPointerCapture(event.pointerId);
        this.pointerControl.set(event.pointerId, control);
        this.pendingButtons |= CONTROL_BITS[control] ?? 0;
        button.classList.add("is-held");
      });
      const release = (releaseEvent: PointerEvent): void => {
        this.pointerControl.delete(releaseEvent.pointerId);
        button.classList.remove("is-held");
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }

    this.stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.stickPointerId = event.pointerId;
      this.stick.setPointerCapture(event.pointerId);
      this.updateStick(event);
    });
    this.stick.addEventListener("pointermove", (event) => {
      if (this.stickPointerId === event.pointerId) {
        event.preventDefault();
        this.updateStick(event);
      }
    });
    const releaseStick = (event: PointerEvent): void => {
      if (this.stickPointerId !== event.pointerId) {
        return;
      }
      this.stickPointerId = null;
      this.moveX = 0;
      this.moveY = 0;
      this.knob.style.transform = "translate(-50%, -50%)";
    };
    this.stick.addEventListener("pointerup", releaseStick);
    this.stick.addEventListener("pointercancel", releaseStick);
    this.stick.addEventListener("lostpointercapture", releaseStick);
  }

  read(nowMs: number): ControlFrame {
    let buttons = 0;
    for (const control of this.pointerControl.values()) {
      buttons |= CONTROL_BITS[control] ?? 0;
    }
    buttons |= this.pendingButtons;
    this.pendingButtons = 0;

    const shooting = (buttons & CONTROL_BUTTONS.SHOOT) !== 0;
    if (shooting) {
      if (this.shootStartedAtMs === null) {
        this.shootStartedAtMs = nowMs;
      }
      this.charge = clamp(
        (nowMs - this.shootStartedAtMs) /
          (TUNING.control.shotChargeSeconds * 1_000),
        0,
        1,
      );
    } else {
      this.shootStartedAtMs = null;
      this.charge = 0;
    }

    return {
      moveX: this.moveX,
      moveY: this.moveY,
      buttons,
      chargePower: this.charge,
    };
  }

  get chargePower(): number {
    return this.charge;
  }

  reset(): void {
    this.pointerControl.clear();
    for (const button of this.buttons.values()) {
      button.classList.remove("is-held");
    }
    this.stickPointerId = null;
    this.moveX = 0;
    this.moveY = 0;
    this.shootStartedAtMs = null;
    this.charge = 0;
    this.pendingButtons = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  private updateStick(event: PointerEvent): void {
    const rect = this.stick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = Math.min(rect.width, rect.height) * 0.36;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius && distance > 0) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    this.moveX = clamp(dx / maxRadius, -1, 1);
    this.moveY = clamp(dy / maxRadius, -1, 1);
    this.knob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
  }
}
