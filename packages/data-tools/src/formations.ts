// packages/data-tools/src/formations.ts

import {
  FORMATION_NAMES,
  formationRoles,
  type FormationName,
  type PlayerPosition,
} from "@fb/shared";

/**
 * Role orders are derived from the shared geometry so the data pipeline and
 * the M7 editor can never disagree about a formation.
 */
export const FORMATION_ROLE_ORDERS: Readonly<
  Record<FormationName, readonly PlayerPosition[]>
> = Object.fromEntries(
  FORMATION_NAMES.map((formation) => [formation, formationRoles(formation)]),
) as Readonly<Record<FormationName, readonly PlayerPosition[]>>;

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
