// packages/client/src/render/temporal-aa.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { halton, temporalJitter } from "./temporal-aa";

describe("temporal AA jitter", () => {
  it("produces the deterministic Halton sequence", () => {
    expect(halton(0, 2)).toBe(0);
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(halton(3, 2)).toBe(0.75);
    expect(halton(4, 3)).toBeCloseTo(4 / 9);
  });

  it("keeps the target inside the requested subpixel range", () => {
    const target = new THREE.Vector2();
    for (let frame = 0; frame < 16; frame += 1) {
      temporalJitter(frame, 0.5, target);
      expect(target.x).toBeGreaterThanOrEqual(-0.25);
      expect(target.x).toBeLessThanOrEqual(0.25);
      expect(target.y).toBeGreaterThanOrEqual(-0.25);
      expect(target.y).toBeLessThanOrEqual(0.25);
    }
  });

  it("clamps non-finite pixel sizes to zero", () => {
    const target = new THREE.Vector2();
    temporalJitter(5, Number.NaN, target);
    expect(target.x).toBe(0);
    expect(target.y).toBe(0);
  });
});
