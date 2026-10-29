// packages/client/src/input/desktop-controls.test.ts
import { describe, expect, it } from "vitest";
import { CONTROL_BUTTONS } from "@fb/shared";
import { gamepadSnapshot } from "./desktop-controls";

function pad(options: {
  readonly axes?: readonly [number, number];
  readonly pressed?: readonly number[];
}): Gamepad {
  const pressed = new Set(options.pressed ?? []);
  const buttons = Array.from({ length: 18 }, (_, index) => ({
    pressed: pressed.has(index),
    touched: pressed.has(index),
    value: pressed.has(index) ? 1 : 0,
  }));
  return {
    axes: options.axes ?? [0, 0],
    buttons,
    connected: true,
    id: "test-pad",
    index: 0,
    mapping: "standard",
    timestamp: 0,
  } as unknown as Gamepad;
}

describe("gamepadSnapshot", () => {
  it("returns null when no pad is connected", () => {
    expect(gamepadSnapshot(null)).toBeNull();
  });

  it("passes through stick axes", () => {
    expect(gamepadSnapshot(pad({ axes: [0.7, -0.2] }))).toEqual({
      moveX: 0.7,
      moveY: -0.2,
      buttons: 0,
    });
  });

  it("maps face buttons to their actions", () => {
    const cases = [
      [0, CONTROL_BUTTONS.PASS],
      [1, CONTROL_BUTTONS.SHOOT],
      [2, CONTROL_BUTTONS.TACKLE],
      [3, CONTROL_BUTTONS.THROUGH],
      [4, CONTROL_BUTTONS.SWITCH],
      [5, CONTROL_BUTTONS.LOB],
    ] as const;
    for (const [button, expected] of cases) {
      expect(gamepadSnapshot(pad({ pressed: [button] }))?.buttons).toBe(
        expected,
      );
    }
  });

  it("treats right trigger as shoot and left trigger as sprint", () => {
    const snapshot = gamepadSnapshot(pad({ pressed: [6, 7] }));
    expect(snapshot?.buttons).toBe(CONTROL_BUTTONS.SPRINT | CONTROL_BUTTONS.SHOOT);
  });

  it("maps the left-stick click to finesse", () => {
    expect(gamepadSnapshot(pad({ pressed: [10] }))?.buttons).toBe(
      CONTROL_BUTTONS.FINESSE,
    );
  });

  it("combines independent inputs", () => {
    const snapshot = gamepadSnapshot(
      pad({ axes: [0.2, 0.4], pressed: [0, 7, 6, 10] }),
    );
    expect(snapshot).toEqual({
      moveX: 0.2,
      moveY: 0.4,
      buttons:
        CONTROL_BUTTONS.PASS |
        CONTROL_BUTTONS.SHOOT |
        CONTROL_BUTTONS.SPRINT |
        CONTROL_BUTTONS.FINESSE,
    });
  });
});
