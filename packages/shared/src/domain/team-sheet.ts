// packages/shared/src/domain/team-sheet.ts

import {
  BUILD_UP_STYLES,
  FORMATION_NAMES,
  KIT_CHOICES,
  PRESS_INTENSITIES,
  isPlayerPosition,
} from "./football-data";
import type {
  FormationName,
  PlayerData,
  PlayerPosition,
  StartingSlot,
  TeamData,
  TeamSheet,
  TeamTactics,
} from "./football-data";
import { formationDefinition, type FormationDefinition } from "./formations";
import { isRecord } from "./guards";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const RELATED_POSITIONS: Readonly<
  Record<PlayerPosition, readonly PlayerPosition[]>
> = {
  GK: [],
  RB: ["RWB", "RM"],
  RWB: ["RB", "RM"],
  CB: ["CDM"],
  LB: ["LWB", "LM"],
  LWB: ["LB", "LM"],
  CDM: ["CM", "CB"],
  CM: ["CDM", "CAM"],
  CAM: ["CM", "CF"],
  RM: ["RW", "RB", "CM"],
  LM: ["LW", "LB", "CM"],
  RW: ["RM", "LW", "CF"],
  LW: ["LM", "RW", "CF"],
  CF: ["ST", "CAM", "RW"],
  ST: ["CF"],
};

export const DEFAULT_TEAM_TACTICS: TeamTactics = {
  defensiveDepth: 50,
  width: 55,
  pressIntensity: "medium",
  buildUpStyle: "balanced",
};

export function createDefaultTactics(): TeamTactics {
  return { ...DEFAULT_TEAM_TACTICS };
}

export function cloneTeamSheet(sheet: TeamSheet): TeamSheet {
  return {
    formation: sheet.formation,
    kit: sheet.kit,
    startingXI: sheet.startingXI.map((slot) => ({ ...slot })),
    bench: [...sheet.bench],
    reserves: [...sheet.reserves],
    captain: sheet.captain,
    penaltyTaker: sheet.penaltyTaker,
    freeKickTaker: sheet.freeKickTaker,
    cornerLeft: sheet.cornerLeft,
    cornerRight: sheet.cornerRight,
    tactics: { ...sheet.tactics },
  };
}

/**
 * How naturally a player fills a role. Selection uses the 1.05 ceiling to
 * prefer the preferred position; the simulation treats it as a 0..1 multiplier
 * on technical decisions.
 */
export function positionFamiliarity(
  player: Pick<PlayerData, "positions" | "preferredPosition">,
  role: PlayerPosition,
): number {
  if (player.preferredPosition === role) {
    return 1;
  }
  if (player.positions.includes(role)) {
    return 0.96;
  }
  if (
    player.positions.some((position) => RELATED_POSITIONS[role].includes(position))
  ) {
    return 0.78;
  }
  // Keepers are never converted in the automatic sheet.
  return role === "GK" || player.positions.includes("GK") ? 0 : 0.35;
}

function positionFit(player: PlayerData, role: PlayerPosition): number {
  return (
    positionFamiliarity(player, role) *
    (player.preferredPosition === role ? 1.05 : 1)
  );
}

function rankedForRole(
  players: readonly PlayerData[],
  role: PlayerPosition,
): PlayerData[] {
  return [...players].sort((a, b) => {
    const fitDelta = positionFit(b, role) - positionFit(a, role);
    if (fitDelta !== 0) {
      return fitDelta;
    }
    const overallDelta = b.overall - a.overall;
    return overallDelta !== 0 ? overallDelta : a.id.localeCompare(b.id);
  });
}

function bestTaker(
  starters: readonly PlayerData[],
  rating: (player: PlayerData) => number,
): PlayerData {
  const ranked = [...starters].sort((a, b) => {
    const delta = rating(b) - rating(a);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const chosen = ranked[0];
  if (chosen === undefined) {
    throw new Error("cannot choose a taker from an empty starting XI");
  }
  return chosen;
}

export interface BuiltSheet {
  readonly sheet: TeamSheet;
  readonly used: readonly string[];
}

/**
 * Deterministic best XI for any shared formation. Slot order keeps the keeper
 * first, so a squad cannot spend its only keeper on an outfield slot.
 */
export function buildDefaultSheet(
  players: readonly PlayerData[],
  formation: FormationName = "4-3-3",
  benchSize = 7,
): BuiltSheet {
  if (benchSize < 5 || benchSize > 9) {
    throw new RangeError("the bench size must be between 5 and 9");
  }
  if (players.length < 11 + benchSize) {
    throw new Error(
      `a team sheet with ${benchSize} substitutes needs at least ${11 + benchSize} players`,
    );
  }

  const roles = formationDefinition(formation).slots.map((slot) => slot.role);
  const pool = [...players];
  const starters: PlayerData[] = [];
  const startingXI: StartingSlot[] = [];

  roles.forEach((role, slot) => {
    const ranked = rankedForRole(pool, role);
    const chosen = ranked.find(
      (player) => role !== "GK" || player.positions.includes("GK"),
    );
    if (
      chosen === undefined ||
      (role !== "GK" && chosen.positions.includes("GK"))
    ) {
      throw new Error(`no suitable player for formation slot ${slot} (${role})`);
    }
    pool.splice(pool.indexOf(chosen), 1);
    starters.push(chosen);
    startingXI.push({ slot, role, playerId: chosen.id });
  });

  if (starters.filter((player) => player.positions.includes("GK")).length !== 1) {
    throw new Error("the generated starting XI must contain exactly one keeper");
  }

  const backupKeeper = [...pool]
    .filter((player) => player.positions.includes("GK"))
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0];
  if (backupKeeper === undefined) {
    throw new Error("the squad needs a second goalkeeper for the bench");
  }

  const bench: string[] = [backupKeeper.id];
  pool.splice(pool.indexOf(backupKeeper), 1);
  const benchOutfielders = [...pool]
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
    .slice(0, benchSize - 1);
  for (const player of benchOutfielders) {
    bench.push(player.id);
    pool.splice(pool.indexOf(player), 1);
  }
  if (bench.length !== benchSize) {
    throw new Error(`the bench must contain exactly ${benchSize} players`);
  }

  const reserves = pool.map((player) => player.id).sort();
  const captain = bestTaker(starters, (player) => player.overall);
  const penaltyTaker = bestTaker(starters, (player) => player.attributes.penalties);
  const freeKickTaker = bestTaker(
    starters,
    (player) => player.attributes.fkAccuracy,
  );
  const cornerLeft = bestTaker(
    starters,
    (player) => player.attributes.crossing,
  );
  const cornerRight = bestTaker(
    starters,
    (player) => player.attributes.crossing + player.attributes.curve * 0.25,
  );

  const sheet: TeamSheet = {
    formation,
    kit: "home",
    startingXI,
    bench,
    reserves,
    captain: captain.id,
    penaltyTaker: penaltyTaker.id,
    freeKickTaker: freeKickTaker.id,
    cornerLeft: cornerLeft.id,
    cornerRight: cornerRight.id,
    tactics: createDefaultTactics(),
  };

  return {
    sheet,
    used: [...starters.map((player) => player.id), ...bench, ...reserves],
  };
}

/**
 * Parse an untrusted sheet from the wire or a file. This validates shape and
 * formation/role consistency; squad ownership is checked separately against
 * the selected team because the parser is also used by the client catalog.
 */
export function parseTeamSheet(value: unknown): TeamSheet | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.formation !== "string" || !isFormationName(value.formation)) {
    return null;
  }
  const definition = formationDefinition(value.formation);
  if (!Array.isArray(value.startingXI) || value.startingXI.length !== 11) {
    return null;
  }
  const startingXI: StartingSlot[] = [];
  const starterIds = new Set<string>();
  for (const [index, item] of value.startingXI.entries()) {
    if (!isRecord(item)) {
      return null;
    }
    if (
      item.slot !== index ||
      typeof item.role !== "string" ||
      !isPlayerPosition(item.role) ||
      definition.slots[index]?.role !== item.role ||
      !isId(item.playerId) ||
      starterIds.has(item.playerId)
    ) {
      return null;
    }
    starterIds.add(item.playerId);
    startingXI.push({
      slot: index,
      role: item.role,
      playerId: item.playerId,
    });
  }

  const bench = parseIdArray(value.bench, 5, 9);
  const reserves = parseIdArray(value.reserves, 0, 40);
  if (bench === null || reserves === null) {
    return null;
  }
  const all = new Set(starterIds);
  for (const id of [...bench, ...reserves]) {
    if (all.has(id)) {
      return null;
    }
    all.add(id);
  }

  const takerIds = [
    value.captain,
    value.penaltyTaker,
    value.freeKickTaker,
    value.cornerLeft,
    value.cornerRight,
  ];
  for (const id of takerIds) {
    if (!isId(id) || !starterIds.has(id)) {
      return null;
    }
  }

  const tactics = parseTactics(value.tactics);
  if (
    tactics === null ||
    typeof value.kit !== "string" ||
    !(KIT_CHOICES as readonly string[]).includes(value.kit)
  ) {
    return null;
  }

  return {
    formation: value.formation,
    kit: value.kit as TeamSheet["kit"],
    startingXI,
    bench,
    reserves,
    captain: value.captain as string,
    penaltyTaker: value.penaltyTaker as string,
    freeKickTaker: value.freeKickTaker as string,
    cornerLeft: value.cornerLeft as string,
    cornerRight: value.cornerRight as string,
    tactics,
  };
}

/**
 * Validate a parsed sheet against a selected team and its public player map.
 * Returns actionable errors; an empty array means the sheet is match-legal.
 */
export function validateTeamSheetAgainstData(
  team: TeamData,
  sheet: TeamSheet,
  players: ReadonlyMap<string, PlayerData>,
): readonly string[] {
  const errors: string[] = [];
  let definition: FormationDefinition;
  try {
    definition = formationDefinition(sheet.formation);
  } catch {
    return [`unknown formation ${String(sheet.formation)}`];
  }
  if (sheet.startingXI.length !== 11) {
    errors.push("starting XI must have eleven players");
  }
  for (const [index, slot] of sheet.startingXI.entries()) {
    if (slot.slot !== index) {
      errors.push(`starting slot ${index} has index ${slot.slot}`);
    }
    if (definition.slots[index]?.role !== slot.role) {
      errors.push(`slot ${index} must be ${definition.slots[index]?.role ?? "defined"}`);
    }
  }
  if (sheet.bench.length < 5 || sheet.bench.length > 9) {
    errors.push("bench must contain between five and nine players");
  }

  const allIds = [
    ...sheet.startingXI.map((slot) => slot.playerId),
    ...sheet.bench,
    ...sheet.reserves,
  ];
  const unique = new Set(allIds);
  if (unique.size !== allIds.length) {
    errors.push("a player cannot appear in more than one squad section");
  }
  const squad = new Set(team.squad);
  if (squad.size !== allIds.length) {
    errors.push(
      `sheet must cover all ${squad.size} squad players (currently ${allIds.length})`,
    );
  }
  for (const id of allIds) {
    if (!squad.has(id)) {
      errors.push(`${id} is not in ${team.name}'s squad`);
    }
  }
  for (const id of squad) {
    if (!unique.has(id)) {
      errors.push(`squad player ${id} is missing from the sheet`);
    }
  }

  let startingKeepers = 0;
  for (const slot of sheet.startingXI) {
    const player = players.get(slot.playerId);
    if (player === undefined) {
      errors.push(`missing player record for ${slot.playerId}`);
      continue;
    }
    if (player.clubId !== team.id) {
      errors.push(`${player.id} belongs to ${player.clubId}`);
    }
    const isKeeper = player.positions.includes("GK");
    if (slot.role === "GK") {
      startingKeepers += 1;
      if (!isKeeper) {
        errors.push(`${player.id} is not a goalkeeper`);
      }
    } else if (isKeeper) {
      errors.push(`goalkeeper ${player.id} cannot play in an outfield slot`);
    }
  }
  if (startingKeepers !== 1) {
    errors.push("starting XI must contain exactly one goalkeeper");
  }
  const benchKeeper = sheet.bench.some(
    (id) => players.get(id)?.positions.includes("GK") === true,
  );
  if (!benchKeeper) {
    errors.push("bench must include a goalkeeper");
  }

  const starters = new Set(sheet.startingXI.map((slot) => slot.playerId));
  for (const key of [
    "captain",
    "penaltyTaker",
    "freeKickTaker",
    "cornerLeft",
    "cornerRight",
  ] as const) {
    if (!starters.has(sheet[key])) {
      errors.push(`${key} must be in the starting XI`);
    }
  }
  return errors;
}

function parseTactics(value: unknown): TeamTactics | null {
  if (!isRecord(value)) {
    return null;
  }
  const depth = value.defensiveDepth;
  const width = value.width;
  if (
    !isRating(depth) ||
    !isRating(width) ||
    typeof value.pressIntensity !== "string" ||
    !(PRESS_INTENSITIES as readonly string[]).includes(value.pressIntensity) ||
    typeof value.buildUpStyle !== "string" ||
    !(BUILD_UP_STYLES as readonly string[]).includes(value.buildUpStyle)
  ) {
    return null;
  }
  return {
    defensiveDepth: depth,
    width,
    pressIntensity: value.pressIntensity as TeamTactics["pressIntensity"],
    buildUpStyle: value.buildUpStyle as TeamTactics["buildUpStyle"],
  };
}

function parseIdArray(
  value: unknown,
  min: number,
  max: number,
): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (!isId(item)) {
      return null;
    }
    ids.push(item);
  }
  return ids;
}

function isFormationName(value: string): value is FormationName {
  return (FORMATION_NAMES as readonly string[]).includes(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

