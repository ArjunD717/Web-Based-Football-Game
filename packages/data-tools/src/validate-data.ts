// packages/data-tools/src/validate-data.ts

import type { z } from "zod";
import { normalizeName } from "./names";
import {
  DataBundleSchema,
  formatZodError,
  type DataBundle,
} from "./schema";

export function parseBundle(raw: unknown): DataBundle {
  const parsed = DataBundleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Generated data does not match the schema:\n${formatZodError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function crossValidate(bundle: DataBundle): string[] {
  const errors: string[] = [];
  const leagueById = new Map(bundle.leagues.map((league) => [league.id, league]));
  const teamById = new Map(bundle.teams.map((team) => [team.id, team]));
  const nationalTeamById = new Map(
    bundle.nationalTeams.map((team) => [team.id, team]),
  );
  const playerById = new Map(bundle.players.map((player) => [player.id, player]));
  const nationById = new Map(bundle.nations.map((nation) => [nation.id, nation]));
  if (leagueById.size !== bundle.leagues.length) {
    errors.push("duplicate league ID in generated data");
  }
  if (teamById.size !== bundle.teams.length) {
    errors.push("duplicate team ID in generated data");
  }
  if (nationalTeamById.size !== bundle.nationalTeams.length) {
    errors.push("duplicate national team ID in generated data");
  }
  for (const nationalTeam of bundle.nationalTeams) {
    if (teamById.has(nationalTeam.id)) {
      errors.push(
        `national team ${nationalTeam.id}: ID also used by a club`,
      );
    }
  }
  if (playerById.size !== bundle.players.length) {
    errors.push("duplicate player ID in generated data");
  }
  if (nationById.size !== bundle.nations.length) {
    errors.push("duplicate nation ID in generated data");
  }
  const clubMembership = new Map<string, string>();

  for (const league of bundle.leagues) {
    const expected = bundle.teams
      .filter((team) => team.leagueId === league.id)
      .map((team) => team.id)
      .sort();
    const actual = [...league.clubIds].sort();
    if (expected.join("|") !== actual.join("|")) {
      errors.push(
        `league ${league.id}: clubIds do not match teams assigned to it`,
      );
    }
  }

  for (const team of bundle.teams) {
    if (team.kind !== "club") {
      errors.push(`team ${team.id}: club list contains a ${team.kind} team`);
      continue;
    }
    if (team.leagueId === null || !leagueById.has(team.leagueId)) {
      errors.push(`team ${team.id}: unknown league ${team.leagueId}`);
    }
    if (new Set(team.squad).size !== team.squad.length) {
      errors.push(`team ${team.id}: duplicate squad player`);
    }
    const squadPlayers = team.squad.map((playerId) => playerById.get(playerId));
    if (squadPlayers.some((player) => player === undefined)) {
      errors.push(`team ${team.id}: squad references a missing player`);
    }
    const keepers = squadPlayers.filter(
      (player) => player?.positions.includes("GK") === true,
    );
    if (keepers.length < 2) {
      errors.push(`team ${team.id}: fewer than two goalkeepers`);
    }
    for (const player of squadPlayers) {
      if (player === undefined) {
        continue;
      }
      if (player.clubId !== team.id) {
        errors.push(
          `team ${team.id}: ${player.id} has clubId ${player.clubId}`,
        );
      }
      if (clubMembership.has(player.id)) {
        errors.push(`player ${player.id}: appears in multiple squads`);
      }
      clubMembership.set(player.id, team.id);
      if (!nationById.has(player.nationId)) {
        errors.push(
          `player ${player.id}: unknown nation ${player.nationId}`,
        );
      }
    }
    const sheets = [
      ...team.defaultSheet.startingXI.map((slot) => slot.playerId),
      ...team.defaultSheet.bench,
      ...team.defaultSheet.reserves,
    ];
    if (new Set(sheets).size !== sheets.length) {
      errors.push(`team ${team.id}: sheet contains duplicate player`);
    }
    if (sheets.length !== team.squad.length) {
      errors.push(
        `team ${team.id}: sheet covers ${sheets.length} of ${team.squad.length} squad players`,
      );
    }
    for (const playerId of sheets) {
      if (!team.squad.includes(playerId)) {
        errors.push(`team ${team.id}: sheet player ${playerId} not in squad`);
      }
    }
    const starterKeepers = team.defaultSheet.startingXI.filter(
      (slot) => slot.role === "GK",
    );
    if (starterKeepers.length !== 1) {
      errors.push(`team ${team.id}: starting XI must have exactly one GK`);
    }
    const benchKeepers = team.defaultSheet.bench.filter(
      (playerId) => playerById.get(playerId)?.positions.includes("GK") === true,
    );
    if (benchKeepers.length === 0) {
      errors.push(`team ${team.id}: bench must include a goalkeeper`);
    }
    const kitNumbers = new Set<number>();
    for (const player of squadPlayers) {
      if (player === undefined) {
        continue;
      }
      if (kitNumbers.has(player.kitNumber)) {
        errors.push(
          `team ${team.id}: duplicate kit number ${player.kitNumber}`,
        );
      }
      kitNumbers.add(player.kitNumber);
    }
  }

  for (const player of bundle.players) {
    if (!teamById.has(player.clubId)) {
      errors.push(`player ${player.id}: unknown club ${player.clubId}`);
    } else if (!clubMembership.has(player.id)) {
      errors.push(`player ${player.id}: not included in club squad`);
    }
    if (!nationById.has(player.nationId)) {
      errors.push(`player ${player.id}: unknown nation ${player.nationId}`);
    }
  }

  const names = new Map<string, string>();
  for (const player of bundle.players) {
    const normalized = normalizeName(player.name);
    const previous = names.get(normalized);
    if (previous !== undefined) {
      errors.push(
        `players ${previous} and ${player.id}: duplicate public name "${player.name}"`,
      );
    }
    names.set(normalized, player.id);
  }

  for (const nation of bundle.nations) {
    if (nation.squad.length !== 26) {
      errors.push(
        `nation ${nation.id}: expected 26 call-ups, found ${nation.squad.length}`,
      );
    }
    const all = [...nation.squad, ...nation.reserves];
    if (new Set(all).size !== all.length) {
      errors.push(`nation ${nation.id}: duplicate player`);
    }
    for (const playerId of all) {
      const player = playerById.get(playerId);
      if (player === undefined) {
        errors.push(`nation ${nation.id}: missing player ${playerId}`);
      } else if (player.nationId !== nation.id) {
        errors.push(
          `nation ${nation.id}: ${playerId} has nationId ${player.nationId}`,
        );
      }
    }
    const keepers = nation.squad.filter(
      (playerId) => playerById.get(playerId)?.positions.includes("GK") === true,
    );
    if (keepers.length < 2) {
      errors.push(`nation ${nation.id}: fewer than two call-up goalkeepers`);
    }
  }

  for (const nationalTeam of bundle.nationalTeams) {
    if (nationalTeam.kind !== "nation") {
      errors.push(
        `national team ${nationalTeam.id}: kind is ${nationalTeam.kind}`,
      );
      continue;
    }
    if (nationalTeam.nationId === null) {
      errors.push(`national team ${nationalTeam.id}: missing nationId`);
      continue;
    }
    const nation = nationById.get(nationalTeam.nationId);
    if (nation === undefined) {
      errors.push(
        `national team ${nationalTeam.id}: unknown nation ${nationalTeam.nationId}`,
      );
      continue;
    }
    if (nationalTeam.leagueId !== null) {
      errors.push(`national team ${nationalTeam.id}: must not have a league`);
    }
    if (
      nationalTeam.squad.length !== nation.squad.length ||
      nationalTeam.squad.some(
        (playerId, index) => playerId !== nation.squad[index],
      )
    ) {
      errors.push(
        `national team ${nationalTeam.id}: squad must match the 26 call-ups`,
      );
    }
    if (new Set(nationalTeam.squad).size !== nationalTeam.squad.length) {
      errors.push(`national team ${nationalTeam.id}: duplicate squad player`);
    }
    const squadPlayers = nationalTeam.squad.map((playerId) =>
      playerById.get(playerId),
    );
    if (squadPlayers.some((player) => player === undefined)) {
      errors.push(
        `national team ${nationalTeam.id}: squad references a missing player`,
      );
    }
    const sheets = [
      ...nationalTeam.defaultSheet.startingXI.map((slot) => slot.playerId),
      ...nationalTeam.defaultSheet.bench,
      ...nationalTeam.defaultSheet.reserves,
    ];
    if (new Set(sheets).size !== sheets.length) {
      errors.push(
        `national team ${nationalTeam.id}: sheet contains duplicate player`,
      );
    }
    if (sheets.length !== nationalTeam.squad.length) {
      errors.push(
        `national team ${nationalTeam.id}: sheet covers ${sheets.length} of ${nationalTeam.squad.length} players`,
      );
    }
    for (const playerId of sheets) {
      if (!nationalTeam.squad.includes(playerId)) {
        errors.push(
          `national team ${nationalTeam.id}: sheet player ${playerId} not in squad`,
        );
      }
    }
    const starterKeepers = nationalTeam.defaultSheet.startingXI.filter(
      (slot) => slot.role === "GK",
    );
    if (starterKeepers.length !== 1) {
      errors.push(
        `national team ${nationalTeam.id}: starting XI must have exactly one GK`,
      );
    }
    const benchKeepers = nationalTeam.defaultSheet.bench.filter(
      (playerId) => playerById.get(playerId)?.positions.includes("GK") === true,
    );
    if (benchKeepers.length === 0) {
      errors.push(
        `national team ${nationalTeam.id}: bench must include a goalkeeper`,
      );
    }
  }

  if (bundle.manifest.leagues !== bundle.leagues.length) {
    errors.push("manifest: league count mismatch");
  }
  if (bundle.manifest.teams !== bundle.teams.length) {
    errors.push("manifest: team count mismatch");
  }
  if (bundle.manifest.nationalTeams !== bundle.nationalTeams.length) {
    errors.push("manifest: national team count mismatch");
  }
  if (
    bundle.manifest.teamIds.join("|") !==
    bundle.teams.map((team) => team.id).sort().join("|")
  ) {
    errors.push("manifest: team IDs do not match generated clubs");
  }
  if (
    bundle.manifest.nationalTeamIds.join("|") !==
    bundle.nationalTeams.map((team) => team.id).sort().join("|")
  ) {
    errors.push("manifest: national team IDs do not match generated nations");
  }
  if (bundle.manifest.players !== bundle.players.length) {
    errors.push("manifest: player count mismatch");
  }
  if (bundle.manifest.nations !== bundle.nations.length) {
    errors.push("manifest: nation count mismatch");
  }

  if (bundle.manifest.sample) {
    for (const player of bundle.players) {
      if (!player.sample) {
        errors.push(`player ${player.id}: sample dataset player not labelled`);
      }
    }
    for (const team of bundle.teams) {
      if (!team.sample) {
        errors.push(`team ${team.id}: sample dataset team not labelled`);
      }
    }
    for (const team of bundle.nationalTeams) {
      if (!team.sample) {
        errors.push(
          `national team ${team.id}: sample dataset team not labelled`,
        );
      }
    }
    for (const nation of bundle.nations) {
      if (!nation.sample) {
        errors.push(`nation ${nation.id}: sample dataset nation not labelled`);
      }
    }
    for (const league of bundle.leagues) {
      if (!league.sample) {
        errors.push(`league ${league.id}: sample dataset league not labelled`);
      }
    }
  }

  return errors;
}

export function assertValidBundle(bundle: DataBundle): void {
  const errors = crossValidate(bundle);
  if (errors.length > 0) {
    throw new Error(
      `Generated data failed cross-file validation:\n- ${errors.join("\n- ")}`,
    );
  }
}

export type ParsedBundle = z.infer<typeof DataBundleSchema>;
