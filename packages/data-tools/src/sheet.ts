// packages/data-tools/src/sheet.ts

import {
  buildDefaultSheet,
  type BuiltSheet,
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
