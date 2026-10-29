// packages/server/src/data/registry.ts

import {
  validateGeneratedData,
  type ParsedBundle,
} from "@fb/data-tools";
import {
  cloneTeamSheet,
  validateTeamSheetAgainstData,
  type PlayerData,
  type TeamData,
  type TeamSheet,
} from "@fb/shared";

export interface TeamRegistry {
  readonly teams: readonly TeamData[];
  getTeam(teamId: string): TeamData | null;
  getPlayers(teamId: string): readonly PlayerData[];
  getDefaultSheet(teamId: string): TeamSheet;
  validateSheet(teamId: string, sheet: TeamSheet): readonly string[];
}

/**
 * Read-only lookup over the generated data bundle. Validation happens once at
 * startup; every interactive sheet edit is then checked against the same map.
 */
export function createTeamRegistry(bundle: ParsedBundle): TeamRegistry {
  if (bundle.teams.length === 0) {
    throw new Error("Generated data contains no teams");
  }
  const teams = [...bundle.teams].sort((a, b) => a.name.localeCompare(b.name));
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const playersById = new Map(bundle.players.map((player) => [player.id, player]));
  const playersByTeam = new Map<string, ReadonlyMap<string, PlayerData>>();
  for (const team of teams) {
    const squad = new Map<string, PlayerData>();
    for (const playerId of team.squad) {
      const player = playersById.get(playerId);
      if (player === undefined) {
        throw new Error(`${team.id}: missing squad player ${playerId}`);
      }
      squad.set(playerId, player);
    }
    const errors = validateTeamSheetAgainstData(team, team.defaultSheet, squad);
    if (errors.length > 0) {
      throw new Error(
        `${team.id}: generated default sheet is invalid:\n- ${errors.join("\n- ")}`,
      );
    }
    playersByTeam.set(team.id, squad);
  }

  return {
    teams,
    getTeam(teamId) {
      return teamsById.get(teamId) ?? null;
    },
    getPlayers(teamId) {
      const squad = playersByTeam.get(teamId);
      return squad === undefined ? [] : [...squad.values()];
    },
    getDefaultSheet(teamId) {
      const team = teamsById.get(teamId);
      if (team === undefined) {
        throw new Error(`Unknown team ${teamId}`);
      }
      return cloneTeamSheet(team.defaultSheet);
    },
    validateSheet(teamId, sheet) {
      const team = teamsById.get(teamId);
      if (team === undefined) {
        return [`Unknown team ${teamId}`];
      }
      const squad = playersByTeam.get(team.id) ?? new Map();
      return validateTeamSheetAgainstData(team, sheet, squad);
    },
  };
}

export async function loadTeamRegistry(dataDir: string): Promise<TeamRegistry> {
  let bundle: ParsedBundle;
  try {
    bundle = await validateGeneratedData(dataDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not load generated football data from ${dataDir}. Run "pnpm data:build" first.\n${detail}`,
    );
  }
  return createTeamRegistry(bundle);
}
