// packages/data-tools/src/validate.ts

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_OUTPUT_DIR } from "./build";
import {
  assertValidBundle,
  parseBundle,
  type ParsedBundle,
} from "./validate-data";

async function readJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed;
}

export async function validateGeneratedData(
  dataDir: string,
): Promise<ParsedBundle> {
  const bundle = parseBundle({
    manifest: await readJson(join(dataDir, "manifest.json")),
    leagues: await readJson(join(dataDir, "leagues.json")),
    teams: await readJson(join(dataDir, "teams.json")),
    players: await readJson(join(dataDir, "players.json")),
    nations: await readJson(join(dataDir, "nations.json")),
  });
  assertValidBundle(bundle);
  return bundle;
}

interface CliOptions {
  readonly dataDir: string;
  readonly help: boolean;
}

function parseCli(args: readonly string[]): CliOptions {
  let dataDir = DEFAULT_OUTPUT_DIR;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--data") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--data requires a directory");
      }
      dataDir = resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return { dataDir, help };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(`Usage: pnpm data:validate [--data <dir>]

  --data <dir>   Generated data directory (default ${DEFAULT_OUTPUT_DIR})
`);
    return;
  }
  const bundle = await validateGeneratedData(cli.dataDir);
  console.log(
    `Valid data: ${bundle.manifest.leagues} league(s), ${bundle.manifest.teams} team(s), ${bundle.manifest.players} player(s), ${bundle.manifest.nations} nation(s).`,
  );
  if (bundle.manifest.sample) {
    console.log("Sample / fake dataset marker is present on every record.");
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
