// packages/data-tools/src/input.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parseCsvRecords, type CsvRecord } from "./csv";

export const PLAYER_HEADERS = [
  "player_id",
  "real_name",
  "real_ref",
  "age",
  "dob",
  "nation_id",
  "club_id",
  "positions",
  "preferred_position",
  "overall",
  "potential",
  "foot",
  "height_cm",
  "weight_kg",
  "body_type",
  "skill_moves",
  "weak_foot",
  "injury_proneness",
  "kit_number",
  "work_rate_att",
  "work_rate_def",
  "play_styles",
  "face_pac",
  "face_sho",
  "face_pas",
  "face_dri",
  "face_def",
  "face_phy",
  "acceleration",
  "sprint_speed",
  "finishing",
  "shot_power",
  "long_shots",
  "volleys",
  "penalties",
  "att_position",
  "short_passing",
  "vision",
  "crossing",
  "long_passing",
  "fk_accuracy",
  "curve",
  "dribbling",
  "agility",
  "balance",
  "reactions",
  "ball_control",
  "composure",
  "interceptions",
  "heading_accuracy",
  "def_awareness",
  "standing_tackle",
  "sliding_tackle",
  "jumping",
  "stamina",
  "strength",
  "aggression",
  "gk_diving",
  "gk_handling",
  "gk_kicking",
  "gk_positioning",
  "gk_reflexes",
  "gk_speed",
] as const;

export const CLUB_HEADERS = [
  "club_id",
  "name",
  "short",
  "league_id",
  "primary_color",
  "secondary_color",
  "third_color",
  "goalkeeper_color",
  "stadium",
  "manager_name",
  "formation",
] as const;

export const LEAGUE_HEADERS = [
  "league_id",
  "country",
  "name",
  "tier",
  "season",
] as const;

export const NATION_HEADERS = [
  "nation_id",
  "name",
  "short",
  "primary_color",
  "secondary_color",
  "third_color",
  "goalkeeper_color",
] as const;

export const OVERRIDE_HEADERS = ["player_id", "override_name"] as const;

export interface DatasetMetadata {
  readonly sample: boolean;
  readonly label: string;
  readonly description: string;
}

export interface RawDataset {
  readonly metadata: DatasetMetadata;
  readonly leagues: readonly CsvRecord[];
  readonly clubs: readonly CsvRecord[];
  readonly nations: readonly CsvRecord[];
  readonly players: readonly CsvRecord[];
  readonly overrides: ReadonlyMap<string, string>;
}

async function readCsv(
  inputDir: string,
  file: string,
  headers: readonly string[],
): Promise<readonly CsvRecord[]> {
  const text = await readFile(join(inputDir, file), "utf8");
  return parseCsvRecords(text, headers, file).records;
}

async function readMetadata(inputDir: string): Promise<DatasetMetadata> {
  let json: unknown;
  try {
    const text = await readFile(join(inputDir, "dataset.json"), "utf8");
    const parsedText: unknown = JSON.parse(text);
    json = parsedText;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        sample: false,
        label: "Imported dataset",
        description: "No dataset.json metadata supplied.",
      };
    }
    throw error;
  }

  const parsed = z
    .object({
      sample: z.boolean(),
      label: z.string().trim().min(1),
      description: z.string().trim().max(500).optional().default(""),
    })
    .strict()
    .safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `dataset.json is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export async function readInputDataset(
  inputDir: string,
): Promise<RawDataset> {
  const metadata = await readMetadata(inputDir);
  const overrides = await readCsv(inputDir, "name_overrides.csv", OVERRIDE_HEADERS);
  const overrideMap = new Map<string, string>();
  for (const row of overrides) {
    const playerId = row["player_id"]?.trim() ?? "";
    const name = row["override_name"]?.trim() ?? "";
    if (playerId === "" || name === "") {
      throw new Error(
        "name_overrides.csv: both player_id and override_name are required",
      );
    }
    if (overrideMap.has(playerId)) {
      throw new Error(
        `name_overrides.csv: duplicate override for ${playerId}`,
      );
    }
    overrideMap.set(playerId, name);
  }

  return {
    metadata,
    leagues: await readCsv(inputDir, "leagues.csv", LEAGUE_HEADERS),
    clubs: await readCsv(inputDir, "clubs.csv", CLUB_HEADERS),
    nations: await readCsv(inputDir, "nations.csv", NATION_HEADERS),
    players: await readCsv(inputDir, "players.csv", PLAYER_HEADERS),
    overrides: overrideMap,
  };
}
