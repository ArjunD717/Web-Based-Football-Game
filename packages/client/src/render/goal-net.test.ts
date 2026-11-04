// packages/client/src/render/goal-net.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GoalNetEffect } from "./three-pitch";

function maximumDisplacement(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute("position");
  let maximum = 0;
  for (let index = 2; index < position.array.length; index += 3) {
    maximum = Math.max(maximum, Math.abs(position.array[index] ?? 0));
  }
  return maximum;
}

describe("goal net ripple", () => {
  it("displaces the net during the goal moment and restores it afterwards", () => {
    const net = new GoalNetEffect("away");
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(7.32, 2.44, 8, 6),
      new THREE.MeshBasicMaterial(),
    );
    net.addPlane(mesh, 7.32, 2.44, 1);

    net.trigger();
    net.update(0.06);
    expect(maximumDisplacement(mesh)).toBeGreaterThan(0.02);

    net.reset();
    expect(maximumDisplacement(mesh)).toBe(0);
  });
});
