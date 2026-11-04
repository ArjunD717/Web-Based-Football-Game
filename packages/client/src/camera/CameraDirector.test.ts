// packages/client/src/camera/CameraDirector.test.ts

import { describe, expect, it } from "vitest";
import { CameraDirector } from "./CameraDirector";
import type {
  CameraPose,
  CameraRenderState,
  CameraShot,
  CameraShotDebug,
} from "./types";

class StubShot implements CameraShot {
  readonly blendSeconds = 0.5;
  private entered = 0;
  private exited = 0;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly x: number,
  ) {}

  enter(): void {
    this.entered += 1;
  }

  update(): CameraPose {
    return {
      position: { x: this.x, y: 10, z: 20 },
      target: { x: this.x, y: 0, z: 0 },
      fovDegrees: 40,
    };
  }

  exit(): void {
    this.exited += 1;
  }

  debug(): CameraShotDebug {
    return { zoom: 0.5 };
  }

  get enterCount(): number {
    return this.entered;
  }

  get exitCount(): number {
    return this.exited;
  }
}

const state = {} as CameraRenderState;

describe("CameraDirector", () => {
  it("pushes and pops shots while preserving the base", () => {
    const director = new CameraDirector();
    const base = new StubShot("base", "Base", 0);
    const context = new StubShot("context", "Context", 20);
    director.setBase(base, state);
    expect(director.depth).toBe(1);
    expect(director.update(0, state)?.pose.position.x).toBe(0);

    director.push(context, state);
    expect(director.depth).toBe(2);
    expect(base.exitCount).toBe(1);
    const halfway = director.update(0.1, state);
    expect(halfway?.pose.position.x).toBeGreaterThan(0);
    expect(halfway?.pose.position.x).toBeLessThan(20);
    for (let frame = 0; frame < 10; frame += 1) {
      director.update(0.1, state);
    }
    expect(director.update(0, state)?.pose.position.x).toBe(20);

    director.pop(state);
    expect(director.depth).toBe(1);
    expect(context.exitCount).toBe(1);
    expect(base.enterCount).toBe(2);
    for (let frame = 0; frame < 10; frame += 1) {
      director.update(0.1, state);
    }
    expect(director.update(0, state)?.pose.position.x).toBe(0);
  });

  it("reports the active shot, target, FOV and zoom", () => {
    const director = new CameraDirector();
    director.setBase(new StubShot("broadcast", "Broadcast", 4), state);
    const frame = director.update(0, state);
    expect(frame).not.toBeNull();
    expect(frame?.shotId).toBe("broadcast");
    expect(frame?.shotLabel).toBe("Broadcast");
    expect(frame?.target.x).toBe(4);
    expect(frame?.fovDegrees).toBe(40);
    expect(frame?.zoom).toBe(0.5);
  });
});
