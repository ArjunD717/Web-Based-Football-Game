// packages/data-tools/src/sheet.ts

import {
  buildDefaultSheet,
  type BuiltSheet,
  type NationData,
  type PlayerData,
  type TeamData,
} from "@fb/shared";
import type { NormalisedClub, NormalisedPlayer } from "./normalise";

export { buildDefaultSheet };
export type { BuiltSheet };

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
    kind: "club",
    name: club.name,
    short: club.short,
    leagueId: club.leagueId,
    nationId: null,
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

/**
 * Build a playable national side from the supplied 26-man call-up list. The
 * reserve pool stays in nations.json for future call-ups and never enters the
 * matchday sheet, so the 26-player contract stays enforceable.
 */
export function buildNationalTeamData(
  nation: NationData,
  players: readonly NormalisedPlayer[],
  sample: boolean,
): TeamData {
  const playerById = new Map(
    players.map((player) => [player.data.id, player.data]),
  );
  const squad: PlayerData[] = [];
  for (const playerId of nation.squad) {
    const player = playerById.get(playerId);
    if (player === undefined) {
      throw new Error(
        `${nation.id}: call-up ${playerId} has no player record`,
      );
    }
    squad.push(player);
  }
  if (squad.length !== 26) {
    throw new Error(
      `${nation.id}: expected 26 call-ups, found ${squad.length}`,
    );
  }
  const built = buildDefaultSheet(squad, "4-3-3");
  const sheetIds = new Set(built.used);
  for (const playerId of nation.squad) {
    if (!sheetIds.has(playerId)) {
      throw new Error(
        `${nation.id}: ${playerId} missing from the national sheet`,
      );
    }
  }
  const id = `nation-${nation.id}`;
  return {
    id,
    kind: "nation",
    name: nation.name,
    short: nation.short,
    leagueId: null,
    nationId: nation.id,
    colours: nation.colours,
    stadium: "National Stadium",
    managerName: "National Coach",
    crest: `assets/crests/${id}.svg`,
    kits: {
      home: `assets/kits/${id}-home.svg`,
      away: `assets/kits/${id}-away.svg`,
      third: `assets/kits/${id}-third.svg`,
    },
    squad: [...nation.squad],
    defaultSheet: built.sheet,
    sample,
  };
}
