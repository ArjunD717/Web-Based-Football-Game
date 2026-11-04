// packages/client/src/input/haptics.ts

import type { PlayerStateName, SnapshotFrame } from "@fb/shared";

const STORAGE_KEY = "fb.haptics";
const MIN_INTERVAL_MS = 70;

export type HapticCue =
  | "goal"
  | "card"
  | "whistle"
  | "shot"
  | "tackle"
  | "pass"
  | "preview";

interface HapticPattern {
  readonly durationMs: number;
  readonly weakMagnitude: number;
  readonly strongMagnitude: number;
}

/**
 * Chromium's dual-rumble actuators expose two independent motors. The numbers
 * are deliberately short and restrained: goals and cards are the only cues
 * that should be unmistakable over a 90-minute match.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticCue, HapticPattern>> = {
  goal: { durationMs: 650, weakMagnitude: 0.8, strongMagnitude: 1 },
  card: { durationMs: 380, weakMagnitude: 0.25, strongMagnitude: 1 },
  whistle: { durationMs: 180, weakMagnitude: 0.15, strongMagnitude: 0.6 },
  shot: { durationMs: 120, weakMagnitude: 0.2, strongMagnitude: 0.75 },
  tackle: { durationMs: 180, weakMagnitude: 0.3, strongMagnitude: 0.85 },
  pass: { durationMs: 70, weakMagnitude: 0.1, strongMagnitude: 0.35 },
  preview: { durationMs: 120, weakMagnitude: 0.3, strongMagnitude: 0.5 },
};

export interface HapticTransitionState {
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly eventSeq: number;
  readonly eventType: string | null;
  readonly controlledState: PlayerStateName | null;
}

export interface HapticTransition {
  readonly cue: HapticCue | null;
  readonly state: HapticTransitionState;
}

/** Converts authoritative match state into at most one cue per snapshot. */
export function transitionHaptics(
  previous: HapticTransitionState | null,
  next: HapticTransitionState,
): HapticTransition {
  if (previous === null) {
    return { cue: null, state: next };
  }

  let cue: HapticCue | null = null;
  if (
    next.scoreHome > previous.scoreHome ||
    next.scoreAway > previous.scoreAway
  ) {
    cue = "goal";
  } else if (next.eventSeq !== previous.eventSeq) {
    cue = cueForEvent(next.eventType);
  } else if (next.controlledState !== previous.controlledState) {
    cue = cueForPlayerState(next.controlledState);
  }
  return { cue, state: next };
}

export function hapticStateFromSnapshot(
  frame: SnapshotFrame,
  selfSide: "home" | "away" | null,
): HapticTransitionState {
  const controlledIndex =
    selfSide === null
      ? -1
      : selfSide === "home"
        ? frame.controlledHome
        : frame.controlledAway;
  // Snapshot control indices are global: home 0-10, away 11-21.
  return {
    scoreHome: frame.match.scoreHome,
    scoreAway: frame.match.scoreAway,
    eventSeq: frame.match.lastEvent?.seq ?? 0,
    eventType: frame.match.lastEvent?.type ?? null,
    controlledState:
      controlledIndex < 0
        ? null
        : (frame.players[controlledIndex]?.state ?? null),
  };
}

interface RumbleActuator {
  playEffect(
    type: "dual-rumble",
    parameters: {
      readonly duration: number;
      readonly weakMagnitude: number;
      readonly strongMagnitude: number;
    },
  ): Promise<unknown>;
}

type RumbleGamepad = Gamepad & { readonly vibrationActuator?: RumbleActuator };

/**
 * Best-effort controller rumble. Every call is optional: browsers without a
 * vibration actuator, disconnected pads and rejected permission requests are
 * silently ignored so input and rendering never depend on haptics.
 */
export class MatchHaptics {
  private enabled: boolean;
  private previous: HapticTransitionState | null = null;
  private lastPlayedAtMs = Number.NEGATIVE_INFINITY;

  constructor() {
    this.enabled = readEnabled();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isSupported(): boolean {
    return findActuator() !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    writeEnabled(enabled);
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  reset(): void {
    this.previous = null;
  }

  handleSnapshot(
    frame: SnapshotFrame,
    selfSide: "home" | "away" | null,
  ): void {
    const next = hapticStateFromSnapshot(frame, selfSide);
    const transition = transitionHaptics(this.previous, next);
    this.previous = transition.state;
    if (this.enabled && transition.cue !== null) {
      this.play(transition.cue);
    }
  }

  preview(): void {
    if (this.enabled) {
      this.play("preview");
    }
  }

  private play(cue: HapticCue): void {
    const now = performance.now();
    if (cue !== "goal" && now - this.lastPlayedAtMs < MIN_INTERVAL_MS) {
      return;
    }
    const actuator = findActuator();
    if (actuator === null) {
      return;
    }
    this.lastPlayedAtMs = now;
    const pattern = HAPTIC_PATTERNS[cue];
    void actuator
      .playEffect("dual-rumble", {
        duration: pattern.durationMs,
        weakMagnitude: pattern.weakMagnitude,
        strongMagnitude: pattern.strongMagnitude,
      })
      .catch(() => {
        // Haptics are optional; the game continues if the browser refuses.
      });
  }
}

function cueForEvent(type: string | null): HapticCue | null {
  switch (type) {
    case "yellowCard":
    case "redCard":
      return "card";
    case "foul":
    case "offside":
    case "handball":
    case "penalty":
    case "varReview":
    case "forfeit":
      return "whistle";
    case "shootoutGoal":
      return "goal";
    default:
      return null;
  }
}

function cueForPlayerState(state: PlayerStateName | null): HapticCue | null {
  switch (state) {
    case "shoot":
    case "header":
    case "volley":
      return "shot";
    case "tackle":
    case "slide":
      return "tackle";
    case "pass":
      return "pass";
    default:
      return null;
  }
}

function findActuator(): RumbleActuator | null {
  if (typeof navigator === "undefined" || navigator.getGamepads === undefined) {
    return null;
  }
  try {
    for (const pad of navigator.getGamepads()) {
      if (pad !== null && pad.vibrationActuator !== undefined) {
        return (pad as RumbleGamepad).vibrationActuator ?? null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Rumble remains usable for this session.
  }
}
