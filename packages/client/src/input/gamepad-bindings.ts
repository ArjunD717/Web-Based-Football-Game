// packages/client/src/input/gamepad-bindings.ts

import { CONTROL_BUTTONS } from "@fb/shared";

export const GAMEPAD_ACTIONS = [
  "sprint",
  "pass",
  "through",
  "lob",
  "shoot",
  "tackle",
  "switch",
  "finesse",
  "drivenPass",
] as const;

export type GamepadAction = (typeof GAMEPAD_ACTIONS)[number];
export type GamepadBindings = Readonly<
  Record<GamepadAction, readonly number[]>
>;

/** Standard-mapping indices, with button 7 as an alternative shoot trigger. */
export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  sprint: [6],
  pass: [0],
  through: [3],
  lob: [5],
  shoot: [1, 7],
  tackle: [2],
  switch: [4],
  finesse: [10],
  drivenPass: [11],
};

export const GAMEPAD_ACTION_BUTTONS: Readonly<
  Record<GamepadAction, number>
> = {
  sprint: CONTROL_BUTTONS.SPRINT,
  pass: CONTROL_BUTTONS.PASS,
  through: CONTROL_BUTTONS.THROUGH,
  lob: CONTROL_BUTTONS.LOB,
  shoot: CONTROL_BUTTONS.SHOOT,
  tackle: CONTROL_BUTTONS.TACKLE,
  switch: CONTROL_BUTTONS.SWITCH,
  finesse: CONTROL_BUTTONS.FINESSE,
  drivenPass: CONTROL_BUTTONS.DRIVEN_PASS,
};

const STORAGE_KEY = "fb.gamepad.bindings.v1";
/** Cover standard 18-button pads and a little vendor headroom. */
const MAX_BUTTON_INDEX = 31;

export function cloneGamepadBindings(
  source: GamepadBindings,
): GamepadBindings {
  return Object.fromEntries(
    GAMEPAD_ACTIONS.map((action) => [action, [...source[action]]]),
  ) as unknown as GamepadBindings;
}

/** Remove duplicate/out-of-range buttons and keep every action bindable. */
export function sanitizeGamepadBindings(
  source: GamepadBindings,
): GamepadBindings {
  const used = new Set<number>();
  const next = {} as Record<GamepadAction, readonly number[]>;
  for (const action of GAMEPAD_ACTIONS) {
    const buttons: number[] = [];
    for (const button of source[action]) {
      if (
        Number.isInteger(button) &&
        button >= 0 &&
        button <= MAX_BUTTON_INDEX &&
        !used.has(button) &&
        !buttons.includes(button)
      ) {
        buttons.push(button);
        used.add(button);
      }
    }
    const fallback = pickFallback(action, used);
    if (buttons.length === 0 && fallback !== null) {
      buttons.push(fallback);
      used.add(fallback);
    }
    next[action] = buttons;
  }
  return next as GamepadBindings;
}

/** Assign one captured button while keeping every other action bindable. */
export function applyGamepadBinding(
  source: GamepadBindings,
  action: GamepadAction,
  button: number,
): GamepadBindings {
  if (!Number.isInteger(button) || button < 0 || button > MAX_BUTTON_INDEX) {
    return cloneGamepadBindings(source);
  }
  const next = cloneGamepadBindings(source) as Record<
    GamepadAction,
    readonly number[]
  >;
  for (const other of GAMEPAD_ACTIONS) {
    if (other !== action) {
      next[other] = next[other].filter((bound) => bound !== button);
    }
  }

  const used = new Set<number>([button]);
  for (const other of GAMEPAD_ACTIONS) {
    if (other !== action) {
      for (const bound of next[other]) {
        used.add(bound);
      }
    }
  }
  for (const other of GAMEPAD_ACTIONS) {
    if (other === action || next[other].length > 0) {
      continue;
    }
    const fallback = pickFallback(other, used, button);
    if (fallback !== null) {
      next[other] = [fallback];
      used.add(fallback);
    }
  }
  next[action] = [button];
  return next as GamepadBindings;
}

export function loadGamepadBindings(): GamepadBindings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_GAMEPAD_BINDINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_GAMEPAD_BINDINGS;
    }
    const record = parsed as Record<string, unknown>;
    const merged: Record<GamepadAction, readonly number[]> = {
      ...DEFAULT_GAMEPAD_BINDINGS,
    };
    for (const action of GAMEPAD_ACTIONS) {
      const value = record[action];
      if (
        Array.isArray(value) &&
        value.every(
          (entry) => typeof entry === "number" && Number.isInteger(entry),
        )
      ) {
        merged[action] = value;
      }
    }
    return sanitizeGamepadBindings(merged);
  } catch {
    return DEFAULT_GAMEPAD_BINDINGS;
  }
}

export function saveGamepadBindings(bindings: GamepadBindings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage can be unavailable; bindings then stay session-only.
  }
}

export function formatGamepadButton(button: number): string {
  switch (button) {
    case 0:
      return "A";
    case 1:
      return "B";
    case 2:
      return "X";
    case 3:
      return "Y";
    case 4:
      return "LB";
    case 5:
      return "RB";
    case 6:
      return "LT";
    case 7:
      return "RT";
    case 8:
      return "View";
    case 9:
      return "Menu";
    case 10:
      return "L3";
    case 11:
      return "R3";
    case 12:
      return "D-pad ↑";
    case 13:
      return "D-pad ↓";
    case 14:
      return "D-pad ←";
    case 15:
      return "D-pad →";
    default:
      return `Button ${button}`;
  }
}

function pickFallback(
  action: GamepadAction,
  used: ReadonlySet<number>,
  excluded?: number,
): number | null {
  for (const button of DEFAULT_GAMEPAD_BINDINGS[action]) {
    if (button !== excluded && !used.has(button)) {
      return button;
    }
  }
  return null;
}
