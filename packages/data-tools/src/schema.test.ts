// packages/data-tools/src/schema.test.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DataBundleSchema,
  PlayerDataSchema,
  formatZodError,
} from "./schema";
import {
  assertValidBundle,
  parseBundle,
  type ParsedBundle,
} from "./validate-data";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));

async function readJson(name: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(join(dataDir, name), "utf8"));
  return parsed;
}

async function loadBundle(): Promise<ParsedBundle> {
  return parseBundle({
    manifest: await readJson("manifest.json"),
    leagues: await readJson("leagues.json"),
    teams: await readJson("teams.json"),
    nationalTeams: await readJson("national-teams.json"),
    players: await readJson("players.json"),
    nations: await readJson("nations.json"),
  });
}

describe("data schemas", () => {
  it("validates the committed sample bundle and cross-file references", async () => {
    const bundle = await loadBundle();
    expect(bundle.manifest.sample).toBe(true);
    expect(bundle.players).toHaveLength(156);
    expect(bundle.nationalTeams).toHaveLength(5);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it("rejects source-only realRef fields on public players", async () => {
    const bundle = await loadBundle();
    const player = bundle.players[0]!;
    const parsed = PlayerDataSchema.safeParse({ ...player, realRef: "secret" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toContain("Unrecognized key");
    }
  });

  it("rejects bad ratings, missing keeper stats and duplicate names", async () => {
    const bundle = await loadBundle();
    const player = bundle.players[0]!;
    const keeper = bundle.players.find((entry) =>
      entry.positions.includes("GK"),
    )!;
    expect(
      PlayerDataSchema.safeParse({
        ...player,
        attributes: { ...player.attributes, sprintSpeed: 120 },
      }).success,
    ).toBe(false);
    expect(
      PlayerDataSchema.safeParse({ ...keeper, goalkeeper: null }).success,
    ).toBe(false);

    const duplicated = {
      ...bundle,
      players: [bundle.players[0]!, bundle.players[0]!],
    };
    expect(DataBundleSchema.safeParse(duplicated).success).toBe(true);
    expect(() => assertValidBundle(parseBundle(duplicated))).toThrow(
      /duplicate|squad|unknown/,
    );
  });

  it("rejects a squad without a bench goalkeeper", async () => {
    const bundle = await loadBundle();
    const team = bundle.teams[0]!;
    const benchKeeper = team.defaultSheet.bench.find(
      (id) =>
        bundle.players
          .find((player) => player.id === id)
          ?.positions.includes("GK") === true,
    );
    expect(benchKeeper).toBeDefined();
    const bench = team.defaultSheet.bench.filter((id) => id !== benchKeeper);
    const tampered = {
      ...team,
      defaultSheet: { ...team.defaultSheet, bench },
    };
    const parsed = DataBundleSchema.safeParse({
      ...bundle,
      teams: [tampered, ...bundle.teams.slice(1)],
    });
    expect(parsed.success).toBe(true);
    expect(() =>
      assertValidBundle(
        parseBundle({ ...bundle, teams: [tampered, ...bundle.teams.slice(1)] }),
      ),
    ).toThrow(/bench must include a goalkeeper/);
  });
});
