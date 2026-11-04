// packages/client/src/render/renderer.ts
import type { CameraMode } from "../camera/modes";
import type { CameraInputBasis } from "../camera/types";
import type { MatchView } from "./view";

/**
 * M11 can swap this contract for a Three.js implementation without touching
 * the simulation, netcode or view model.
 */
export interface MatchRenderer {
  resize(): void;
  render(view: MatchView): void;
  destroy(): void;
  /** Select a gameplay camera; the 2D renderer ignores this. */
  setCameraMode?(mode: CameraMode): void;
  /** Screen-relative pitch basis for converting local stick input. */
  inputBasis?(): CameraInputBasis | null;
}
