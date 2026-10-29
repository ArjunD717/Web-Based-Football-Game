// packages/shared/src/domain/formations.ts

import type { FormationName, PlayerPosition } from "./football-data";
import { FORMATION_NAMES } from "./football-data";

/**
 * Normalized formation geometry shared by the data pipeline, simulation and
 * draft editor: x = 0 at the own goal line, x = 1 at the opponent goal line,
 * y = 0 at one touchline, y = 1 at the other. Slot order is also the canonical
 * starting-XI order used by generated team sheets.
 */
export interface FormationSlotDefinition {
  readonly role: PlayerPosition;
  readonly x: number;
  readonly y: number;
}

export interface FormationDefinition {
  readonly name: FormationName;
  readonly slots: readonly FormationSlotDefinition[];
}

const DEFENCE_FOUR = [
  { role: "RB", x: 0.22, y: 0.84 },
  { role: "CB", x: 0.18, y: 0.62 },
  { role: "CB", x: 0.18, y: 0.38 },
  { role: "LB", x: 0.22, y: 0.16 },
] as const;

const DEFENCE_THREE = [
  { role: "CB", x: 0.18, y: 0.68 },
  { role: "CB", x: 0.18, y: 0.5 },
  { role: "CB", x: 0.18, y: 0.32 },
] as const;

export const FORMATION_DEFINITIONS = {
  "4-4-2": {
    name: "4-4-2",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "RM", x: 0.48, y: 0.84 },
      { role: "CM", x: 0.44, y: 0.62 },
      { role: "CM", x: 0.44, y: 0.38 },
      { role: "LM", x: 0.48, y: 0.16 },
      { role: "ST", x: 0.7, y: 0.58 },
      { role: "ST", x: 0.7, y: 0.42 },
    ],
  },
  "4-3-3": {
    name: "4-3-3",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.34, y: 0.5 },
      { role: "CM", x: 0.44, y: 0.68 },
      { role: "CM", x: 0.44, y: 0.32 },
      { role: "RW", x: 0.6, y: 0.84 },
      { role: "ST", x: 0.66, y: 0.5 },
      { role: "LW", x: 0.6, y: 0.16 },
    ],
  },
  "4-3-3 (2)": {
    name: "4-3-3 (2)",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.36, y: 0.5 },
      { role: "CM", x: 0.46, y: 0.64 },
      { role: "CAM", x: 0.56, y: 0.5 },
      { role: "RW", x: 0.64, y: 0.84 },
      { role: "ST", x: 0.7, y: 0.5 },
      { role: "LW", x: 0.64, y: 0.16 },
    ],
  },
  "4-3-3 (3)": {
    name: "4-3-3 (3)",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CM", x: 0.44, y: 0.62 },
      { role: "CM", x: 0.44, y: 0.38 },
      { role: "CAM", x: 0.56, y: 0.5 },
      { role: "RW", x: 0.64, y: 0.84 },
      { role: "ST", x: 0.7, y: 0.5 },
      { role: "LW", x: 0.64, y: 0.16 },
    ],
  },
  "4-3-3 (4)": {
    name: "4-3-3 (4)",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.34, y: 0.5 },
      { role: "CM", x: 0.44, y: 0.66 },
      { role: "CM", x: 0.44, y: 0.34 },
      { role: "RW", x: 0.62, y: 0.84 },
      { role: "CF", x: 0.68, y: 0.5 },
      { role: "LW", x: 0.62, y: 0.16 },
    ],
  },
  "4-3-3 (5)": {
    name: "4-3-3 (5)",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.36, y: 0.5 },
      { role: "CM", x: 0.48, y: 0.65 },
      { role: "CM", x: 0.48, y: 0.35 },
      { role: "RW", x: 0.64, y: 0.86 },
      { role: "ST", x: 0.7, y: 0.5 },
      { role: "LW", x: 0.64, y: 0.14 },
    ],
  },
  "4-2-3-1": {
    name: "4-2-3-1",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.36, y: 0.62 },
      { role: "CDM", x: 0.36, y: 0.38 },
      { role: "RM", x: 0.58, y: 0.82 },
      { role: "CAM", x: 0.54, y: 0.5 },
      { role: "LM", x: 0.58, y: 0.18 },
      { role: "ST", x: 0.72, y: 0.5 },
    ],
  },
  "4-1-4-1": {
    name: "4-1-4-1",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.34, y: 0.5 },
      { role: "RM", x: 0.52, y: 0.86 },
      { role: "CM", x: 0.48, y: 0.62 },
      { role: "CM", x: 0.48, y: 0.38 },
      { role: "LM", x: 0.52, y: 0.14 },
      { role: "ST", x: 0.7, y: 0.5 },
    ],
  },
  "3-5-2": {
    name: "3-5-2",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_THREE,
      { role: "RWB", x: 0.5, y: 0.88 },
      { role: "CM", x: 0.44, y: 0.62 },
      { role: "CDM", x: 0.36, y: 0.5 },
      { role: "CM", x: 0.44, y: 0.38 },
      { role: "LWB", x: 0.5, y: 0.12 },
      { role: "ST", x: 0.7, y: 0.58 },
      { role: "ST", x: 0.7, y: 0.42 },
    ],
  },
  "3-4-3": {
    name: "3-4-3",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_THREE,
      { role: "RWB", x: 0.48, y: 0.88 },
      { role: "CM", x: 0.42, y: 0.62 },
      { role: "CM", x: 0.42, y: 0.38 },
      { role: "LWB", x: 0.48, y: 0.12 },
      { role: "RW", x: 0.64, y: 0.82 },
      { role: "ST", x: 0.7, y: 0.5 },
      { role: "LW", x: 0.64, y: 0.18 },
    ],
  },
  "5-3-2": {
    name: "5-3-2",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      { role: "RWB", x: 0.28, y: 0.88 },
      ...DEFENCE_THREE,
      { role: "LWB", x: 0.28, y: 0.12 },
      { role: "CM", x: 0.46, y: 0.65 },
      { role: "CDM", x: 0.38, y: 0.5 },
      { role: "CM", x: 0.46, y: 0.35 },
      { role: "ST", x: 0.7, y: 0.58 },
      { role: "ST", x: 0.7, y: 0.42 },
    ],
  },
  "5-2-3": {
    name: "5-2-3",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      { role: "RWB", x: 0.28, y: 0.88 },
      ...DEFENCE_THREE,
      { role: "LWB", x: 0.28, y: 0.12 },
      { role: "CDM", x: 0.4, y: 0.58 },
      { role: "CM", x: 0.4, y: 0.42 },
      { role: "RW", x: 0.64, y: 0.82 },
      { role: "ST", x: 0.7, y: 0.5 },
      { role: "LW", x: 0.64, y: 0.18 },
    ],
  },
  "4-4-1-1": {
    name: "4-4-1-1",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "RM", x: 0.48, y: 0.84 },
      { role: "CM", x: 0.44, y: 0.62 },
      { role: "CM", x: 0.44, y: 0.38 },
      { role: "LM", x: 0.48, y: 0.16 },
      { role: "CF", x: 0.6, y: 0.5 },
      { role: "ST", x: 0.72, y: 0.5 },
    ],
  },
  "4-3-2-1": {
    name: "4-3-2-1",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.34, y: 0.5 },
      { role: "CM", x: 0.46, y: 0.65 },
      { role: "CM", x: 0.46, y: 0.35 },
      { role: "CAM", x: 0.58, y: 0.62 },
      { role: "CAM", x: 0.58, y: 0.38 },
      { role: "ST", x: 0.72, y: 0.5 },
    ],
  },
  "4-1-2-1-2": {
    name: "4-1-2-1-2",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_FOUR,
      { role: "CDM", x: 0.34, y: 0.5 },
      { role: "CM", x: 0.46, y: 0.65 },
      { role: "CM", x: 0.46, y: 0.35 },
      { role: "CAM", x: 0.58, y: 0.5 },
      { role: "ST", x: 0.7, y: 0.58 },
      { role: "ST", x: 0.7, y: 0.42 },
    ],
  },
  "3-4-1-2": {
    name: "3-4-1-2",
    slots: [
      { role: "GK", x: 0.04, y: 0.5 },
      ...DEFENCE_THREE,
      { role: "RWB", x: 0.46, y: 0.88 },
      { role: "CM", x: 0.42, y: 0.62 },
      { role: "CM", x: 0.42, y: 0.38 },
      { role: "LWB", x: 0.46, y: 0.12 },
      { role: "CAM", x: 0.58, y: 0.5 },
      { role: "ST", x: 0.7, y: 0.58 },
      { role: "ST", x: 0.7, y: 0.42 },
    ],
  },
} as const satisfies Readonly<Record<FormationName, FormationDefinition>>;

export function formationDefinition(
  name: FormationName,
): FormationDefinition {
  const definition = FORMATION_DEFINITIONS[name];
  if (definition === undefined) {
    throw new RangeError(`Unknown formation "${name}"`);
  }
  return definition;
}

export function formationRoles(name: FormationName): readonly PlayerPosition[] {
  return formationDefinition(name).slots.map((slot) => slot.role);
}

/** Fail fast if a future edit breaks a geometry invariant. */
export function assertFormationDefinitions(): void {
  for (const name of FORMATION_NAMES) {
    const definition = formationDefinition(name);
    if (definition.slots.length !== 11) {
      throw new RangeError(`${name} must define eleven slots`);
    }
    let keepers = 0;
    for (const slot of definition.slots) {
      if (!Number.isFinite(slot.x) || !Number.isFinite(slot.y)) {
        throw new RangeError(`${name} contains a non-finite coordinate`);
      }
      if (
        slot.x < 0 ||
        slot.x > 1 ||
        slot.y < 0 ||
        slot.y > 1
      ) {
        throw new RangeError(`${name} coordinates must be in [0, 1]`);
      }
      if (slot.role === "GK") {
        keepers += 1;
      }
    }
    if (keepers !== 1) {
      throw new RangeError(`${name} must define exactly one goalkeeper slot`);
    }
  }
}

assertFormationDefinitions();
