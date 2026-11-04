// packages/client/src/camera/CameraDebugOverlay.ts

import GUI from "lil-gui";
import {
  CAMERA_TUNING,
  CAMERA_TUNING_RANGES,
  type CameraTuningRange,
} from "./cameraTuning";
import type { CameraDirectorFrame } from "./types";

interface DebugStatus {
  shot: string;
  target: string;
  fov: number;
  zoom: number;
  blending: string;
}

const PANEL = {
  widthPx: 340,
  topPx: 194,
  rightPx: 16,
  maxHeightRatio: 0.72,
  zIndex: 40,
} as const;

/**
 * F2 live-tuning panel. It edits CAMERA_TUNING in place, so every change is
 * picked up by the next camera update without rebuilding or restarting.
 */
export class CameraDebugOverlay {
  private readonly gui: GUI;
  private readonly status: DebugStatus = {
    shot: "broadcast",
    target: "—",
    fov: 0,
    zoom: 0,
    blending: "idle",
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "F2" || event.repeat) {
      return;
    }
    event.preventDefault();
    this.toggle();
  };

  constructor() {
    this.gui = new GUI({ title: "Camera · F2" });
    const style = this.gui.domElement.style;
    style.position = "fixed";
    style.top = `${PANEL.topPx}px`;
    style.right = `${PANEL.rightPx}px`;
    style.width = `${PANEL.widthPx}px`;
    style.maxHeight = `${PANEL.maxHeightRatio * 100}vh`;
    style.overflowY = "auto";
    style.zIndex = String(PANEL.zIndex);
    style.display = "none";

    const live = this.gui.addFolder("Live");
    live.add(this.status, "shot").name("Shot").listen().disable();
    live.add(this.status, "target").name("Target").listen().disable();
    live.add(this.status, "fov").name("FOV").listen().disable();
    live.add(this.status, "zoom").name("Zoom").listen().disable();
    live.add(this.status, "blending").name("Blend").listen().disable();

    this.addTuningFolder(
      this.gui,
      CAMERA_TUNING as unknown as Record<string, unknown>,
      "",
    );
    this.gui.open();
    live.open();
    window.addEventListener("keydown", this.onKeyDown);
  }

  update(frame: CameraDirectorFrame): void {
    this.status.shot = frame.shotLabel;
    this.status.target =
      `${frame.target.x.toFixed(1)}, ${frame.target.y.toFixed(1)}, ` +
      `${frame.target.z.toFixed(1)}`;
    this.status.fov = frame.fovDegrees;
    this.status.zoom = frame.zoom;
    this.status.blending = frame.blending ? "blending" : "settled";
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.gui.destroy();
  }

  private toggle(): void {
    const style = this.gui.domElement.style;
    style.display = style.display === "none" ? "block" : "none";
  }

  private addTuningFolder(
    parent: GUI,
    object: Record<string, unknown>,
    path: string,
  ): void {
    for (const [key, value] of Object.entries(object)) {
      const nestedPath = path === "" ? key : `${path}.${key}`;
      if (typeof value === "number") {
        const range = CAMERA_TUNING_RANGES[nestedPath];
        if (range !== undefined) {
          addNumeric(parent, object, key, range, nestedPath);
        }
        continue;
      }
      if (typeof value === "object" && value !== null) {
        const folder = parent.addFolder(nestedPath);
        this.addTuningFolder(
          folder,
          value as Record<string, unknown>,
          nestedPath,
        );
        folder.open();
      }
    }
  }
}

function addNumeric(
  folder: GUI,
  object: Record<string, unknown>,
  key: string,
  range: CameraTuningRange,
  label: string,
): void {
  folder.add(object, key, range.min, range.max, range.step).name(label);
}
