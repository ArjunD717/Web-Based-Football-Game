// packages/data-tools/src/formations.ts

import type { FormationName, PlayerPosition } from "@fb/shared";

/**
 * Role orders used by the data pipeline's automatic sheet builder. Coordinates
 * live in the simulation/client formation modules; this table is intentionally
 * about squad selection so every supported formation can be generated before
 * the M7 editor exposes geometry.
 */
export const FORMATION_ROLE_ORDERS = {
  "4-4-2": ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "ST", "ST"],
  "4-3-3": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "RW", "ST", "LW"],
  "4-3-3 (2)": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CAM", "RW", "ST", "LW"],
  "4-3-3 (3)": ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"],
  "4-3-3 (4)": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "RW", "CF", "LW"],
  "4-3-3 (5)": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "RW", "ST", "LW"],
  "4-2-3-1": ["GK", "RB", "CB", "CB", "LB", "CDM", "CDM", "RM", "CAM", "LM", "ST"],
  "4-1-4-1": ["GK", "RB", "CB", "CB", "LB", "CDM", "RM", "CM", "CM", "LM", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "RWB", "CM", "CDM", "CM", "LWB", "ST", "ST"],
  "3-4-3": ["GK", "CB", "CB", "CB", "RWB", "CM", "CM", "LWB", "RW", "ST", "LW"],
  "5-3-2": ["GK", "RWB", "CB", "CB", "CB", "LWB", "CM", "CDM", "CM", "ST", "ST"],
  "5-2-3": ["GK", "RWB", "CB", "CB", "CB", "LWB", "CDM", "CM", "RW", "ST", "LW"],
  "4-4-1-1": ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "CF", "ST"],
  "4-3-2-1": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "CAM", "CAM", "ST"],
  "4-1-2-1-2": ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "CAM", "ST", "ST"],
  "3-4-1-2": ["GK", "CB", "CB", "CB", "RWB", "CM", "CM", "LWB", "CAM", "ST", "ST"],
} as const satisfies Readonly<Record<FormationName, readonly PlayerPosition[]>>;

export function rolesForFormation(
  formation: FormationName,
): readonly PlayerPosition[] {
  const roles = FORMATION_ROLE_ORDERS[formation];
  if (roles.length !== 11) {
    throw new Error(`${formation} must define eleven slots`);
  }
  if (roles.filter((role) => role === "GK").length !== 1) {
    throw new Error(`${formation} must define exactly one goalkeeper slot`);
  }
  return roles;
}
