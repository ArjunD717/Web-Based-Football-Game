// packages/data-tools/src/attributes.ts

import { TUNING, clamp } from "@fb/shared";
import type {
  DetailedAttributes,
  FaceStats,
  GoalkeeperAttributes,
  PlayerData,
  PlayerPosition,
} from "@fb/shared";

function rated(value: number): number {
  return clamp(Math.round(value), 1, 99);
}

/**
 * Derive the six consumer-facing face ratings when a source CSV omits them.
 * Detailed attributes are never modified.
 */
export function deriveFaceStats(attributes: DetailedAttributes): FaceStats {
  const w = TUNING.data.faceStats;
  return {
    PAC: rated(
      attributes.sprintSpeed * w.PAC.sprintSpeed +
        attributes.acceleration * w.PAC.acceleration +
        attributes.reactions * w.PAC.reactions,
    ),
    SHO: rated(
      attributes.finishing * w.SHO.finishing +
        attributes.shotPower * w.SHO.shotPower +
        attributes.longShots * w.SHO.longShots +
        attributes.volleys * w.SHO.volleys +
        attributes.penalties * w.SHO.penalties,
    ),
    PAS: rated(
      attributes.shortPassing * w.PAS.shortPassing +
        attributes.vision * w.PAS.vision +
        attributes.crossing * w.PAS.crossing +
        attributes.longPassing * w.PAS.longPassing +
        attributes.fkAccuracy * w.PAS.fkAccuracy +
        attributes.curve * w.PAS.curve,
    ),
    DRI: rated(
      attributes.dribbling * w.DRI.dribbling +
        attributes.ballControl * w.DRI.ballControl +
        attributes.agility * w.DRI.agility +
        attributes.balance * w.DRI.balance +
        attributes.reactions * w.DRI.reactions +
        attributes.composure * w.DRI.composure,
    ),
    DEF: rated(
      attributes.interceptions * w.DEF.interceptions +
        attributes.headingAccuracy * w.DEF.headingAccuracy +
        attributes.defAwareness * w.DEF.defAwareness +
        attributes.standingTackle * w.DEF.standingTackle +
        attributes.slidingTackle * w.DEF.slidingTackle,
    ),
    PHY: rated(
      attributes.jumping * w.PHY.jumping +
        attributes.stamina * w.PHY.stamina +
        attributes.strength * w.PHY.strength +
        attributes.aggression * w.PHY.aggression,
    ),
  };
}

/** GK cards keep the outfield face ratings; the detailed GK block is separate. */
export function describeGoalkeeper(
  goalkeeper: GoalkeeperAttributes | null,
): string {
  return goalkeeper === null
    ? "outfield"
    : `GK ${goalkeeper.diving}/${goalkeeper.handling}/${goalkeeper.kicking}`;
}

export function isGoalkeeperPosition(position: PlayerPosition): boolean {
  return position === "GK";
}

/** Guard against accidentally treating an outfield player as a keeper. */
export function isGoalkeeper(player: PlayerData): boolean {
  return player.positions.includes("GK");
}
