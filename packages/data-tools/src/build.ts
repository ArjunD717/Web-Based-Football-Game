// packages/data-tools/src/build.ts

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRng } from "@fb/shared";
import type {
  DataManifest,
  LeagueData,
  NationData,
  PlayerData,
  TeamData,
} from "@fb/shared";
import { generateAssets } from "./assets";
import { readInputDataset } from "./input";
import {
  hashString,
  mutateNames,
  normalizeName,
  type NameMutation,
} from "./names";
import {
  normaliseDataset,
  type NormalisedClub,
  type NormalisedPlayer,
} from "./normalise";
import { buildNationalTeamData, buildTeamData } from "./sheet";
import { DATA_SCHEMA_VERSION } from "./schema";
import { assertValidBundle, parseBundle } from "./validate-data";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DEFAULT_INPUT_DIR = join(ROOT, "data", "input", "sample");
export const DEFAULT_OUTPUT_DIR = join(ROOT, "data");
export const DEFAULT_REFERENCE_DATE = "2026-07-01";

export interface BuildOptions {
  readonly inputDir?: string | undefined;
  readonly outDir?: string | undefined;
  readonly referenceDate?: string | undefined;
  readonly generateAssets?: boolean | undefined;
  readonly renameClubs?: boolean | undefined;
}

export interface BuildResult {
  readonly bundle: {
    readonly manifest: DataManifest;
    readonly leagues: readonly LeagueData[];
    readonly teams: readonly TeamData[];
    readonly nationalTeams: readonly TeamData[];
    readonly players: readonly PlayerData[];
    readonly nations: readonly NationData[];
  };
  readonly mutations: readonly NameMutation[];
  readonly assets: {
    readonly crests: number;
    readonly kits: number;
    readonly faces: number;
  } | null;
}

const CLUB_SUFFIXES = [
  "FC",
  "United",
  "City",
  "Athletic",
  "Rovers",
  "Town",
  "Wanderers",
  "Sporting",
] as const;

function renameClub(
  club: NormalisedClub,
  used: Set<string>,
): NormalisedClub {
  const words = club.name.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  const suffixIndex = CLUB_SUFFIXES.findIndex(
    (suffix) => suffix.toLowerCase() === last.toLowerCase(),
  );
  const base =
    suffixIndex === -1
      ? words.join(" ")
      : words.slice(0, -1).join(" ") || words.join(" ");
  const rng = createRng(hashString(club.id) ^ 0x9e3779b9);

  for (let attempt = 0; attempt < CLUB_SUFFIXES.length; attempt += 1) {
    const suffix = rng.pick(CLUB_SUFFIXES);
    if (suffixIndex !== -1 && suffix === last) {
      continue;
    }
    const name = `${base} ${suffix}`;
    const normalized = normalizeName(name);
    if (used.has(normalized)) {
      continue;
    }
    used.add(normalized);
    const stem = base
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 3)
      .toUpperCase();
    const short = stem.length >= 2 ? stem : `${stem}FC`.slice(0, 8);
    return { ...club, name, short };
  }

  throw new Error(`could not generate a substitute name for ${club.id}`);
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function assertReferenceDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`reference date must be YYYY-MM-DD, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`reference date is not a valid calendar date: "${value}"`);
  }
}

function reportCsv(mutations: readonly NameMutation[]): string {
  const header = [
    "player_id",
    "real_name",
    "public_name",
    "strategy",
    "attempts",
  ].join(",");
  const rows = mutations.map((mutation) =>
    [
      csvField(mutation.playerId),
      csvField(mutation.realName),
      csvField(mutation.name),
      csvField(mutation.strategy),
      mutation.attempts,
    ].join(","),
  );
  return `${header}\n${rows.join("\n")}\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function buildDataset(
  options: BuildOptions = {},
): Promise<BuildResult> {
  const inputDir = resolve(options.inputDir ?? DEFAULT_INPUT_DIR);
  const outDir = resolve(options.outDir ?? DEFAULT_OUTPUT_DIR);
  const referenceDate = options.referenceDate ?? DEFAULT_REFERENCE_DATE;
  assertReferenceDate(referenceDate);
  const generateAssetFiles = options.generateAssets ?? true;
  const renameClubs = options.renameClubs ?? false;

  const raw = await readInputDataset(inputDir);
  const normalised = normaliseDataset(raw, referenceDate);

  const sources = normalised.players
    .map((player) => ({
      id: player.data.id,
      realName: player.realName,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const forbiddenNames = new Set(
    sources.map((source) => normalizeName(source.realName)),
  );
  const mutations = mutateNames(sources, {
    forbiddenNames,
    overrides: raw.overrides,
  });
  const mutationById = new Map(
    mutations.map((mutation) => [mutation.playerId, mutation]),
  );
  const players: NormalisedPlayer[] = normalised.players.map((player) => {
    const mutation = mutationById.get(player.data.id);
    if (mutation === undefined) {
      throw new Error(`no name mutation generated for ${player.data.id}`);
    }
    return { ...player, data: { ...player.data, name: mutation.name } };
  });

  const usedClubNames = new Set<string>();
  const clubs = normalised.clubs.map((club) =>
    renameClubs ? renameClub(club, usedClubNames) : club,
  );

  const teams = clubs
    .map((club) => buildTeamData(club, players, normalised.sample))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nationalTeams = normalised.nations
    .map((nation) =>
      buildNationalTeamData(nation, players, normalised.sample),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const playerData = players
    .map((player) => player.data)
    .sort((a, b) => a.id.localeCompare(b.id));
  const leagues = [...normalised.leagues].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const nations = [...normalised.nations].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const manifest: DataManifest = {
    schemaVersion: DATA_SCHEMA_VERSION,
    sample: normalised.sample,
    leagues: leagues.length,
    teams: teams.length,
    nationalTeams: nationalTeams.length,
    players: playerData.length,
    nations: nations.length,
    leagueIds: leagues.map((league) => league.id),
    teamIds: teams.map((team) => team.id),
    nationalTeamIds: nationalTeams.map((team) => team.id),
  };

  const bundle = parseBundle({
    manifest,
    leagues,
    teams,
    nationalTeams,
    players: playerData,
    nations,
  });
  assertValidBundle(bundle);

  await mkdir(outDir, { recursive: true });
  if (generateAssetFiles) {
    await rm(join(outDir, "assets"), { recursive: true, force: true });
  }
  await writeJson(join(outDir, "leagues.json"), bundle.leagues);
  await writeJson(join(outDir, "teams.json"), bundle.teams);
  await writeJson(join(outDir, "national-teams.json"), bundle.nationalTeams);
  await writeJson(join(outDir, "players.json"), bundle.players);
  await writeJson(join(outDir, "nations.json"), bundle.nations);
  await writeJson(join(outDir, "manifest.json"), bundle.manifest);

  const assets = generateAssetFiles
    ? await generateAssets(
        outDir,
        bundle.teams,
        bundle.nationalTeams,
        bundle.players,
      )
    : null;

  const reportsDir = join(outDir, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, "name-mutations.csv"),
    reportCsv(mutations),
    "utf8",
  );
  await writeJson(join(reportsDir, "build-summary.json"), {
    dataset: normalised.label,
    description: normalised.description,
    sample: normalised.sample,
    referenceDate,
    counts: {
      leagues: bundle.leagues.length,
      teams: bundle.teams.length,
      nationalTeams: bundle.nationalTeams.length,
      players: bundle.players.length,
      nations: bundle.nations.length,
      faceStatsDerived: players.filter((player) => player.faceStatsDerived)
        .length,
    },
    strategies: mutations.reduce<Record<string, number>>((counts, mutation) => {
      counts[mutation.strategy] = (counts[mutation.strategy] ?? 0) + 1;
      return counts;
    }, {}),
    renameClubs,
    assets,
  });

  return { bundle, mutations, assets };
}

interface CliOptions {
  readonly inputDir?: string | undefined;
  readonly outDir?: string | undefined;
  readonly referenceDate?: string | undefined;
  readonly generateAssets: boolean;
  readonly renameClubs: boolean;
  readonly help: boolean;
}

function parseCli(args: readonly string[]): CliOptions {
  let inputDir: string | undefined;
  let outDir: string | undefined;
  let referenceDate: string | undefined;
  let generateAssets = true;
  let renameClubs = false;
  let help = false;

  const valueAfter = (index: number, flag: string): string => {
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") {
      inputDir = valueAfter(index, arg);
      index += 1;
    } else if (arg === "--out") {
      outDir = valueAfter(index, arg);
      index += 1;
    } else if (arg === "--reference-date") {
      referenceDate = valueAfter(index, arg);
      index += 1;
    } else if (arg === "--no-assets") {
      generateAssets = false;
    } else if (arg === "--rename-clubs") {
      renameClubs = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }

  return { inputDir, outDir, referenceDate, generateAssets, renameClubs, help };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(`Usage: pnpm data:build [options]

  --input <dir>             Input CSV directory (default ${DEFAULT_INPUT_DIR})
  --out <dir>               Generated data directory (default ${DEFAULT_OUTPUT_DIR})
  --reference-date <date>   Age reference date (default ${DEFAULT_REFERENCE_DATE})
  --no-assets               Skip SVG crest/kit/face generation
  --rename-clubs            Generate substitute club names (default off)
`);
    return;
  }

  const result = await buildDataset({
    inputDir: cli.inputDir,
    outDir: cli.outDir,
    referenceDate: cli.referenceDate,
    generateAssets: cli.generateAssets,
    renameClubs: cli.renameClubs,
  });
  const { manifest } = result.bundle;
  console.log(
    `Built ${manifest.leagues} league(s), ${manifest.teams} club(s), ${manifest.nationalTeams} national team(s), ${manifest.players} player(s), ${manifest.nations} nation(s).`,
  );
  if (manifest.sample) {
    console.log("DATASET IS LABELLED AS SAMPLE / FAKE DATA.");
  }
  if (result.assets !== null) {
    console.log(
      `Generated ${result.assets.crests} crests, ${result.assets.kits} kits and ${result.assets.faces} faces.`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
