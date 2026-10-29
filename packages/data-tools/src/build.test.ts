// packages/data-tools/src/build.test.ts

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDataset } from "./build";
import { validateGeneratedData } from "./validate";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fb-data-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("data build", () => {
  it("writes a labelled, schema-valid sample league with assets and a report", async () => {
    const outDir = await tempDir();
    const result = await buildDataset({ outDir, generateAssets: true });
    expect(result.bundle.manifest).toMatchObject({
      sample: true,
      leagues: 1,
      teams: 3,
      players: 60,
      nations: 5,
    });
    const validated = await validateGeneratedData(outDir);
    expect(validated.players.every((player) => player.sample)).toBe(true);
    expect(validated.teams.every((team) => team.defaultSheet.bench.length === 7)).toBe(true);
    expect(result.assets).toEqual({ crests: 3, kits: 9, faces: 60 });

    const serializedPlayers = await readFile(join(outDir, "players.json"), "utf8");
    expect(serializedPlayers).not.toContain("realRef");
    expect(serializedPlayers).not.toContain("real_ref");
    const report = await readFile(
      join(outDir, "reports", "name-mutations.csv"),
      "utf8",
    );
    const reportLines = report.trim().split("\n");
    expect(reportLines).toHaveLength(61);
    expect(reportLines[0]).toContain("public_name");
    const crest = await readFile(
      join(outDir, "assets", "crests", "northbridge-athletic.svg"),
      "utf8",
    );
    expect(crest).toContain("<svg");
    expect(crest).toContain("Northbridge Athletic");
  });

  it("is byte-deterministic for the same input and reference date", async () => {
    const a = await tempDir();
    const b = await tempDir();
    await buildDataset({ outDir: a, generateAssets: true });
    await buildDataset({ outDir: b, generateAssets: true });
    for (const file of [
      "leagues.json",
      "teams.json",
      "players.json",
      "nations.json",
      "manifest.json",
      "reports/name-mutations.csv",
      "assets/crests/riverside-rovers.svg",
      "assets/faces/nbr-p01.svg",
    ]) {
      expect(await readFile(join(a, file), "utf8")).toBe(
        await readFile(join(b, file), "utf8"),
      );
    }
  });

  it("can rename clubs without changing team IDs or crest identity", async () => {
    const outDir = await tempDir();
    const result = await buildDataset({
      outDir,
      generateAssets: true,
      renameClubs: true,
    });
    const names = result.bundle.teams.map((team) => team.name);
    expect(names.every((name) => !["Northbridge Athletic", "Riverside Rovers", "Kingsport United"].includes(name))).toBe(true);
    expect(new Set(names).size).toBe(3);
    expect(result.bundle.teams.map((team) => team.id).sort()).toEqual([
      "kingsport-united",
      "northbridge-athletic",
      "riverside-rovers",
    ]);
    const renamed = result.bundle.teams[0]!;
    const crest = await readFile(join(outDir, renamed.crest), "utf8");
    expect(crest).toContain(renamed.name);
  });
});
