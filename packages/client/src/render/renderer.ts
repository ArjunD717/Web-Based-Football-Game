// packages/client/src/render/renderer.ts
import type { MatchView } from "./view";

/**
 * M11 can swap this contract for a Three.js implementation without touching
 * the simulation, netcode or view model.
 */
export interface MatchRenderer {
  resize(): void;
  render(view: MatchView): void;
  destroy(): void;
}
