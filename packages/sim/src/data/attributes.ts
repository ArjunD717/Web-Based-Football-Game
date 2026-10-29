// packages/sim/src/data/attributes.ts

import { TUNING, clamp } from "@fb/shared";
import type { PlayerData } from "@fb/shared";
import type { PlayerAttributes } from "../types";

function rating(value: number): number {
  return clamp(Math.round(value), 1, 99);
}

function blend(
  ...pairs: readonly (readonly [value: number, weight: number])[]
): number {
  let total = 0;
  let weight = 0;
  for (const [value, pairWeight] of pairs) {
    total += value * pairWeight;
    weight += pairWeight;
  }
  return rating(weight === 0 ? 1 : total / weight);
}

/**
 * Convert the full imported attribute set into the compact ratings consumed by
 * the simulation. Physical mappings are blended so related skills still
 * influence the same movement and contact model.
 */
export function mapPlayerAttributes(player: PlayerData): PlayerAttributes {
  const a = player.attributes;
  const weights = TUNING.data.simAttributes;
  return {
    sprintSpeed: a.sprintSpeed,
    acceleration: blend(
      [a.acceleration, weights.acceleration.acceleration],
      [a.sprintSpeed, weights.acceleration.sprintSpeed],
    ),
    agility: blend(
      [a.agility, weights.agility.agility],
      [a.balance, weights.agility.balance],
      [a.reactions, weights.agility.reactions],
    ),
    stamina: a.stamina,
    ballControl: blend(
      [a.ballControl, weights.ballControl.ballControl],
      [a.dribbling, weights.ballControl.dribbling],
      [a.composure, weights.ballControl.composure],
    ),
    standingTackle: blend(
      [a.standingTackle, weights.standingTackle.standingTackle],
      [a.defAwareness, weights.standingTackle.defAwareness],
      [a.interceptions, weights.standingTackle.interceptions],
    ),
    slidingTackle: blend(
      [a.slidingTackle, weights.slidingTackle.slidingTackle],
      [a.defAwareness, weights.slidingTackle.defAwareness],
      [a.interceptions, weights.slidingTackle.interceptions],
    ),
    aggression: a.aggression,
    balance: blend(
      [a.balance, weights.balance.balance],
      [a.strength, weights.balance.strength],
      [a.agility, weights.balance.agility],
    ),
    strength: a.strength,
  };
}
