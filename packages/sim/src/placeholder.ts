// packages/sim/src/placeholder.ts
import { clamp, createRng, type Rng } from "@fb/shared";
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
    attackDirection: side === "home" ? 1 : -1,
    players,
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
    team: side,
    role: slot.role,
    number,
    attributes: createAttributes(rng, slot.role, base),
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

  if (role === "GK") {
    return {
      sprintSpeed: rating(-12),
      acceleration: rating(-7),
      agility: rating(-4),
      stamina: rating(-4),
      ballControl: rating(-6),
      standingTackle: rating(-30),
      slidingTackle: rating(-32),
      aggression: rating(-12),
      balance: rating(4),
      strength: rating(5),
    };
  }

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

  return {
    sprintSpeed: rating(0),
    acceleration: rating(0),
    agility: rating(0),
    stamina: rating(0),
    ballControl: rating(0),
    standingTackle: rating(defender ? 5 : attacker ? -9 : 0),
    slidingTackle: rating(defender ? 4 : attacker ? -10 : 0),
    aggression: rating(defender ? 5 : attacker ? -3 : 0),
    balance: rating(attacker ? 3 : 0),
    strength: rating(defender ? 4 : 0),
  };
}
