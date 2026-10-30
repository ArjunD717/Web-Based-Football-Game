// packages/sim/src/placeholder.ts
import {
  clamp,
  createDefaultTactics,
  createRng,
  type Rng,
} from "@fb/shared";
import {
  FORMATION_433,
  baseFormationPosition,
  validateFormation,
} from "./formations";
import { mixSeeds } from "./random";
import type {
  FormationSlot,
  Pitch,
  PlayerAttributes,
  PlayerRole,
  PlayerState,
  TeamColors,
  TeamSetup,
  TeamSide,
  TeamState,
} from "./types";

/**
 * Clearly labelled placeholder squads for M1. No real player or club data is
 * used; the M6 pipeline imports generated squads, and selection arrives in M9.
 */
const DEFAULT_COLORS: Record<TeamSide, TeamColors> = {
  home: {
    primary: "#2f6bff",
    secondary: "#dce7ff",
    keeper: "#f2c94c",
  },
  away: {
    primary: "#e95252",
    secondary: "#ffe1e1",
    keeper: "#9be564",
  },
};

const DEFAULT_NAMES: Record<TeamSide, string> = {
  home: "Home XI",
  away: "Away XI",
};

const ROLE_BASE_RATING: Readonly<Record<PlayerRole, number>> = {
  GK: 68,
  RB: 75,
  CB: 74,
  LB: 75,
  CDM: 76,
  CM: 78,
  CAM: 79,
  RM: 77,
  LM: 77,
  RW: 80,
  LW: 80,
  CF: 81,
  ST: 82,
};

export function createPlaceholderTeam(
  side: TeamSide,
  seed: number,
  pitch: Pitch,
  setup: TeamSetup = {},
): TeamState {
  const formation = setup.formation ?? FORMATION_433;
  validateFormation(formation);

  const teamSeed = mixSeeds(
    seed,
    side === "home" ? 0x1a2b3c4d : 0x5e6f7a8b,
    0x1234abcd,
  );
  const players = formation.slots.map((slot, index) =>
    createPlaceholderPlayer({
      side,
      index,
      slot,
      seed: teamSeed,
      pitch,
    }),
  );

  return {
    side,
    name: setup.name ?? DEFAULT_NAMES[side],
    colors: setup.colors ?? DEFAULT_COLORS[side],
    formation,
    tactics: createDefaultTactics(),
    takers: {
      penalty: null,
      freeKick: null,
      cornerLeft: null,
      cornerRight: null,
    },
    attackDirection: side === "home" ? 1 : -1,
    players,
    bench: [],
    substitutionsUsed: 0,
    substitutionWindowsUsed: 0,
    substitutionWindowUsed: false,
  };
}

interface CreatePlayerArgs {
  readonly side: TeamSide;
  readonly index: number;
  readonly slot: FormationSlot;
  readonly seed: number;
  readonly pitch: Pitch;
}

function createPlaceholderPlayer(args: CreatePlayerArgs): PlayerState {
  const { side, index, slot, seed, pitch } = args;
  const number = index + 1;
  const rng = createRng(mixSeeds(seed, number, 0x7f4a7c15));
  const base = ROLE_BASE_RATING[slot.role];
  const position = baseFormationPosition(pitch, side, slot);

  return {
    id: `${side}-${number}`,
    name: `${DEFAULT_NAMES[side]} #${number}`,
    team: side,
    role: slot.role,
    number,
    attributes: createAttributes(rng, slot.role, base),
    roleFamiliarity: 1,
    formationX: slot.x,
    formationY: slot.y,
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    facing: side === "home" ? 0 : Math.PI,
    state: "idle",
    actionTimer: 0,
    kickCooldown: 0,
    stamina: 1,
    yellowCards: 0,
    sentOff: false,
    unavailable: false,
    injury: null,
    isUserControlled: false,
    targetX: position.x,
    targetY: position.y,
    targetSpeed: 0,
  };
}

function createAttributes(
  rng: Rng,
  role: PlayerRole,
  base: number,
): PlayerAttributes {
  const rating = (offset: number): number =>
    Math.round(clamp(base + offset + rng.int(-5, 6), 1, 99));
  const defender =
    role === "CB" ||
    role === "RB" ||
    role === "LB" ||
    role === "CDM";
  const attacker =
    role === "RW" ||
    role === "LW" ||
    role === "CF" ||
    role === "ST";
  const central =
    role === "CB" || role === "CDM" || role === "CM" || role === "ST";
  const keeper = role === "GK";
  const technical = keeper ? -18 : attacker ? 4 : 0;
  const defending = keeper ? -30 : defender ? 5 : attacker ? -9 : 0;
  const physical = keeper ? -8 : defender ? 4 : 0;

  return {
    sprintSpeed: rating(keeper ? -12 : 0),
    acceleration: rating(keeper ? -7 : 0),
    agility: rating(keeper ? -4 : 0),
    stamina: rating(keeper ? -4 : 0),
    ballControl: rating(keeper ? -6 : 0),
    standingTackle: rating(defending),
    slidingTackle: rating(keeper ? -32 : defending - 1),
    aggression: rating(defender ? 5 : attacker ? -3 : 0),
    balance: rating(keeper ? 4 : attacker ? 3 : 0),
    strength: rating(physical),
    finishing: rating(keeper ? -32 : attacker ? 6 : defender ? -12 : -3),
    shotPower: rating(keeper ? -28 : attacker ? 6 : defender ? -8 : 0),
    longShots: rating(keeper ? -32 : attacker ? 3 : defender ? -14 : -2),
    attPosition: rating(keeper ? -30 : attacker ? 7 : defender ? -8 : 0),
    shortPassing: rating(technical),
    vision: rating(keeper ? -20 : central ? 3 : 0),
    crossing: rating(keeper ? -24 : role === "RW" || role === "LW" ? 8 : 0),
    longPassing: rating(keeper ? 4 : central ? 2 : 0),
    curve: rating(keeper ? -20 : 0),
    dribbling: rating(keeper ? -20 : attacker ? 6 : 0),
    reactions: rating(keeper ? 4 : 0),
    composure: rating(keeper ? 2 : attacker ? 2 : 0),
    interceptions: rating(keeper ? -30 : defender ? 5 : attacker ? -8 : 0),
    headingAccuracy: rating(keeper ? -30 : role === "CB" ? 7 : 0),
    defAwareness: rating(keeper ? -24 : defender ? 6 : attacker ? -10 : 0),
    jumping: rating(keeper ? 3 : role === "CB" ? 5 : 0),
    skillMoves: role === "GK" ? 1 : rng.int(2, Math.max(2, Math.round(base / 25))),
    weakFoot: rng.int(2, 5),
    goalkeeper: keeper
      ? {
          diving: rating(4),
          handling: rating(4),
          kicking: rating(2),
          positioning: rating(3),
          reflexes: rating(3),
          speed: rating(0),
        }
      : null,
  };
}
