// packages/client/src/render/renderer.ts
import type { CameraMode } from "../camera/modes";
import type { CameraInputBasis } from "../camera/types";
import type { FootstepSink } from "./footsteps";
import type { VisualQuality } from "./visualTuning";
import type { TemporalAaSupport } from "./temporal-aa-support";
import type { MatchView } from "./view";

/**
 * A HUD arrow for an important world point that left the rendered frame.
 * Coordinates are viewport fractions with the origin at the top-left.
 */
export interface ScreenIndicator {
  readonly id: "ball" | "controlled";
  readonly x: number;
  readonly y: number;
  /** Screen-space angle in radians; zero points right. */
  readonly angle: number;
}

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
  /** Select a 3D quality preset; the 2D renderer ignores this. */
  setQuality?(quality: VisualQuality): void;
  /** Enable or bypass the temporal resolve; the 2D renderer ignores this. */
  setTemporalAa?(enabled: boolean): void;
  /** Report whether this renderer can host temporal AA history buffers. */
  temporalAaCapability?(): TemporalAaSupport;
  /**
   * Suspend context cuts while replaying recorded frames. The 2D renderer
   * ignores this.
   */
  setReplayActive?(active: boolean): void;
  /** Off-screen markers for the ball and controlled player. */
  indicatorStates?(): readonly ScreenIndicator[];
  /** Route presentation contact events to audio. */
  setFootstepSink?(sink: FootstepSink | null): void;
}
