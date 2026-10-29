// packages/sim/src/formations.ts
import { TUNING, clamp } from "@fb/shared";
import type {
  Formation,
  FormationSlot,
  Pitch,
  PlayerRole,
  TeamSide,
} from "./types";

/**
 * M1 placeholder shape. Slot coordinates are normalized: x = 0 at the own goal
 * line, x = 1 at the opponent goal line; y = 0 at one touchline, 1 at the other.
 * Real formation editing arrives in M7.
 */
export const PLAYERS_PER_TEAM = 11;

export const FORMATION_433: Formation = {
  name: "4-3-3",
  slots: [
    { role: "GK", x: 0.04, y: 0.5 },
    { role: "RB", x: 0.22, y: 0.84 },
    { role: "CB", x: 0.18, y: 0.62 },
    { role: "CB", x: 0.18, y: 0.38 },
    { role: "LB", x: 0.22, y: 0.16 },
    { role: "CDM", x: 0.34, y: 0.5 },
    { role: "CM", x: 0.44, y: 0.68 },
    { role: "CM", x: 0.44, y: 0.32 },
    { role: "RW", x: 0.6, y: 0.84 },
    { role: "ST", x: 0.66, y: 0.5 },
    { role: "LW", x: 0.6, y: 0.16 },
  ],
};

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
