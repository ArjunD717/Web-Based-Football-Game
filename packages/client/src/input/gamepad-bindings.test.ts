// packages/client/src/input/gamepad-bindings.test.ts

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAMEPAD_BINDINGS,
  applyGamepadBinding,
  cloneGamepadBindings,
  formatGamepadButton,
  sanitizeGamepadBindings,
} from "./gamepad-bindings";

describe("gamepad bindings", () => {
  it("removes duplicate and out-of-range buttons", () => {
    const dirty = {
      ...cloneGamepadBindings(DEFAULT_GAMEPAD_BINDINGS),
      pass: [0, 0, 99],
      shoot: [0],
      finesse: [-1],
    };
    const clean = sanitizeGamepadBindings(dirty);
    expect(clean.pass).toEqual([0]);
    expect(clean.shoot).not.toContain(0);
    expect(clean.finesse).toEqual([10]);
  });

  it("steals a button from another action without losing the alternative", () => {
    const next = applyGamepadBinding(
      DEFAULT_GAMEPAD_BINDINGS,
      "pass",
      1,
    );
    expect(next.pass).toEqual([1]);
    expect(next.shoot).toEqual([7]);
  });

  it("labels standard buttons and leaves unknown indices readable", () => {
    expect(formatGamepadButton(0)).toBe("A");
    expect(formatGamepadButton(7)).toBe("RT");
    expect(formatGamepadButton(12)).toBe("D-pad ↑");
    expect(formatGamepadButton(20)).toBe("Button 20");
  });
});
