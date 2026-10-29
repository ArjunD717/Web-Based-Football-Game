// packages/data-tools/src/preview.ts

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTeamFromData, createPitch, topSpeedFor } from "@fb/sim";
import { validateGeneratedData } from "./validate";

const DEFAULT_DATA_DIR = fileURLToPath(
  new URL("../../../data", import.meta.url),
);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dataDir = DEFAULT_DATA_DIR;
  const dataIndex = args.indexOf("--data");
  if (dataIndex !== -1) {
    const value = args[dataIndex + 1];
    if (value === undefined) {
      throw new Error("--data requires a directory");
    }
    dataDir = resolve(value);
  }

  const bundle = await validateGeneratedData(dataDir);
  const team = bundle.teams.find(
    (candidate) => candidate.defaultSheet.formation === "4-3-3",
  );
  if (team === undefined) {
    throw new Error("no 4-3-3 team in generated data (sim intake arrives in M7)");
  }
  const players = new Map(bundle.players.map((player) => [player.id, player]));
  const state = createTeamFromData({
    side: "home",
    pitch: createPitch(),
    team,
    players,
  });

  console.log(`${bundle.manifest.sample ? "FAKE SAMPLE — " : ""}${team.name}`);
  console.log(`League: ${team.leagueId}; formation ${team.defaultSheet.formation}`);
  console.log("Starting XI (mapped sim ratings):");
  for (const player of state.players) {
    const dataPlayer = players.get(player.id.replace(/^home:/, ""));
    if (dataPlayer === undefined) {
      throw new Error(`missing data for ${player.id}`);
    }
    const attributes = player.attributes;
    console.log(
      `#${String(player.number).padStart(2, "0")} ${player.role.padEnd(3)} ${dataPlayer.name.padEnd(22)} ` +
        `top ${topSpeedFor(attributes).toFixed(2)} m/s; ` +
        `ACC ${attributes.acceleration}; BAL ${attributes.balance}; TAC ${attributes.standingTackle}; ` +
        `overall ${dataPlayer.overall}`,
    );
  }
  console.log(
    `Bench ${team.defaultSheet.bench.length}; reserves ${team.defaultSheet.reserves.length}.`,
  );
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
