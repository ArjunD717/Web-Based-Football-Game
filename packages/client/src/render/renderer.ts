// packages/client/src/render/renderer.ts
import type { CameraMode } from "../camera/modes";
import type { CameraInputBasis } from "../camera/types";
import type { FootstepSink } from "./footsteps";
import type { VisualQuality } from "./visualTuning";
import type { TemporalAaSupport } from "./temporal-aa-support";

export type TemporalAaAutoState =
  | "active"
  | "disabled"
  | "retried"
  | "exhausted";

export interface TemporalAaDiagnostics {
  readonly supported: boolean;
  readonly reason: string;
  readonly active: boolean;
  readonly autoState: TemporalAaAutoState;
  readonly historyResets: number;
  readonly timelineResets: number;
  readonly autoRetries: number;
}
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
 * Presentation contract for the 3D match renderer. The simulation, netcode and
 * view model never depend on Three.js.
 */
export interface MatchRenderer {
  resize(): void;
  render(view: MatchView): void;
  destroy(): void;
  /** Select a gameplay camera. */
  setCameraMode?(mode: CameraMode): void;
  /** Screen-relative pitch basis for converting local stick input. */
  inputBasis?(): CameraInputBasis | null;
  /** Select a 3D quality preset. */
  setQuality?(quality: VisualQuality): void;
  /** Enable or bypass the temporal resolve. */
  setTemporalAa?(enabled: boolean): void;
  /** Report whether this renderer can host temporal AA history buffers. */
  temporalAaCapability?(): TemporalAaSupport;
  /** Snapshot for the visible diagnostics readout and replay acceptance. */
  temporalAaDiagnostics?(): TemporalAaDiagnostics;
  /** Receives automatic TAA disable, retry and exhaustion transitions. */
  setTemporalAaAutoStateHandler?(
    handler: ((state: TemporalAaAutoState) => void) | null,
  ): void;
  /** Disable automatic TAA opt-out for benchmark instrumentation. */
  setAutoTemporalAaDowngrade?(enabled: boolean): void;
  /** Suspend context cuts while replaying recorded frames. */
  setReplayActive?(active: boolean): void;
  /** Off-screen markers for the ball and controlled player. */
  indicatorStates?(): readonly ScreenIndicator[];
  /** Route presentation contact events to audio. */
  setFootstepSink?(sink: FootstepSink | null): void;
}
