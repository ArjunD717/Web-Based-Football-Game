// packages/client/src/camera/shots/broadcast.ts

import { CAMERA_TUNING, type CameraTuning } from "../cameraTuning";
import { SideTrackingShot } from "./sideTracking";

/** Default television-style touchline camera. */
export class BroadcastShot extends SideTrackingShot {
  constructor(tuning: CameraTuning = CAMERA_TUNING) {
    super("broadcast", "Broadcast", tuning.broadcast, tuning.broadcast);
  }
}

export { findControlledPlayer, nearestPlayers } from "./sideTracking";
