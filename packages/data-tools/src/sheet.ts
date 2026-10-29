// packages/data-tools/src/sheet.ts

import type {
  FormationName,
  PlayerData,
  PlayerPosition,
  StartingSlot,
  TeamData,
  TeamSheet,
} from "@fb/shared";
import type { NormalisedClub, NormalisedPlayer } from "./normalise";
import { defaultTactics as createDefaultTactics } from "./normalise";
import { rolesForFormation } from "./formations";

const RELATED_POSITIONS: Readonly<Record<PlayerPosition, readonly PlayerPosition[]>> = {
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

function positionFit(player: PlayerData, role: PlayerPosition): number {
  if (player.preferredPosition === role) {
    return 1.05;
  }
  if (player.positions.includes(role)) {
    return 1;
  }
  if (player.positions.some((position) => RELATED_POSITIONS[role].includes(position))) {
    return 0.78;
  }
  // Keepers are never converted in the automatic sheet.
  return role === "GK" || player.positions.includes("GK") ? 0 : 0.35;
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
 * Greedy but deterministic best XI. The 4-3-3 slot order puts a keeper first,
 * then the most constrained defensive roles, so a squad cannot spend its only
 * keeper on an outfield slot.
 */
export function buildDefaultSheet(
  players: readonly PlayerData[],
  formation: FormationName = "4-3-3",
): BuiltSheet {
  if (players.length < 18) {
    throw new Error("a team sheet needs at least 18 players");
  }

  const roles = rolesForFormation(formation);
  const pool = [...players];
  const starters: PlayerData[] = [];
  const startingXI: StartingSlot[] = [];

  roles.forEach((role, slot) => {
    const ranked = rankedForRole(pool, role);
    const chosen = ranked[0];
    if (chosen === undefined || (role === "GK" && !chosen.positions.includes("GK"))) {
      throw new Error(`no suitable player for formation slot ${slot} (${role})`);
    }
    pool.splice(pool.indexOf(chosen), 1);
    starters.push(chosen);
    startingXI.push({ slot, role, playerId: chosen.id });
  });

  if (
    starters.filter((player) => player.positions.includes("GK")).length !== 1
  ) {
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
    .slice(0, 6);
  for (const player of benchOutfielders) {
    bench.push(player.id);
    pool.splice(pool.indexOf(player), 1);
  }
  if (bench.length !== 7) {
    throw new Error("the bench must contain exactly seven players");
  }

  const reserves = pool.map((player) => player.id).sort();
  const captain = bestTaker(starters, (player) => player.overall);
  const penaltyTaker = bestTaker(starters, (player) => player.attributes.penalties);
  const freeKickTaker = bestTaker(starters, (player) => player.attributes.fkAccuracy);
  const cornerLeft = bestTaker(starters, (player) => player.attributes.crossing);
  const cornerRight = bestTaker(
    starters,
    (player) => player.attributes.crossing + player.attributes.curve * 0.25,
  );

  const sheet: TeamSheet = {
    formation,
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
    used: [
      ...starters.map((player) => player.id),
      ...bench,
      ...reserves,
    ],
  };
}

export function buildTeamData(
  club: NormalisedClub,
  players: readonly NormalisedPlayer[],
  sample: boolean,
): TeamData {
  const clubPlayers = players
    .filter((player) => player.data.clubId === club.id)
    .map((player) => player.data)
    .sort((a, b) => a.id.localeCompare(b.id));
  const built = buildDefaultSheet(clubPlayers, club.formation);
  const allIds = new Set(club.squad);
  for (const playerId of built.used) {
    if (!allIds.has(playerId)) {
      throw new Error(`${club.id}: sheet contains ${playerId} outside its squad`);
    }
  }

  return {
    id: club.id,
    name: club.name,
    short: club.short,
    leagueId: club.leagueId,
    colours: club.colours,
    stadium: club.stadium,
    managerName: club.managerName,
    crest: `assets/crests/${club.id}.svg`,
    kits: {
      home: `assets/kits/${club.id}-home.svg`,
      away: `assets/kits/${club.id}-away.svg`,
      third: `assets/kits/${club.id}-third.svg`,
    },
    squad: [...club.squad].sort(),
    defaultSheet: built.sheet,
    sample,
  };
}
