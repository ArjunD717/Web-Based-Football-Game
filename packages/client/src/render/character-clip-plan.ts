// packages/client/src/render/character-clip-plan.ts

import type { PlayerStateName } from "@fb/sim";

export interface AuthoredClipSpec {
  readonly state: PlayerStateName;
  readonly durationSeconds: number;
  /** One-shot clips clamp on their final sample; loops repeat seamlessly. */
  readonly loop: boolean;
  /**
   * Multiplier applied to the procedural phase. Most poses use sin(phase)
   * directly; idle uses sin(phase * 0.75) and celebrate uses half/double
   * frequencies, so those clips need a scaled phase to close the loop.
   */
  readonly phaseScale: number;
}

/**
 * Presentation-only clip plan shared by the build-time baker and the runtime
 * mixer. Durations mirror the state timers used by the simulation but do not
 * drive them.
 */
export const AUTHORED_CLIP_PLAN: readonly AuthoredClipSpec[] = [
  { state: "idle", durationSeconds: 2.4, loop: true, phaseScale: 1 / 0.75 },
  { state: "jog", durationSeconds: 0.86, loop: true, phaseScale: 1 },
  { state: "sprint", durationSeconds: 0.64, loop: true, phaseScale: 1 },
  { state: "dribble", durationSeconds: 0.78, loop: true, phaseScale: 1 },
  { state: "pass", durationSeconds: 0.5, loop: false, phaseScale: 1 },
  { state: "shoot", durationSeconds: 0.7, loop: false, phaseScale: 1 },
  { state: "header", durationSeconds: 0.8, loop: false, phaseScale: 1 },
  { state: "volley", durationSeconds: 0.8, loop: false, phaseScale: 1 },
  { state: "tackle", durationSeconds: 0.8, loop: false, phaseScale: 1 },
  { state: "slide", durationSeconds: 1, loop: false, phaseScale: 1 },
  { state: "fall", durationSeconds: 0.9, loop: false, phaseScale: 1 },
  { state: "injured", durationSeconds: 2, loop: true, phaseScale: 1 },
  { state: "celebrate", durationSeconds: 2.2, loop: true, phaseScale: 4 },
  { state: "diveLeft", durationSeconds: 0.9, loop: false, phaseScale: 1 },
  { state: "diveRight", durationSeconds: 0.9, loop: false, phaseScale: 1 },
];

export function clipSpecFor(
  state: PlayerStateName,
): AuthoredClipSpec | undefined {
  return AUTHORED_CLIP_PLAN.find((spec) => spec.state === state);
}
