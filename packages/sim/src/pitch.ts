// packages/sim/src/pitch.ts
import { TUNING } from "@fb/shared";
import type {
  GoalGeometry,
  Pitch,
  PitchConfig,
  TeamSide,
} from "./types";

export const DEFAULT_PITCH_CONFIG: PitchConfig = {
  lengthM: TUNING.pitch.lengthM,
  widthM: TUNING.pitch.widthM,
  goalWidthM: TUNING.pitch.goalWidthM,
  goalHeightM: TUNING.pitch.goalHeightM,
  goalPostRadiusM: TUNING.pitch.goalPostRadiusM,
  goalNetDepthM: TUNING.pitch.goalNetDepthM,
  penaltyAreaLengthM: TUNING.pitch.penaltyAreaLengthM,
  penaltyAreaWidthM: TUNING.pitch.penaltyAreaWidthM,
  goalAreaLengthM: TUNING.pitch.goalAreaLengthM,
  goalAreaWidthM: TUNING.pitch.goalAreaWidthM,
  penaltySpotDistanceM: TUNING.pitch.penaltySpotDistanceM,
  penaltyArcRadiusM: TUNING.pitch.penaltyArcRadiusM,
  cornerArcRadiusM: TUNING.pitch.cornerArcRadiusM,
};

/**
 * Build pitch geometry. Boundaries are stored in metres; the renderer is the
 * only layer that converts them to pixels.
 */
export function createPitch(overrides: Partial<PitchConfig> = {}): Pitch {
  const config: PitchConfig = { ...DEFAULT_PITCH_CONFIG, ...overrides };
  validatePitchConfig(config);

  const centreX = config.lengthM / 2;
  const centreY = config.widthM / 2;

  const goalBase = {
    centreY,
    widthM: config.goalWidthM,
    heightM: config.goalHeightM,
    postRadiusM: config.goalPostRadiusM,
    netDepthM: config.goalNetDepthM,
  };

  const homeGoal: GoalGeometry = {
    ...goalBase,
    lineX: 0,
    netDirection: -1,
  };
  const awayGoal: GoalGeometry = {
    ...goalBase,
    lineX: config.lengthM,
    netDirection: 1,
  };

  return {
    ...config,
    centreX,
    centreY,
    homeGoal,
    awayGoal,
  };
}

export function validatePitchConfig(config: PitchConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`pitch.${key} must be a positive finite number`);
    }
  }
  if (config.goalWidthM >= config.widthM) {
    throw new RangeError("goalWidthM must be smaller than widthM");
  }
  if (config.goalHeightM <= 0) {
    throw new RangeError("goalHeightM must be positive");
  }
  if (config.penaltyAreaWidthM >= config.widthM) {
    throw new RangeError("penaltyAreaWidthM must be smaller than widthM");
  }
  if (config.goalAreaWidthM >= config.widthM) {
    throw new RangeError("goalAreaWidthM must be smaller than widthM");
  }
  if (config.penaltyAreaLengthM >= config.lengthM / 2) {
    throw new RangeError("penaltyAreaLengthM must fit inside one half");
  }
  if (config.goalAreaLengthM >= config.penaltyAreaLengthM) {
    throw new RangeError("goalAreaLengthM must be inside the penalty area");
  }
  if (config.penaltySpotDistanceM >= config.penaltyAreaLengthM) {
    throw new RangeError("penaltySpotDistanceM must be inside the penalty area");
  }
}

export function getAttackingGoal(pitch: Pitch, side: TeamSide): GoalGeometry {
  return side === "home" ? pitch.awayGoal : pitch.homeGoal;
}

export function getDefendingGoal(pitch: Pitch, side: TeamSide): GoalGeometry {
  return side === "home" ? pitch.homeGoal : pitch.awayGoal;
}

/** The goal a team attacks after accounting for the half-time ends swap. */
export function getAttackingGoalForDirection(
  pitch: Pitch,
  direction: 1 | -1,
): GoalGeometry {
  return direction === 1 ? pitch.awayGoal : pitch.homeGoal;
}

/** The goal a team defends after accounting for the half-time ends swap. */
export function getDefendingGoalForDirection(
  pitch: Pitch,
  direction: 1 | -1,
): GoalGeometry {
  return direction === 1 ? pitch.homeGoal : pitch.awayGoal;
}

export function defendingSideForDirection(direction: 1 | -1): TeamSide {
  return direction === 1 ? "home" : "away";
}

export function isInsidePitch(
  pitch: Pitch,
  x: number,
  y: number,
  marginM = 0,
): boolean {
  return (
    x >= -marginM &&
    x <= pitch.lengthM + marginM &&
    y >= -marginM &&
    y <= pitch.widthM + marginM
  );
}

/** Penalty area in front of the goal specified by `defendingSide`. */
export function isInsidePenaltyArea(
  pitch: Pitch,
  defendingSide: TeamSide,
  x: number,
  y: number,
): boolean {
  const halfWidth = pitch.penaltyAreaWidthM / 2;
  const insideWidth = Math.abs(y - pitch.centreY) <= halfWidth;
  if (!insideWidth) {
    return false;
  }
  return defendingSide === "home"
    ? x >= 0 && x <= pitch.penaltyAreaLengthM
    : x <= pitch.lengthM && x >= pitch.lengthM - pitch.penaltyAreaLengthM;
}

/** Goal area in front of the goal specified by `defendingSide`. */
export function isInsideGoalArea(
  pitch: Pitch,
  defendingSide: TeamSide,
  x: number,
  y: number,
): boolean {
  const halfWidth = pitch.goalAreaWidthM / 2;
  const insideWidth = Math.abs(y - pitch.centreY) <= halfWidth;
  if (!insideWidth) {
    return false;
  }
  return defendingSide === "home"
    ? x >= 0 && x <= pitch.goalAreaLengthM
    : x <= pitch.lengthM && x >= pitch.lengthM - pitch.goalAreaLengthM;
}

/** Whether a point is inside the penalty area the team attacks toward. */
export function isInsideOpponentPenaltyArea(
  pitch: Pitch,
  attackDirection: 1 | -1,
  x: number,
  y: number,
): boolean {
  return isInsidePenaltyArea(
    pitch,
    attackDirection === 1 ? "away" : "home",
    x,
    y,
  );
}

/** Whether a point is inside the penalty area the team defends. */
export function isInsideOwnPenaltyArea(
  pitch: Pitch,
  attackDirection: 1 | -1,
  x: number,
  y: number,
): boolean {
  return isInsidePenaltyArea(
    pitch,
    defendingSideForDirection(attackDirection),
    x,
    y,
  );
}
