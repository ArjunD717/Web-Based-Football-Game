// packages/data-tools/src/normalise.test.ts

import { FORMATION_NAMES } from "@fb/shared";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readInputDataset } from "./input";
import { assertValidBundle, parseBundle } from "./validate-data";
import { buildDefaultSheet, buildTeamData } from "./sheet";
import { mutateNames, normalizeName } from "./names";
import { normaliseDataset } from "./normalise";

const sampleDir = fileURLToPath(
  new URL("../../../data/input/sample", import.meta.url),
);

async function loadSample() {
  const raw = await readInputDataset(sampleDir);
  return { raw, normalised: normaliseDataset(raw, "2026-07-01") };
}

describe("input normalisation", () => {
  it("keeps detailed stats unchanged and derives missing face stats", async () => {
    const { raw, normalised } = await loadSample();
    expect(normalised.sample).toBe(true);
    expect(normalised.leagues).toHaveLength(1);
    expect(normalised.clubs).toHaveLength(3);
    expect(normalised.players).toHaveLength(60);
    expect(normalised.nations).toHaveLength(5);
    const keeper = normalised.players.find(
      (player) => player.data.positions.includes("GK"),
    );
    expect(keeper?.data.goalkeeper).not.toBeNull();
    expect(keeper?.data.faceStats.PAC).toBeGreaterThan(0);
    expect(keeper?.faceStatsDerived).toBe(true);
    expect("realRef" in (keeper?.data ?? {})).toBe(false);
    expect(keeper?.realRef).toContain("fake-sample");
    const firstSource = normalised.players[0];
    expect(firstSource).toBeDefined();
    expect(firstSource?.data.attributes.sprintSpeed).toBe(
      Number(
        raw.players.find(
          (row) => row.player_id === firstSource?.data.id,
        )?.sprint_speed,
      ),
    );
    for (const player of normalised.players) {
      expect(player.data.positions).toContain(player.data.preferredPosition);
      expect(player.data.name).toBe(player.realName);
      if (player.data.positions.includes("GK")) {
        expect(player.data.goalkeeper).not.toBeNull();
      } else {
        expect(player.data.goalkeeper).toBeNull();
      }
    }
  });

  it("builds squads, leagues and default sheets from the sample", async () => {
    const { normalised } = await loadSample();
    for (const league of normalised.leagues) {
      expect(league.clubIds).toHaveLength(3);
    }
    for (const club of normalised.clubs) {
      expect(club.squad).toHaveLength(20);
      expect(club.squad.filter((id) => {
        const player = normalised.players.find((entry) => entry.data.id === id);
        return player?.data.positions.includes("GK") === true;
      })).toHaveLength(3);
      const team = buildTeamData(club, normalised.players, true);
      expect(team.defaultSheet.startingXI).toHaveLength(11);
      expect(team.defaultSheet.bench).toHaveLength(7);
      expect(team.defaultSheet.reserves).toHaveLength(2);
      expect(new Set([
        ...team.defaultSheet.startingXI.map((slot) => slot.playerId),
        ...team.defaultSheet.bench,
        ...team.defaultSheet.reserves,
      ]).size).toBe(20);
    }
  });

  it("rejects duplicate kit numbers inside a club", async () => {
    const { raw } = await loadSample();
    const first = raw.players[0]!;
    const second = raw.players[1]!;
    const players = raw.players.map((player, index) =>
      index === 1
        ? { ...second, kit_number: first.kit_number ?? "" }
        : player,
    );
    const broken = { ...raw, players };
    expect(() => normaliseDataset(broken, "2026-07-01")).toThrow(
      /duplicate kit number/,
    );
  });

  it("rejects age/dob mismatches and accepts every documented formation", async () => {
    const { raw } = await loadSample();
    const first = raw.players[0]!;
    const badAge = {
      ...raw,
      players: raw.players.map((player, index) =>
        index === 0 ? { ...first, age: "49" } : player,
      ),
    };
    expect(() => normaliseDataset(badAge, "2026-07-01")).toThrow(
      /does not match dob/,
    );

    const clubs = raw.clubs.map((club, index) =>
      index === 0 ? { ...club, formation: "4-4-2" } : club,
    );
    const changed = normaliseDataset({ ...raw, clubs }, "2026-07-01");
    expect(
      changed.clubs.find((club) => club.id === "northbridge-athletic")
        ?.formation,
    ).toBe("4-4-2");

    const clubPlayers = changed.players
      .filter((player) => player.data.clubId === "northbridge-athletic")
      .map((player) => player.data);
    for (const formation of FORMATION_NAMES) {
      const generated = buildDefaultSheet(clubPlayers, formation);
      expect(generated.sheet.formation).toBe(formation);
      expect(generated.sheet.startingXI).toHaveLength(11);
      expect(
        generated.sheet.startingXI.filter((slot) => slot.role === "GK"),
      ).toHaveLength(1);
      expect(generated.sheet.bench).toHaveLength(7);
      expect(generated.used).toHaveLength(20);
    }
    const sheet = buildDefaultSheet(clubPlayers, "4-4-2");
    expect(
      sheet.sheet.startingXI.filter((slot) => slot.role === "ST"),
    ).toHaveLength(2);
  });

  it("rejects a club without two goalkeepers", async () => {
    const { raw } = await loadSample();
    const players = raw.players.map((player) => {
      if (player.club_id !== "northbridge-athletic" || !player.positions?.includes("GK")) {
        return player;
      }
      return {
        ...player,
        positions: "CB",
        preferred_position: "CB",
        gk_diving: "",
        gk_handling: "",
        gk_kicking: "",
        gk_positioning: "",
        gk_reflexes: "",
        gk_speed: "",
      };
    });
    expect(() =>
      normaliseDataset({ ...raw, players }, "2026-07-01"),
    ).toThrow(/needs at least two goalkeepers/);
  });

  it("produces schema-valid, unique public names", async () => {
    const { raw, normalised } = await loadSample();
    const mutations = mutateNames(
      normalised.players.map((player) => ({
        id: player.data.id,
        realName: player.realName,
      })),
      {
        forbiddenNames: new Set(
          normalised.players.map((player) => normalizeName(player.realName)),
        ),
        overrides: raw.overrides,
      },
    );
    expect(mutations).toHaveLength(60);
    expect(new Set(mutations.map((entry) => normalizeName(entry.name))).size).toBe(60);
    expect(mutations.some((entry) => entry.strategy === "override")).toBe(true);
    expect(mutations.some((entry) => entry.strategy === "cluster")).toBe(true);
    const built = buildTeamData(
      normalised.clubs[0]!,
      normalised.players,
      true,
    );
    expect(() =>
      assertValidBundle(
        parseBundle({
          manifest: {
            schemaVersion: 1,
            sample: true,
            leagues: 1,
            teams: 3,
            players: 60,
            nations: 5,
            leagueIds: ["sample-league"],
            teamIds: ["northbridge-athletic"],
          },
          leagues: normalised.leagues,
          teams: [built],
          players: normalised.players.map((player) => player.data),
          nations: normalised.nations,
        }),
      ),
    ).toThrow(/failed cross-file validation/);
  });
});
