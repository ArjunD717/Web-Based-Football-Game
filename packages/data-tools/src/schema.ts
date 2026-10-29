// packages/data-tools/src/schema.ts

import {
  BODY_TYPES,
  BUILD_UP_STYLES,
  FORMATION_NAMES,
  KIT_CHOICES,
  PLAYER_POSITIONS,
  PREFERRED_FEET,
  PRESS_INTENSITIES,
  WORK_RATES,
} from "@fb/shared";
import type {
  DataManifest,
  DetailedAttributes,
  FaceStats,
  GoalkeeperAttributes,
  LeagueData,
  NationData,
  PlayerData,
  TeamColours,
  TeamData,
  TeamSheet,
} from "@fb/shared";
import { z } from "zod";

export const DATA_SCHEMA_VERSION = 2;

const rating = z.number().int().min(1).max(99);
const shortText = z.string().trim().min(1).max(80);
const id = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "IDs must be lowercase kebab-case");
const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours must be #RRGGBB");
const relativeAsset = z
  .string()
  .trim()
  .regex(/^assets\/[a-z0-9/_-]+\.svg$/, "Assets must be generated SVG paths");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Invalid calendar date",
  });

export const FaceStatsSchema: z.ZodType<FaceStats> = z
  .object({
    PAC: rating,
    SHO: rating,
    PAS: rating,
    DRI: rating,
    DEF: rating,
    PHY: rating,
  })
  .strict();

export const DetailedAttributesSchema: z.ZodType<DetailedAttributes> = z
  .object({
    acceleration: rating,
    sprintSpeed: rating,
    finishing: rating,
    shotPower: rating,
    longShots: rating,
    volleys: rating,
    penalties: rating,
    attPosition: rating,
    shortPassing: rating,
    vision: rating,
    crossing: rating,
    longPassing: rating,
    fkAccuracy: rating,
    curve: rating,
    dribbling: rating,
    agility: rating,
    balance: rating,
    reactions: rating,
    ballControl: rating,
    composure: rating,
    interceptions: rating,
    headingAccuracy: rating,
    defAwareness: rating,
    standingTackle: rating,
    slidingTackle: rating,
    jumping: rating,
    stamina: rating,
    strength: rating,
    aggression: rating,
  })
  .strict();

export const GoalkeeperAttributesSchema: z.ZodType<GoalkeeperAttributes> = z
  .object({
    diving: rating,
    handling: rating,
    kicking: rating,
    positioning: rating,
    reflexes: rating,
    speed: rating,
  })
  .strict();

const workRate = z.object({ att: z.enum(WORK_RATES), def: z.enum(WORK_RATES) });

export const PlayerDataSchema: z.ZodType<PlayerData> = z
  .object({
    id,
    name: shortText,
    age: z.number().int().min(15).max(50),
    dob: isoDate,
    nationId: id,
    clubId: id,
    positions: z.array(z.enum(PLAYER_POSITIONS)).min(1).max(4),
    preferredPosition: z.enum(PLAYER_POSITIONS),
    overall: rating,
    potential: rating,
    faceStats: FaceStatsSchema,
    attributes: DetailedAttributesSchema,
    goalkeeper: GoalkeeperAttributesSchema.nullable(),
    skillMoves: z.number().int().min(1).max(5),
    weakFoot: z.number().int().min(1).max(5),
    workRate,
    playStyles: z.array(shortText).max(12),
    foot: z.enum(PREFERRED_FEET),
    heightCm: z.number().int().min(140).max(230),
    weightKg: z.number().int().min(40).max(150),
    bodyType: z.enum(BODY_TYPES),
    injuryProneness: z.number().int().min(1).max(99),
    kitNumber: z.number().int().min(1).max(99),
    face: relativeAsset,
    sample: z.boolean(),
  })
  .strict()
  .superRefine((player, ctx) => {
    if (!player.positions.includes(player.preferredPosition)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferredPosition"],
        message: "Preferred position must be one of the listed positions",
      });
    }
    if (player.potential < player.overall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["potential"],
        message: "Potential cannot be lower than overall",
      });
    }
    if (player.positions.includes("GK") !== (player.goalkeeper !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["goalkeeper"],
        message: "Goalkeeper attributes must be present for GK players only",
      });
    }
  });

export const TeamColoursSchema: z.ZodType<TeamColours> = z
  .object({
    home: colour,
    away: colour,
    third: colour,
    goalkeeper: colour,
  })
  .strict();

export const StartingSlotSchema = z
  .object({
    slot: z.number().int().min(0).max(10),
    role: z.enum(PLAYER_POSITIONS),
    playerId: id,
  })
  .strict();

export const TeamTacticsSchema = z
  .object({
    defensiveDepth: z.number().int().min(0).max(100),
    width: z.number().int().min(0).max(100),
    pressIntensity: z.enum(PRESS_INTENSITIES),
    buildUpStyle: z.enum(BUILD_UP_STYLES),
  })
  .strict();

export const TeamSheetSchema: z.ZodType<TeamSheet> = z
  .object({
    formation: z.enum(FORMATION_NAMES),
    kit: z.enum(KIT_CHOICES),
    startingXI: z.array(StartingSlotSchema).length(11),
    bench: z.array(id).min(5).max(9),
    reserves: z.array(id),
    captain: id,
    penaltyTaker: id,
    freeKickTaker: id,
    cornerLeft: id,
    cornerRight: id,
    tactics: TeamTacticsSchema,
  })
  .strict()
  .superRefine((sheet, ctx) => {
    const slots = new Set<number>();
    const starters = new Set<string>();
    let keepers = 0;
    for (const [index, entry] of sheet.startingXI.entries()) {
      if (entry.slot !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startingXI", index, "slot"],
          message: "Starting slots must be ordered from 0 to 10",
        });
      }
      if (slots.has(entry.slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startingXI", index, "slot"],
          message: "Duplicate starting slot",
        });
      }
      if (entry.role === "GK") {
        keepers += 1;
      }
      slots.add(entry.slot);
      starters.add(entry.playerId);
    }
    if (keepers !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startingXI"],
        message: "Starting XI must contain exactly one goalkeeper slot",
      });
    }
    if (starters.size !== 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startingXI"],
        message: "Starting XI must contain eleven different players",
      });
    }
    const all = new Set([...starters, ...sheet.bench, ...sheet.reserves]);
    if (all.size !== starters.size + sheet.bench.length + sheet.reserves.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bench"],
        message: "A player cannot appear in more than one squad section",
      });
    }
    for (const key of [
      "captain",
      "penaltyTaker",
      "freeKickTaker",
      "cornerLeft",
      "cornerRight",
    ] as const) {
      if (!starters.has(sheet[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be in the starting XI`,
        });
      }
    }
  });

export const TeamDataSchema: z.ZodType<TeamData> = z
  .object({
    id,
    name: shortText,
    short: z.string().trim().min(2).max(8),
    leagueId: id,
    colours: TeamColoursSchema,
    stadium: shortText,
    managerName: shortText,
    crest: relativeAsset,
    kits: z
      .object({
        home: relativeAsset,
        away: relativeAsset,
        third: relativeAsset,
      })
      .strict(),
    squad: z.array(id).min(18),
    defaultSheet: TeamSheetSchema,
    sample: z.boolean(),
  })
  .strict()
  .superRefine((team, ctx) => {
    if (new Set(team.squad).size !== team.squad.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["squad"],
        message: "Squad IDs must be unique",
      });
    }
    const sheetPlayers = [
      ...team.defaultSheet.startingXI.map((slot) => slot.playerId),
      ...team.defaultSheet.bench,
      ...team.defaultSheet.reserves,
    ];
    for (const playerId of sheetPlayers) {
      if (!team.squad.includes(playerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaultSheet"],
          message: `${playerId} is in the sheet but not the squad`,
        });
      }
    }
  });

export const LeagueDataSchema: z.ZodType<LeagueData> = z
  .object({
    id,
    country: shortText,
    name: shortText,
    tier: z.literal(1),
    clubIds: z.array(id).min(1),
    season: z.string().trim().min(4).max(20),
    sample: z.boolean(),
  })
  .strict()
  .superRefine((league, ctx) => {
    if (new Set(league.clubIds).size !== league.clubIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clubIds"],
        message: "A league cannot contain a club twice",
      });
    }
  });

export const NationDataSchema: z.ZodType<NationData> = z
  .object({
    id,
    name: shortText,
    short: z.string().trim().min(2).max(8),
    colours: TeamColoursSchema,
    squad: z.array(id).max(26),
    reserves: z.array(id),
    sample: z.boolean(),
  })
  .strict();

export const DataManifestSchema: z.ZodType<DataManifest> = z
  .object({
    schemaVersion: z.literal(DATA_SCHEMA_VERSION),
    sample: z.boolean(),
    leagues: z.number().int().nonnegative(),
    teams: z.number().int().nonnegative(),
    players: z.number().int().nonnegative(),
    nations: z.number().int().nonnegative(),
    leagueIds: z.array(id),
    teamIds: z.array(id),
  })
  .strict();

export const DataBundleSchema = z
  .object({
    manifest: DataManifestSchema,
    leagues: z.array(LeagueDataSchema),
    teams: z.array(TeamDataSchema),
    players: z.array(PlayerDataSchema),
    nations: z.array(NationDataSchema),
  })
  .strict();

export type DataBundle = z.infer<typeof DataBundleSchema>;

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}
