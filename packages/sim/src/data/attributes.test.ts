// packages/sim/src/data/attributes.test.ts

import {
  FORMATION_NAMES,
  type DetailedAttributes,
  type PlayerData,
  type TeamData,
} from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createPitch } from "../pitch";
import { topSpeedFor } from "../physics/players";
import {
  createTeamFromData,
  formationForName,
  mapPlayerAttributes,
} from "../index";

const attributes: DetailedAttributes = {
  acceleration: 80,
  sprintSpeed: 90,
  finishing: 70,
  shotPower: 74,
  longShots: 66,
  volleys: 62,
  penalties: 68,
  attPosition: 70,
  shortPassing: 72,
  vision: 68,
  crossing: 64,
  longPassing: 70,
  fkAccuracy: 60,
  curve: 66,
  dribbling: 70,
  agility: 70,
  balance: 60,
  reactions: 50,
  ballControl: 80,
  composure: 60,
  interceptions: 70,
  headingAccuracy: 64,
  defAwareness: 65,
  standingTackle: 75,
  slidingTackle: 80,
  jumping: 68,
  stamina: 76,
  strength: 72,
  aggression: 55,
};

function player(
  id: string,
  kitNumber: number,
  roles: PlayerData["positions"],
): PlayerData {
  const isKeeper = roles.includes("GK");
  const preferredPosition = roles[0];
  if (preferredPosition === undefined) {
    throw new Error("player fixture needs at least one position");
  }
  return {
    id,
    name: `Sample ${id}`,
    age: 24,
    dob: "2002-01-01",
    nationId: "sampleland",
    clubId: "sample-club",
    positions: roles,
    preferredPosition,
    overall: 75,
    potential: 80,
    faceStats: { PAC: 80, SHO: 70, PAS: 72, DRI: 74, DEF: 60, PHY: 70 },
    attributes,
    goalkeeper: isKeeper
      ? {
          diving: 75,
          handling: 74,
          kicking: 70,
          positioning: 73,
          reflexes: 76,
          speed: 60,
        }
      : null,
    skillMoves: 3,
    weakFoot: 3,
    workRate: { att: "medium", def: "medium" },
    playStyles: [],
    foot: "right",
    heightCm: 180,
    weightKg: 75,
    bodyType: "average",
    injuryProneness: 40,
    kitNumber,
    face: `assets/faces/${id}.svg`,
    sample: true,
  };
}

const roles = [
  "GK",
  "RB",
  "CB",
  "CB",
  "LB",
  "CDM",
  "CM",
  "CM",
  "RW",
  "ST",
  "LW",
] as const;

function team(): TeamData {
  const players = roles.map((role, index) =>
    player(`p${index + 1}`, index + 1, [role]),
  );
  return {
    id: "sample-club",
    kind: "club",
    name: "Sample Club",
    short: "SMP",
    leagueId: "sample-league",
    nationId: null,
    colours: {
      home: "#112233",
      away: "#ffffff",
      third: "#ffcc00",
      goalkeeper: "#00ff00",
    },
    stadium: "Sample Ground",
    managerName: "Sample Manager",
    crest: "assets/crests/sample-club.svg",
    kits: {
      home: "assets/kits/sample-club-home.svg",
      away: "assets/kits/sample-club-away.svg",
      third: "assets/kits/sample-club-third.svg",
    },
    squad: players.map((entry) => entry.id),
    defaultSheet: {
      formation: "4-3-3",
      kit: "home",
      startingXI: players.map((entry, index) => ({
        slot: index,
        role: roles[index]!,
        playerId: entry.id,
      })),
      bench: [],
      reserves: [],
      captain: "p10",
      penaltyTaker: "p10",
      freeKickTaker: "p7",
      cornerLeft: "p9",
      cornerRight: "p11",
      tactics: {
        defensiveDepth: 50,
        width: 55,
        pressIntensity: "medium",
        buildUpStyle: "balanced",
      },
    },
    sample: true,
  };
}

describe("attribute mapping", () => {
  it("blends related detailed attributes into the compact sim ratings", () => {
    const mapped = mapPlayerAttributes(player("p1", 1, ["ST"]));
    expect(mapped).toEqual({
      sprintSpeed: 90,
      acceleration: 82,
      agility: 65,
      stamina: 76,
      ballControl: 75,
      standingTackle: 73,
      slidingTackle: 76,
      aggression: 55,
      balance: 63,
      strength: 72,
      finishing: 70,
      shotPower: 74,
      longShots: 66,
      attPosition: 70,
      shortPassing: 72,
      vision: 68,
      crossing: 64,
      longPassing: 70,
      curve: 66,
      dribbling: 70,
      reactions: 50,
      composure: 60,
      interceptions: 70,
      headingAccuracy: 64,
      defAwareness: 65,
      jumping: 68,
      skillMoves: 3,
      weakFoot: 3,
      goalkeeper: null,
    });
    expect(topSpeedFor(mapped)).toBeCloseTo(10.2545, 3);
  });

  it("builds a playable home XI from a generated sheet", () => {
    const dataTeam = team();
    const players = new Map(
      roles.map((role, index) => {
        const entry = player(`p${index + 1}`, index + 1, [role]);
        return [entry.id, entry] as const;
      }),
    );
    const state = createTeamFromData({
      side: "home",
      pitch: createPitch(),
      team: dataTeam,
      players,
    });
    expect(state.name).toBe("Sample Club");
    expect(state.colors).toEqual({
      primary: "#112233",
      secondary: "#ffffff",
      keeper: "#00ff00",
    });
    expect(state.players).toHaveLength(11);
    expect(state.players[0]?.role).toBe("GK");
    expect(state.players[0]?.id).toBe("home:p1");
    expect(state.players[0]?.number).toBe(1);
    expect(state.players.filter((entry) => entry.role === "GK")).toHaveLength(1);
    expect(state.attackDirection).toBe(1);
    expect(state.players.every((entry) => entry.sentOff === false)).toBe(true);
  });

  it("maps every shared formation into the simulation", () => {
    for (const name of FORMATION_NAMES) {
      const formation = formationForName(name);
      expect(formation.name).toBe(name);
      expect(formation.slots).toHaveLength(11);
      expect(formation.slots.filter((slot) => slot.role === "GK")).toHaveLength(
        1,
      );
    }
  });

  it("rejects mismatched sheet roles", () => {
    const dataTeam = team();
    const players = new Map(
      roles.map((role, index) => {
        const entry = player(`p${index + 1}`, index + 1, [role]);
        return [entry.id, entry] as const;
      }),
    );
    const swapped = {
      ...dataTeam,
      defaultSheet: {
        ...dataTeam.defaultSheet,
        startingXI: dataTeam.defaultSheet.startingXI.map((slot, index) =>
          index === 0 ? { ...slot, role: "CB" as const } : slot,
        ),
      },
    };
    expect(() =>
      createTeamFromData({
        side: "home",
        pitch: createPitch(),
        team: swapped,
        players,
      }),
    ).toThrow(/expected GK/);
  });
});
