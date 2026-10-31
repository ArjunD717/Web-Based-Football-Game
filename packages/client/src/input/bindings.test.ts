// packages/client/src/input/bindings.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  type ControlAction,
  type KeyBindings,
} from "./desktop-controls";
import { applyBinding, sanitizeBindings } from "./bindings";

function boundCodes(bindings: KeyBindings): string[] {
  return Object.values(bindings).flatMap((codes) => [...codes]);
}

describe("key binding safety", () => {
  it("steals a key from another action without creating a duplicate", () => {
    const next = applyBinding(DEFAULT_KEY_BINDINGS, "pass", "KeyW");
    expect(next.pass).toEqual(["KeyW"]);
    expect(next.up).not.toContain("KeyW");
    expect(new Set(boundCodes(next)).size).toBe(boundCodes(next).length);
    for (const action of Object.keys(next) as ControlAction[]) {
      expect(next[action].length).toBeGreaterThan(0);
    }
  });

  it("restores a fallback when the stolen key was an action's only binding", () => {
    const source: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      tackle: ["KeyW"],
    };
    const next = applyBinding(source, "pass", "KeyW");
    expect(next.tackle.length).toBeGreaterThan(0);
    expect(next.tackle).not.toContain("KeyW");
    expect(new Set(boundCodes(next)).size).toBe(boundCodes(next).length);
  });

  it("repairs duplicate stored bindings", () => {
    const source: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      sprint: ["KeyW"],
    };
    const next = sanitizeBindings(source);
    expect(next.sprint).not.toContain("KeyW");
    expect(new Set(boundCodes(next)).size).toBe(boundCodes(next).length);
  });
});
