// packages/sim/src/formations.ts
import {
  FORMATION_DEFINITIONS,
  TUNING,
  clamp,
  formationDefinition,
  type FormationName,
  type PlayerPosition,
} from "@fb/shared";
import type {
  Formation,
  FormationSlot,
  Pitch,
  PlayerRole,
  TeamSide,
} from "./types";

/**
 * Shared normalized geometry: x = 0 at the own goal line, x = 1 at the opponent
 * goal line; y = 0 at one touchline, 1 at the other. The client editor, data
 * pipeline and simulation all consume the same slot order.
 */
export const PLAYERS_PER_TEAM = 11;

function toSimRole(role: PlayerPosition): PlayerRole {
  switch (role) {
    case "RWB":
      return "RB";
    case "LWB":
      return "LB";
    default:
      if (role === "GK" || role === "RB" || role === "CB" || role === "LB" ||
        role === "CDM" || role === "CM" || role === "CAM" || role === "RM" ||
        role === "LM" || role === "RW" || role === "LW" || role === "CF" ||
        role === "ST") {
        return role;
      }
      throw new Error(`unsupported formation role "${String(role)}"`);
  }
}

function toSimFormation(name: FormationName): Formation {
  const definition = formationDefinition(name);
  return {
    name,
    slots: definition.slots.map((slot) => ({
      role: toSimRole(slot.role),
      x: slot.x,
      y: slot.y,
    })),
  };
}

/** Every shared formation, converted to the simulation's role vocabulary. */
export const FORMATIONS: Readonly<Record<FormationName, Formation>> =
  Object.fromEntries(
    Object.keys(FORMATION_DEFINITIONS).map((name) => [
      name,
      toSimFormation(name as FormationName),
    ]),
  ) as Readonly<Record<FormationName, Formation>>;

export const FORMATION_433: Formation = FORMATIONS["4-3-3"];

export function formationForName(name: FormationName): Formation {
  const formation = FORMATIONS[name];
  if (formation === undefined) {
    throw new RangeError(`Unknown formation "${name}"`);
  }
  return formation;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function baseFormationPosition(
  pitch: Pitch,
  side: TeamSide,
  slot: FormationSlot,
  attackDirection: 1 | -1 = side === "home" ? 1 : -1,
): Point {
  return baseFormationPositionNormalized(
    pitch,
    side,
    slot.x,
    slot.y,
    attackDirection,
  );
}

export function baseFormationPositionNormalized(
  pitch: Pitch,
  side: TeamSide,
  normalizedX: number,
  normalizedY: number,
  attackDirection: 1 | -1 = side === "home" ? 1 : -1,
): Point {
  return {
    x:
      attackDirection === 1
        ? normalizedX * pitch.lengthM
        : (1 - normalizedX) * pitch.lengthM,
    y: normalizedY * pitch.widthM,
  };
}

/**
 * Formation anchor after sliding the block toward the ball. Both teams shift in
 * the same world direction so the shape stays compact around the ball.
 */
export function shapeAnchor(
  pitch: Pitch,
  side: TeamSide,
  slot: FormationSlot,
  ballX: number,
  ballY: number,
  attackDirection: 1 | -1 = side === "home" ? 1 : -1,
): Point {
  return shapeAnchorNormalized(
    pitch,
    side,
    slot.role,
    slot.x,
    slot.y,
    ballX,
    ballY,
    attackDirection,
  );
}

/** Allocation-free variant used by the per-tick AI for every player. */
export function shapeAnchorNormalized(
  pitch: Pitch,
  side: TeamSide,
  role: PlayerRole,
  normalizedX: number,
  normalizedY: number,
  ballX: number,
  ballY: number,
  attackDirection: 1 | -1 = side === "home" ? 1 : -1,
): Point {
  const base = baseFormationPositionNormalized(
    pitch,
    side,
    normalizedX,
    normalizedY,
    attackDirection,
  );
  if (role === "GK") {
    return base;
  }

  const margin = TUNING.ai.anchorGoalMarginM;
  const shiftX =
    (ballX - pitch.centreX) * TUNING.ai.shapeShiftXFactor;
  const shiftY =
    (ballY - pitch.centreY) * TUNING.ai.shapeShiftYFactor;

  return {
    x: clamp(base.x + shiftX, margin, pitch.lengthM - margin),
    y: clamp(base.y + shiftY, margin, pitch.widthM - margin),
  };
}

export function validateFormation(formation: Formation): void {
  if (formation.slots.length !== PLAYERS_PER_TEAM) {
    throw new RangeError(
      `${formation.name} must contain exactly ${PLAYERS_PER_TEAM} slots (received ${formation.slots.length})`,
    );
  }

  let keepers = 0;
  for (const slot of formation.slots) {
    if (slot.role === "GK") {
      keepers += 1;
    }
    if (
      !Number.isFinite(slot.x) ||
      !Number.isFinite(slot.y) ||
      slot.x < 0 ||
      slot.x > 1 ||
      slot.y < 0 ||
      slot.y > 1
    ) {
      throw new RangeError(
        `${formation.name} slot coordinates must be normalized to [0, 1]`,
      );
    }
  }

  if (keepers !== 1) {
    throw new RangeError(
      `${formation.name} must contain exactly one goalkeeper slot`,
    );
  }
}
