// packages/client/src/data/catalog.ts

import {
  isRecord,
  parseTeamSheet,
  type DataManifest,
  type LeagueData,
  type NationData,
  type PlayerData,
  type TeamData,
} from "@fb/shared";

export interface TeamCatalogEntry {
  readonly team: TeamData;
  readonly players: readonly PlayerData[];
  readonly playersById: ReadonlyMap<string, PlayerData>;
}

export interface Catalog {
  readonly manifest: DataManifest;
  readonly leagues: readonly LeagueData[];
  readonly teams: readonly TeamData[];
  readonly players: readonly PlayerData[];
  readonly nations: readonly NationData[];
  readonly playersById: ReadonlyMap<string, PlayerData>;
  readonly nationsById: ReadonlyMap<string, NationData>;
  readonly teamEntries: ReadonlyMap<string, TeamCatalogEntry>;
}

let pending: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (pending === null) {
    pending = fetchCatalog().catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

async function fetchCatalog(): Promise<Catalog> {
  const [manifest, leagues, teams, players, nations] = await Promise.all([
    fetchJson("/data/manifest.json"),
    fetchJson("/data/leagues.json"),
    fetchJson("/data/teams.json"),
    fetchJson("/data/players.json"),
    fetchJson("/data/nations.json"),
  ]);
  if (
    !Array.isArray(leagues) ||
    !Array.isArray(teams) ||
    !Array.isArray(players) ||
    !Array.isArray(nations) ||
    typeof manifest !== "object" ||
    manifest === null
  ) {
    throw new Error("The server returned an unexpected football data catalog");
  }

  const parsedTeams = teams.map((team) => parseTeam(team));
  const parsedPlayers = players.map((player) => parsePlayer(player));
  const playersById = new Map(parsedPlayers.map((player) => [player.id, player]));
  const nationsById = new Map(
    (nations as NationData[]).map((nation) => [nation.id, nation]),
  );
  const teamEntries = new Map<string, TeamCatalogEntry>();
  for (const team of parsedTeams) {
    const squad = new Map<string, PlayerData>();
    for (const playerId of team.squad) {
      const player = playersById.get(playerId);
      if (player === undefined) {
        throw new Error(`${team.name} references missing player ${playerId}`);
      }
      squad.set(playerId, player);
    }
    teamEntries.set(team.id, {
      team,
      players: [...squad.values()],
      playersById: squad,
    });
  }

  return {
    manifest: manifest as unknown as DataManifest,
    leagues: leagues as LeagueData[],
    teams: parsedTeams,
    players: parsedPlayers,
    nations: nations as NationData[],
    playersById,
    nationsById,
    teamEntries,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return (await response.json()) as unknown;
}

function parseTeam(value: unknown): TeamData {
  if (!isRecord(value)) {
    throw new Error("Team catalog entry must be an object");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.squad) ||
    value.squad.some((id) => typeof id !== "string")
  ) {
    throw new Error("Team catalog entry is missing id, name or squad");
  }
  const sheet = parseTeamSheet(value.defaultSheet);
  if (sheet === null) {
    throw new Error(`${value.name} has an invalid default sheet`);
  }
  return { ...(value as unknown as TeamData), defaultSheet: sheet };
}

function parsePlayer(value: unknown): PlayerData {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.clubId !== "string" ||
    !Array.isArray(value.positions)
  ) {
    throw new Error("Player catalog entry is missing required fields");
  }
  return value as unknown as PlayerData;
}
