// packages/data-tools/src/normalise.ts

import {
  BODY_TYPES,
  FORMATION_NAMES,
  PREFERRED_FEET,
  WORK_RATES,
  isPlayerPosition,
} from "@fb/shared";
import { createDefaultTactics } from "@fb/shared";
import type {
  BodyType,
  DetailedAttributes,
  FaceStats,
  FormationName,
  GoalkeeperAttributes,
  LeagueData,
  NationData,
  PlayerData,
  PlayerPosition,
  PreferredFoot,
  TeamColours,
  TeamData,
  TeamTactics,
  WorkRate,
} from "@fb/shared";
import { deriveFaceStats } from "./attributes";
import type { RawDataset } from "./input";

export interface NormalisedPlayer {
  readonly data: PlayerData;
  readonly realName: string;
  readonly realRef: string;
  readonly faceStatsDerived: boolean;
}

export interface NormalisedClub {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly leagueId: string;
  readonly colours: TeamColours;
  readonly stadium: string;
  readonly managerName: string;
  readonly formation: FormationName;
  readonly squad: readonly string[];
}

export interface NormalisedDataset {
  readonly sample: boolean;
  readonly label: string;
  readonly description: string;
  readonly leagues: readonly LeagueData[];
  readonly clubs: readonly NormalisedClub[];
  readonly players: readonly NormalisedPlayer[];
  readonly nations: readonly NationData[];
}

interface MutableLeague extends Omit<LeagueData, "clubIds"> {
  clubIds: string[];
}

interface MutableClub extends Omit<NormalisedClub, "squad"> {
  squad: string[];
}

interface MutableNation extends Omit<NationData, "squad" | "reserves"> {
  squad: string[];
  reserves: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function required(row: Record<string, string>, key: string, context: string): string {
  const value = row[key]?.trim() ?? "";
  if (value === "") {
    fail(context, `missing required column "${key}"`);
  }
  return value;
}

function parseInteger(
  value: string,
  field: string,
  context: string,
  min: number,
  max: number,
): number {
  if (!/^-?\d+$/.test(value.trim())) {
    fail(context, `${field} must be an integer, got "${value}"`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(context, `${field} must be in [${min}, ${max}], got ${parsed}`);
  }
  return parsed;
}

function optionalInteger(
  value: string,
  field: string,
  context: string,
  min: number,
  max: number,
): number | null {
  return value.trim() === ""
    ? null
    : parseInteger(value, field, context, min, max);
}

function parsePosition(value: string, context: string): PlayerPosition {
  const normalized = value.trim().toUpperCase();
  if (!isPlayerPosition(normalized)) {
    fail(context, `unknown position "${value}"`);
  }
  return normalized;
}

function parsePositions(value: string, context: string): PlayerPosition[] {
  const positions = value
    .split(/[|;]/)
    .map((part) => parsePosition(part, context))
    .filter((position, index, all) => all.indexOf(position) === index);
  if (positions.length === 0) {
    fail(context, "positions cannot be empty");
  }
  if (positions.length > 4) {
    fail(context, "a player may list at most four positions");
  }
  return positions;
}

function parseEnum<T extends string>(
  value: string,
  field: string,
  context: string,
  values: readonly T[],
): T {
  const normalized = value.trim().toLowerCase();
  const match = values.find((candidate) => candidate === normalized);
  if (match === undefined) {
    fail(context, `${field} must be one of ${values.join(", ")}, got "${value}"`);
  }
  return match;
}

function isFormationName(value: string): value is FormationName {
  return (FORMATION_NAMES as readonly string[]).includes(value);
}

function parseFoot(value: string, context: string): PreferredFoot {
  const normalized = value.trim().toLowerCase();
  const aliases: Readonly<Record<string, PreferredFoot>> = {
    l: "left",
    left: "left",
    r: "right",
    right: "right",
    b: "both",
    both: "both",
  };
  const foot = aliases[normalized];
  if (foot === undefined || !PREFERRED_FEET.includes(foot)) {
    fail(context, `foot must be left, right or both, got "${value}"`);
  }
  return foot;
}

function parseWorkRate(value: string, field: string, context: string): WorkRate {
  return parseEnum(value, field, context, WORK_RATES);
}

function parseBodyType(value: string, context: string): BodyType {
  return parseEnum(value, "body_type", context, BODY_TYPES);
}

function parseColours(
  primary: string,
  secondary: string,
  third: string,
  goalkeeper: string,
  context: string,
): TeamColours {
  for (const [label, value] of Object.entries({
    primary,
    secondary,
    third,
    goalkeeper,
  })) {
    if (!COLOUR_PATTERN.test(value)) {
      fail(context, `${label} colour must be #RRGGBB, got "${value}"`);
    }
  }
  return { home: primary, away: secondary, third, goalkeeper };
}

function parseId(value: string, field: string, context: string): string {
  const id = value.trim();
  if (!ID_PATTERN.test(id)) {
    fail(context, `${field} must be lowercase kebab-case, got "${value}"`);
  }
  return id;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDob(value: string, context: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(context, `dob must be YYYY-MM-DD, got "${value}"`);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    fail(context, `invalid calendar date "${value}"`);
  }
  return value;
}

function ageOn(dob: string, referenceDate: string): number {
  const [year = 0, month = 1, day = 1] = dob.split("-").map(Number);
  const [refYear = 0, refMonth = 1, refDay = 1] = referenceDate
    .split("-")
    .map(Number);
  let age = refYear - year;
  if (refMonth < month || (refMonth === month && refDay < day)) {
    age -= 1;
  }
  return age;
}

function readAttributes(
  row: Record<string, string>,
  context: string,
): DetailedAttributes {
  return {
    acceleration: parseInteger(required(row, "acceleration", context), "acceleration", context, 1, 99),
    sprintSpeed: parseInteger(required(row, "sprint_speed", context), "sprint_speed", context, 1, 99),
    finishing: parseInteger(required(row, "finishing", context), "finishing", context, 1, 99),
    shotPower: parseInteger(required(row, "shot_power", context), "shot_power", context, 1, 99),
    longShots: parseInteger(required(row, "long_shots", context), "long_shots", context, 1, 99),
    volleys: parseInteger(required(row, "volleys", context), "volleys", context, 1, 99),
    penalties: parseInteger(required(row, "penalties", context), "penalties", context, 1, 99),
    attPosition: parseInteger(required(row, "att_position", context), "att_position", context, 1, 99),
    shortPassing: parseInteger(required(row, "short_passing", context), "short_passing", context, 1, 99),
    vision: parseInteger(required(row, "vision", context), "vision", context, 1, 99),
    crossing: parseInteger(required(row, "crossing", context), "crossing", context, 1, 99),
    longPassing: parseInteger(required(row, "long_passing", context), "long_passing", context, 1, 99),
    fkAccuracy: parseInteger(required(row, "fk_accuracy", context), "fk_accuracy", context, 1, 99),
    curve: parseInteger(required(row, "curve", context), "curve", context, 1, 99),
    dribbling: parseInteger(required(row, "dribbling", context), "dribbling", context, 1, 99),
    agility: parseInteger(required(row, "agility", context), "agility", context, 1, 99),
    balance: parseInteger(required(row, "balance", context), "balance", context, 1, 99),
    reactions: parseInteger(required(row, "reactions", context), "reactions", context, 1, 99),
    ballControl: parseInteger(required(row, "ball_control", context), "ball_control", context, 1, 99),
    composure: parseInteger(required(row, "composure", context), "composure", context, 1, 99),
    interceptions: parseInteger(required(row, "interceptions", context), "interceptions", context, 1, 99),
    headingAccuracy: parseInteger(required(row, "heading_accuracy", context), "heading_accuracy", context, 1, 99),
    defAwareness: parseInteger(required(row, "def_awareness", context), "def_awareness", context, 1, 99),
    standingTackle: parseInteger(required(row, "standing_tackle", context), "standing_tackle", context, 1, 99),
    slidingTackle: parseInteger(required(row, "sliding_tackle", context), "sliding_tackle", context, 1, 99),
    jumping: parseInteger(required(row, "jumping", context), "jumping", context, 1, 99),
    stamina: parseInteger(required(row, "stamina", context), "stamina", context, 1, 99),
    strength: parseInteger(required(row, "strength", context), "strength", context, 1, 99),
    aggression: parseInteger(required(row, "aggression", context), "aggression", context, 1, 99),
  };
}

function readOptionalFaceStats(
  row: Record<string, string>,
  context: string,
): { readonly [K in keyof FaceStats]: number | null } {
  return {
    PAC: optionalInteger(row["face_pac"] ?? "", "face_pac", context, 1, 99),
    SHO: optionalInteger(row["face_sho"] ?? "", "face_sho", context, 1, 99),
    PAS: optionalInteger(row["face_pas"] ?? "", "face_pas", context, 1, 99),
    DRI: optionalInteger(row["face_dri"] ?? "", "face_dri", context, 1, 99),
    DEF: optionalInteger(row["face_def"] ?? "", "face_def", context, 1, 99),
    PHY: optionalInteger(row["face_phy"] ?? "", "face_phy", context, 1, 99),
  };
}

function readGoalkeeperStats(
  row: Record<string, string>,
  positions: readonly PlayerPosition[],
  context: string,
): GoalkeeperAttributes | null {
  const hasKeeperPosition = positions.includes("GK");
  const fields = [
    "gk_diving",
    "gk_handling",
    "gk_kicking",
    "gk_positioning",
    "gk_reflexes",
    "gk_speed",
  ] as const;
  const supplied = fields.filter((field) => (row[field] ?? "").trim() !== "");
  if (!hasKeeperPosition) {
    if (supplied.length > 0) {
      fail(context, "GK attributes are only valid for players who list GK");
    }
    return null;
  }
  if (supplied.length !== fields.length) {
    fail(context, "a GK must provide all six gk_* attributes");
  }
  return {
    diving: parseInteger(row["gk_diving"] ?? "", "gk_diving", context, 1, 99),
    handling: parseInteger(row["gk_handling"] ?? "", "gk_handling", context, 1, 99),
    kicking: parseInteger(row["gk_kicking"] ?? "", "gk_kicking", context, 1, 99),
    positioning: parseInteger(row["gk_positioning"] ?? "", "gk_positioning", context, 1, 99),
    reflexes: parseInteger(row["gk_reflexes"] ?? "", "gk_reflexes", context, 1, 99),
    speed: parseInteger(row["gk_speed"] ?? "", "gk_speed", context, 1, 99),
  };
}

function parsePlayStyles(value: string): string[] {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part, index, all) => all.indexOf(part) === index);
}

function normalisePlayer(
  row: Record<string, string>,
  sample: boolean,
  referenceDate: string,
): NormalisedPlayer {
  const sourceId = required(row, "player_id", "players.csv");
  const context = `players.csv ${sourceId}`;
  const id = parseId(sourceId, "player_id", context);
  const realName = required(row, "real_name", context);
  const positions = parsePositions(required(row, "positions", context), context);
  const preferredText = row["preferred_position"]?.trim() ?? "";
  const preferredPosition =
    preferredText === ""
      ? positions[0]
      : parsePosition(preferredText, context);
  if (preferredPosition === undefined) {
    fail(context, "positions cannot be empty");
  }
  if (!positions.includes(preferredPosition)) {
    fail(context, "preferred_position must be one of positions");
  }

  const dob = parseDob(required(row, "dob", context), context);
  const suppliedAge = parseInteger(required(row, "age", context), "age", context, 15, 50);
  const calculatedAge = ageOn(dob, referenceDate);
  if (Math.abs(suppliedAge - calculatedAge) > 1) {
    fail(
      context,
      `age ${suppliedAge} does not match dob ${dob} at ${referenceDate} (expected ${calculatedAge})`,
    );
  }

  const attributes = readAttributes(row, context);
  const derivedFaceStats = deriveFaceStats(attributes);
  const suppliedFaceStats = readOptionalFaceStats(row, context);
  const faceStats: FaceStats = {
    PAC: suppliedFaceStats.PAC ?? derivedFaceStats.PAC,
    SHO: suppliedFaceStats.SHO ?? derivedFaceStats.SHO,
    PAS: suppliedFaceStats.PAS ?? derivedFaceStats.PAS,
    DRI: suppliedFaceStats.DRI ?? derivedFaceStats.DRI,
    DEF: suppliedFaceStats.DEF ?? derivedFaceStats.DEF,
    PHY: suppliedFaceStats.PHY ?? derivedFaceStats.PHY,
  };
  const faceStatsDerived = Object.values(suppliedFaceStats).some(
    (value) => value === null,
  );

  const overall = parseInteger(required(row, "overall", context), "overall", context, 1, 99);
  const potential = parseInteger(required(row, "potential", context), "potential", context, 1, 99);
  if (potential < overall) {
    fail(context, "potential cannot be lower than overall");
  }

  const data: PlayerData = {
    id,
    name: realName,
    age: suppliedAge,
    dob,
    nationId: parseId(required(row, "nation_id", context), "nation_id", context),
    clubId: parseId(required(row, "club_id", context), "club_id", context),
    positions,
    preferredPosition,
    overall,
    potential,
    faceStats,
    attributes,
    goalkeeper: readGoalkeeperStats(row, positions, context),
    skillMoves: parseInteger(required(row, "skill_moves", context), "skill_moves", context, 1, 5),
    weakFoot: parseInteger(required(row, "weak_foot", context), "weak_foot", context, 1, 5),
    workRate: {
      att: parseWorkRate(required(row, "work_rate_att", context), "work_rate_att", context),
      def: parseWorkRate(required(row, "work_rate_def", context), "work_rate_def", context),
    },
    playStyles: parsePlayStyles(row["play_styles"] ?? ""),
    foot: parseFoot(required(row, "foot", context), context),
    heightCm: parseInteger(required(row, "height_cm", context), "height_cm", context, 140, 230),
    weightKg: parseInteger(required(row, "weight_kg", context), "weight_kg", context, 40, 150),
    bodyType: parseBodyType(required(row, "body_type", context), context),
    injuryProneness: parseInteger(required(row, "injury_proneness", context), "injury_proneness", context, 1, 99),
    kitNumber: parseInteger(required(row, "kit_number", context), "kit_number", context, 1, 99),
    face: `assets/faces/${id}.svg`,
    sample,
  };

  return {
    data,
    realName,
    realRef: row["real_ref"]?.trim() ?? "",
    faceStatsDerived,
  };
}

function assertUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  label: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) {
      fail(label, `duplicate ID "${value}"`);
    }
    seen.add(value);
  }
}

export function normaliseDataset(
  raw: RawDataset,
  referenceDate: string,
): NormalisedDataset {
  const sample = raw.metadata.sample;

  const leagues: MutableLeague[] = raw.leagues.map((row) => {
    const rawId = required(row, "league_id", "leagues.csv");
    const context = `leagues.csv ${rawId}`;
    const id = parseId(rawId, "league_id", context);
    parseInteger(required(row, "tier", context), "tier", context, 1, 1);
    const league: MutableLeague = {
      id,
      country: required(row, "country", context),
      name: required(row, "name", context),
      tier: 1,
      clubIds: [],
      season: required(row, "season", context),
      sample,
    };
    return league;
  });
  assertUnique(leagues, (league) => league.id, "leagues.csv");

  const clubs: MutableClub[] = raw.clubs.map((row) => {
    const rawId = required(row, "club_id", "clubs.csv");
    const context = `clubs.csv ${rawId}`;
    const id = parseId(rawId, "club_id", context);
    const formationText = required(row, "formation", context);
    if (!isFormationName(formationText)) {
      fail(context, `unknown formation "${formationText}"`);
    }
    const club: MutableClub = {
      id,
      name: required(row, "name", context),
      short: required(row, "short", context),
      leagueId: parseId(required(row, "league_id", context), "league_id", context),
      colours: parseColours(
        required(row, "primary_color", context),
        required(row, "secondary_color", context),
        required(row, "third_color", context),
        required(row, "goalkeeper_color", context),
        context,
      ),
      stadium: required(row, "stadium", context),
      managerName: required(row, "manager_name", context),
      formation: formationText,
      squad: [],
    };
    return club;
  });
  assertUnique(clubs, (club) => club.id, "clubs.csv");
  if (clubs.length === 0) {
    fail("clubs.csv", "at least one club is required");
  }

  const nations: MutableNation[] = raw.nations.map((row) => {
    const rawId = required(row, "nation_id", "nations.csv");
    const context = `nations.csv ${rawId}`;
    const nation: MutableNation = {
      id: parseId(rawId, "nation_id", context),
      name: required(row, "name", context),
      short: required(row, "short", context),
      colours: parseColours(
        required(row, "primary_color", context),
        required(row, "secondary_color", context),
        required(row, "third_color", context),
        required(row, "goalkeeper_color", context),
        context,
      ),
      squad: [],
      reserves: [],
      sample,
    };
    return nation;
  });
  assertUnique(nations, (nation) => nation.id, "nations.csv");

  const players = raw.players.map((row) =>
    normalisePlayer(row, sample, referenceDate),
  );
  assertUnique(players, (player) => player.data.id, "players.csv");

  const playerById = new Map(players.map((player) => [player.data.id, player]));
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const nationIds = new Set(nations.map((nation) => nation.id));

  for (const overrideId of raw.overrides.keys()) {
    if (!playerById.has(overrideId)) {
      fail("name_overrides.csv", `unknown player "${overrideId}"`);
    }
  }

  for (const club of clubs) {
    if (!leagueById.has(club.leagueId)) {
      fail(`clubs.csv ${club.id}`, `unknown league "${club.leagueId}"`);
    }
  }

  for (const league of leagues) {
    const clubIds = clubs
      .filter((club) => club.leagueId === league.id)
      .map((club) => club.id)
      .sort();
    if (clubIds.length === 0) {
      fail(`leagues.csv ${league.id}`, "league has no clubs");
    }
    league.clubIds.push(...clubIds);
  }

  for (const club of clubs) {
    const squad = players
      .filter((player) => player.data.clubId === club.id)
      .map((player) => player.data.id)
      .sort();
    if (squad.length < 18) {
      fail(`clubs.csv ${club.id}`, `needs at least 18 players, found ${squad.length}`);
    }
    const keepers = squad.filter((playerId) => {
      const player = playerById.get(playerId);
      return player?.data.positions.includes("GK") === true;
    });
    if (keepers.length < 2) {
      fail(
        `clubs.csv ${club.id}`,
        `needs at least two goalkeepers (one starter and one bench), found ${keepers.length}`,
      );
    }
    const kitNumbers = new Set<number>();
    for (const playerId of squad) {
      const player = playerById.get(playerId);
      if (player === undefined) {
        continue;
      }
      if (kitNumbers.has(player.data.kitNumber)) {
        fail(
          `clubs.csv ${club.id}`,
          `duplicate kit number ${player.data.kitNumber}`,
        );
      }
      kitNumbers.add(player.data.kitNumber);
      if (!nationIds.has(player.data.nationId)) {
        fail(
          `players.csv ${player.data.id}`,
          `unknown nation "${player.data.nationId}"`,
        );
      }
    }
    club.squad.push(...squad);
  }

  for (const player of players) {
    if (!clubById.has(player.data.clubId)) {
      fail(`players.csv ${player.data.id}`, `unknown club "${player.data.clubId}"`);
    }
  }

  for (const nation of nations) {
    const nationalPlayers = players
      .filter((player) => player.data.nationId === nation.id)
      .sort((a, b) =>
        b.data.overall - a.data.overall || a.data.id.localeCompare(b.data.id),
      );
    nation.squad.push(
      ...nationalPlayers.slice(0, 26).map((player) => player.data.id),
    );
    nation.reserves.push(
      ...nationalPlayers.slice(26).map((player) => player.data.id),
    );
  }

  return {
    sample,
    label: raw.metadata.label,
    description: raw.metadata.description,
    leagues: [...leagues].sort((a, b) => a.id.localeCompare(b.id)),
    clubs: [...clubs].sort((a, b) => a.id.localeCompare(b.id)),
    players: [...players].sort((a, b) => a.data.id.localeCompare(b.data.id)),
    nations: [...nations].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Kept exported so callers can build deterministic default tactics consistently. */
export function defaultTactics(): TeamTactics {
  return createDefaultTactics();
}

/** Convenience for tests and future M7 editors. */
export type BuiltTeamData = TeamData;
