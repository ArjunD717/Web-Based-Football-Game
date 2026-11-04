// packages/client/src/input/desktop-controls.ts
import {
  CONTROL_BUTTONS,
  TUNING,
  clamp,
} from "@fb/shared";
import {
  DEFAULT_GAMEPAD_BINDINGS,
  GAMEPAD_ACTION_BUTTONS,
  GAMEPAD_ACTIONS,
  loadGamepadBindings,
  type GamepadBindings,
} from "./gamepad-bindings";

export type ChargeKind = "shot" | "pass" | "none";

export interface ControlFrame {
  readonly moveX: number;
  readonly moveY: number;
  readonly buttons: number;
  readonly chargePower: number;
  readonly chargeKind: ChargeKind;
}

export interface GamepadSnapshot {
  readonly moveX: number;
  readonly moveY: number;
  /** Right-stick axes are used only for directional skill moves. */
  readonly skillX: number;
  readonly skillY: number;
  readonly buttons: number;
}

export type ControlAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "sprint"
  | "pass"
  | "through"
  | "lob"
  | "shoot"
  | "tackle"
  | "switch"
  | "finesse"
  | "skillUp"
  | "skillDown"
  | "skillLeft"
  | "skillRight"
  | "drivenPass";

export type KeyBindings = Readonly<Record<ControlAction, readonly string[]>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  pass: ["KeyX", "KeyJ"],
  through: ["KeyC", "KeyK"],
  lob: ["KeyV", "KeyL"],
  shoot: ["KeyZ", "KeyI"],
  tackle: ["KeyF", "KeyO"],
  switch: ["Space", "KeyQ"],
  finesse: ["KeyE", "KeyU"],
  skillUp: ["Numpad8"],
  skillDown: ["Numpad2"],
  skillLeft: ["Numpad4"],
  skillRight: ["Numpad6"],
  drivenPass: ["KeyB"],
};

const BINDINGS_KEY = "fb.keybindings.v1";

/** Keyboard and gamepad controls. Stick movement is fixed; buttons can be
 * rebound in the same dialog as the keyboard.
 */
export class DesktopControls {
  private readonly keys = new Set<string>();
  private readonly bindings: KeyBindings;
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || !this.isBound(event.code)) {
      return;
    }
    event.preventDefault();
    if (!this.keys.has(event.code)) {
      this.pendingButtons |= this.buttonForCode(event.code);
    }
    this.keys.add(event.code);
  };
  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.isBound(event.code)) {
      return;
    }
    event.preventDefault();
    this.keys.delete(event.code);
  };
  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.chargeStartedAtMs = null;
    this.chargeKind = "none";
    this.charge = 0;
    this.pendingButtons = 0;
  };
  private chargeStartedAtMs: number | null = null;
  private chargeKind: ChargeKind = "none";
  private charge = 0;
  private pendingButtons = 0;

  constructor(
    bindings: KeyBindings = loadKeyBindings(),
    private readonly gamepadBindings: GamepadBindings = loadGamepadBindings(),
  ) {
    this.bindings = bindings;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
  }

  reset(): void {
    this.keys.clear();
    this.chargeStartedAtMs = null;
    this.chargeKind = "none";
    this.charge = 0;
    this.pendingButtons = 0;
  }

  read(nowMs: number): ControlFrame {
    let moveX = 0;
    let moveY = 0;
    let buttons = 0;

    if (this.isPressed("right")) moveX += 1;
    if (this.isPressed("left")) moveX -= 1;
    if (this.isPressed("down")) moveY += 1;
    if (this.isPressed("up")) moveY -= 1;
    const keyboardMagnitude = Math.hypot(moveX, moveY);
    if (keyboardMagnitude > 1) {
      moveX /= keyboardMagnitude;
      moveY /= keyboardMagnitude;
    }

    if (this.isPressed("sprint")) buttons |= CONTROL_BUTTONS.SPRINT;
    if (this.isPressed("pass")) buttons |= CONTROL_BUTTONS.PASS;
    if (this.isPressed("through")) buttons |= CONTROL_BUTTONS.THROUGH;
    if (this.isPressed("lob")) buttons |= CONTROL_BUTTONS.LOB;
    if (this.isPressed("shoot")) buttons |= CONTROL_BUTTONS.SHOOT;
    if (this.isPressed("tackle")) buttons |= CONTROL_BUTTONS.TACKLE;
    if (this.isPressed("switch")) buttons |= CONTROL_BUTTONS.SWITCH;
    if (this.isPressed("finesse")) buttons |= CONTROL_BUTTONS.FINESSE;
    if (this.isPressed("skillUp")) buttons |= CONTROL_BUTTONS.SKILL_UP;
    if (this.isPressed("skillDown")) buttons |= CONTROL_BUTTONS.SKILL_DOWN;
    if (this.isPressed("skillLeft")) buttons |= CONTROL_BUTTONS.SKILL_LEFT;
    if (this.isPressed("skillRight")) buttons |= CONTROL_BUTTONS.SKILL_RIGHT;
    if (this.isPressed("drivenPass")) buttons |= CONTROL_BUTTONS.DRIVEN_PASS;

    const pad = readGamepad(this.gamepadBindings);
    if (pad !== null) {
      const padMagnitude = Math.hypot(pad.moveX, pad.moveY);
      if (
        padMagnitude > TUNING.control.gamepadDeadzone &&
        padMagnitude > keyboardMagnitude
      ) {
        moveX = pad.moveX / padMagnitude;
        moveY = pad.moveY / padMagnitude;
      }
      buttons |= pad.buttons;
      buttons |= skillButtonsFromStick(
        pad.skillX,
        pad.skillY,
        TUNING.control.skillStickDeadzone,
      );
    }

    buttons |= this.pendingButtons;
    this.pendingButtons = 0;

    const shooting = (buttons & CONTROL_BUTTONS.SHOOT) !== 0;
    const passing =
      (buttons &
        (CONTROL_BUTTONS.PASS |
          CONTROL_BUTTONS.THROUGH |
          CONTROL_BUTTONS.LOB)) !==
      0;
    const nextKind: ChargeKind = shooting
      ? "shot"
      : passing
        ? "pass"
        : "none";
    if (nextKind === "none") {
      this.chargeStartedAtMs = null;
      this.chargeKind = "none";
      this.charge = 0;
    } else {
      if (this.chargeKind !== nextKind) {
        this.chargeStartedAtMs = nowMs;
        this.chargeKind = nextKind;
      }
      const chargeSeconds =
        nextKind === "shot"
          ? TUNING.control.shotChargeSeconds
          : TUNING.control.passChargeSeconds;
      this.charge = clamp(
        (nowMs - (this.chargeStartedAtMs ?? nowMs)) /
          (chargeSeconds * 1_000),
        0,
        1,
      );
    }

    return {
      moveX,
      moveY,
      buttons,
      chargePower: this.charge,
      chargeKind: this.chargeKind,
    };
  }

  get chargePower(): number {
    return this.charge;
  }

  private isPressed(action: ControlAction): boolean {
    return this.bindings[action].some((code) => this.keys.has(code));
  }

  private isBound(code: string): boolean {
    for (const codes of Object.values(this.bindings)) {
      if (codes.includes(code)) {
        return true;
      }
    }
    return false;
  }

  private buttonForCode(code: string): number {
    if (this.bindings.sprint.includes(code)) return CONTROL_BUTTONS.SPRINT;
    if (this.bindings.pass.includes(code)) return CONTROL_BUTTONS.PASS;
    if (this.bindings.through.includes(code)) return CONTROL_BUTTONS.THROUGH;
    if (this.bindings.lob.includes(code)) return CONTROL_BUTTONS.LOB;
    if (this.bindings.shoot.includes(code)) return CONTROL_BUTTONS.SHOOT;
    if (this.bindings.tackle.includes(code)) return CONTROL_BUTTONS.TACKLE;
    if (this.bindings.switch.includes(code)) return CONTROL_BUTTONS.SWITCH;
    if (this.bindings.finesse.includes(code)) return CONTROL_BUTTONS.FINESSE;
    if (this.bindings.skillUp.includes(code)) return CONTROL_BUTTONS.SKILL_UP;
    if (this.bindings.skillDown.includes(code)) return CONTROL_BUTTONS.SKILL_DOWN;
    if (this.bindings.skillLeft.includes(code)) return CONTROL_BUTTONS.SKILL_LEFT;
    if (this.bindings.skillRight.includes(code)) return CONTROL_BUTTONS.SKILL_RIGHT;
    if (this.bindings.drivenPass.includes(code)) {
      return CONTROL_BUTTONS.DRIVEN_PASS;
    }
    return 0;
  }
}

export function loadKeyBindings(): KeyBindings {
  try {
    const raw = window.localStorage.getItem(BINDINGS_KEY);
    if (raw === null) {
      return DEFAULT_KEY_BINDINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_KEY_BINDINGS;
    }
    const record = parsed as Record<string, unknown>;
    const merged: Record<string, readonly string[]> = {
      ...DEFAULT_KEY_BINDINGS,
    };
    for (const key of Object.keys(DEFAULT_KEY_BINDINGS)) {
      const value = record[key];
      if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string")
      ) {
        merged[key] = value;
      }
    }
    return merged as KeyBindings;
  } catch {
    return DEFAULT_KEY_BINDINGS;
  }
}

export function saveKeyBindings(bindings: KeyBindings): void {
  try {
    window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Storage can be unavailable; bindings then stay session-only.
  }
}

function readGamepad(bindings: GamepadBindings): GamepadSnapshot | null {
  if (typeof navigator.getGamepads !== "function") {
    return null;
  }
  let pad: Gamepad | null = null;
  try {
    pad =
      navigator
        .getGamepads()
        .find((entry) => entry !== null && entry.connected) ?? null;
  } catch {
    return null;
  }
  return gamepadSnapshot(pad, bindings);
}

/** Pure gamepad translation; kept separate from the DOM for tests. */
export function gamepadSnapshot(
  pad: Gamepad | null,
  bindings: GamepadBindings = DEFAULT_GAMEPAD_BINDINGS,
): GamepadSnapshot | null {
  if (pad === null) {
    return null;
  }
  let buttons = 0;
  for (const action of GAMEPAD_ACTIONS) {
    if (
      bindings[action].some(
        (index) => pad.buttons[index]?.pressed === true,
      )
    ) {
      buttons |= GAMEPAD_ACTION_BUTTONS[action];
    }
  }
  return {
    moveX: pad.axes[0] ?? 0,
    moveY: pad.axes[1] ?? 0,
    skillX: pad.axes[2] ?? 0,
    skillY: pad.axes[3] ?? 0,
    buttons,
  };
}

/** Right-stick flick -> one of the four player-relative skill directions. */
export function skillButtonsFromStick(
  x: number,
  y: number,
  deadzone: number,
): number {
  const magnitude = Math.hypot(x, y);
  if (!Number.isFinite(magnitude) || magnitude < deadzone) {
    return 0;
  }
  if (Math.abs(x) >= Math.abs(y)) {
    return x >= 0 ? CONTROL_BUTTONS.SKILL_RIGHT : CONTROL_BUTTONS.SKILL_LEFT;
  }
  return y >= 0 ? CONTROL_BUTTONS.SKILL_DOWN : CONTROL_BUTTONS.SKILL_UP;
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
