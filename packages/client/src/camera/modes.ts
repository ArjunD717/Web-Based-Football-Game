// packages/client/src/camera/modes.ts

import { CAMERA_TUNING, type CameraTuning } from "./cameraTuning";
import type { CameraShot } from "./types";
import { BroadcastShot } from "./shots/broadcast";
import { EndToEndShot } from "./shots/endToEnd";
import { PlayerShot } from "./shots/player";
import { SideTrackingShot } from "./shots/sideTracking";

export type CameraMode =
  | "broadcast"
  | "tele"
  | "wide"
  | "endToEnd"
  | "player"
  | "drone";

export interface CameraModeOption {
  readonly id: CameraMode;
  readonly label: string;
  readonly description: string;
}

export const DEFAULT_CAMERA_MODE: CameraMode = "broadcast";
export const CAMERA_STORAGE_KEY = "fb.cameraMode";

/** Selectable gameplay cameras shown in the match settings picker. */
export const CAMERA_MODES: readonly CameraModeOption[] = [
  {
    id: "broadcast",
    label: "Broadcast",
    description: "Television touchline view",
  },
  {
    id: "tele",
    label: "Tele",
    description: "Lower, tighter touchline view",
  },
  {
    id: "wide",
    label: "Wide",
    description: "Higher view with more of the pitch",
  },
  {
    id: "endToEnd",
    label: "End to end",
    description: "Behind the goal, looking down the pitch",
  },
  {
    id: "player",
    label: "Player",
    description: "Close chase camera behind your player",
  },
  {
    id: "drone",
    label: "Drone",
    description: "High tactical view",
  },
];

export function isCameraMode(value: unknown): value is CameraMode {
  return (
    typeof value === "string" &&
    CAMERA_MODES.some((option) => option.id === value)
  );
}

export function parseCameraMode(value: unknown): CameraMode {
  return isCameraMode(value) ? value : DEFAULT_CAMERA_MODE;
}

export function loadCameraMode(): CameraMode {
  try {
    return parseCameraMode(window.localStorage.getItem(CAMERA_STORAGE_KEY));
  } catch {
    return DEFAULT_CAMERA_MODE;
  }
}

export function saveCameraMode(mode: CameraMode): void {
  try {
    window.localStorage.setItem(CAMERA_STORAGE_KEY, mode);
  } catch {
    // The current session still uses the selected camera.
  }
}

export function createCameraShot(
  mode: CameraMode,
  tuning: CameraTuning = CAMERA_TUNING,
): CameraShot {
  switch (mode) {
    case "broadcast":
      return new BroadcastShot(tuning);
    case "tele":
      return new SideTrackingShot(
        "tele",
        "Tele",
        tuning.tele,
        tuning.broadcast,
      );
    case "wide":
      return new SideTrackingShot(
        "wide",
        "Wide",
        tuning.wide,
        tuning.broadcast,
      );
    case "drone":
      return new SideTrackingShot(
        "drone",
        "Drone",
        tuning.drone,
        tuning.broadcast,
      );
    case "endToEnd":
      return new EndToEndShot(tuning);
    case "player":
      return new PlayerShot(tuning);
  }
}
