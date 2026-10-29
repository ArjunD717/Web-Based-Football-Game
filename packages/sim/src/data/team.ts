// packages/sim/src/data/team.ts
import type { PlayerData, TeamData, TeamSheet } from "@fb/shared";
import {
  baseFormationPosition,
  formationForName,
  validateFormation,
} from "../formations";
import type {
  Pitch,
  PlayerState,
  TeamSide,
  TeamState,
} from "../types";
import type { PlayerRole } from "../types";
import { mapPlayerAttributes } from "./attributes";

export interface CreateTeamFromDataOptions {
  readonly side: TeamSide;
  readonly pitch: Pitch;
  readonly team: TeamData;
  /** Full player records indexed by ID; only the starting XI is placed. */
  readonly players: ReadonlyMap<string, PlayerData>;
  /** Server-authoritative draft; defaults to the generated team sheet. */
  readonly sheet?: TeamSheet;
}

function simRole(role: string): PlayerRole {
  switch (role) {
    case "GK":
    case "RB":
    case "CB":
    case "LB":
    case "CDM":
    case "CM":
    case "CAM":
    case "RM":
    case "LM":
    case "RW":
    case "LW":
    case "CF":
    case "ST":
      return role;
    case "RWB":
      return "RB";
    case "LWB":
      return "LB";
    default:
      throw new Error(`unsupported formation role "${role}"`);
  }
}

/**
 * Build a playable XI from generated team data. Bench/reserve handling belongs
 * to the match-management milestone; this factory places exactly the starting
 * sheet so the sim's 11v11 contracts stay intact.
 */
export function createTeamFromData(
  options: CreateTeamFromDataOptions,
): TeamState {
  const { side, pitch, team, players } = options;
  const sheet = options.sheet ?? team.defaultSheet;
  const formation = formationForName(sheet.formation);
  validateFormation(formation);

  const starters = sheet.startingXI;
  if (starters.length !== 11) {
    throw new Error(`${team.id} must name exactly eleven starters`);
  }
  const seen = new Set<string>();
  const playerStates: PlayerState[] = starters.map((slot, index) => {
    const formationSlot = formation.slots[index];
    if (formationSlot === undefined) {
      throw new Error(`${team.id}: missing formation slot ${index}`);
    }
    if (simRole(slot.role) !== formationSlot.role) {
      throw new Error(
        `${team.id}: slot ${index} is ${slot.role}, expected ${formationSlot.role}`,
      );
    }
    if (seen.has(slot.playerId)) {
      throw new Error(`${team.id}: duplicate starter ${slot.playerId}`);
    }
    seen.add(slot.playerId);
    const player = players.get(slot.playerId);
    if (player === undefined) {
      throw new Error(`${team.id}: missing player ${slot.playerId}`);
    }
    if (slot.role === "GK" && !player.positions.includes("GK")) {
      throw new Error(`${team.id}: ${player.id} is not a goalkeeper`);
    }
    if (slot.role !== "GK" && player.positions.includes("GK")) {
      throw new Error(`${team.id}: goalkeeper ${player.id} is an outfielder slot`);
    }
    if (player.clubId !== team.id) {
      throw new Error(`${team.id}: ${player.id} belongs to ${player.clubId}`);
    }

    const position = baseFormationPosition(pitch, side, formationSlot);
    return {
      id: `${side}:${player.id}`,
      team: side,
      role: formationSlot.role,
      number: player.kitNumber,
      attributes: mapPlayerAttributes(player),
      formationX: formationSlot.x,
      formationY: formationSlot.y,
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
  });

  return {
    side,
    name: team.name,
    colors: {
      primary:
        sheet.kit === "away"
          ? team.colours.away
          : sheet.kit === "third"
            ? team.colours.third
            : team.colours.home,
      secondary:
        sheet.kit === "away" ? team.colours.home : team.colours.away,
      keeper: team.colours.goalkeeper,
    },
    formation,
    attackDirection: side === "home" ? 1 : -1,
    players: playerStates,
  };
}
