// packages/client/src/render/screen-indicators.test.ts

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { projectScreenIndicator } from "./screen-indicators";

function camera(): THREE.PerspectiveCamera {
  const view = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  view.position.set(0, 0, 0);
  view.lookAt(0, 0, -1);
  view.updateMatrixWorld();
  return view;
}

describe("HUD screen indicators", () => {
  it("returns nothing while the point is in frame", () => {
    expect(
      projectScreenIndicator(
        "ball",
        new THREE.Vector3(0, 0, -5),
        camera(),
      ),
    ).toBeNull();
  });

  it("pushes an off-screen right point to the right edge", () => {
    const indicator = projectScreenIndicator(
      "ball",
      new THREE.Vector3(20, 0, -5),
      camera(),
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.x).toBeCloseTo(0.95, 2);
    expect(indicator?.y).toBeCloseTo(0.5, 2);
    expect(indicator?.angle).toBeCloseTo(0, 2);
  });

  it("points left for a point outside the left edge", () => {
    const indicator = projectScreenIndicator(
      "controlled",
      new THREE.Vector3(-20, 0, -5),
      camera(),
    );
    expect(indicator?.x).toBeCloseTo(0.05, 2);
    expect(Math.abs(indicator?.angle ?? 0)).toBeCloseTo(Math.PI, 2);
  });

  it("returns a bottom marker for a point directly behind", () => {
    const indicator = projectScreenIndicator(
      "ball",
      new THREE.Vector3(0, 0, 5),
      camera(),
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.x).toBeCloseTo(0.5, 2);
    expect(indicator?.y).toBeCloseTo(0.95, 2);
  });
});
