// packages/sim/src/rules/offside.ts
import type {
  AttackDirection,
  Pitch,
} from "../types";

export interface OffsideActor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly sentOff?: boolean;
}

/**
 * x-coordinate of the second-last defender measured toward the attacking goal.
 * With fewer than two defenders the goal line is the second-last line.
 */
export function secondLastDefenderLine(
  pitch: Pitch,
  defenders: readonly OffsideActor[],
  attackDirection: AttackDirection,
): number {
  const active = defenders.filter((defender) => defender.sentOff !== true);
  if (active.length < 2) {
    return attackDirection === 1 ? pitch.lengthM : 0;
  }
  const sorted = active.map((defender) => defender.x).sort(
    (a, b) => (attackDirection === 1 ? b - a : a - b),
  );
  return sorted[1]!;
}

export function isOffsidePosition(
  pitch: Pitch,
  player: OffsideActor,
  ballX: number,
  attackDirection: AttackDirection,
  secondLastX: number,
): boolean {
  if (player.sentOff === true) {
    return false;
  }
  const inOpponentHalf =
    (player.x - pitch.centreX) * attackDirection > 0;
  const aheadOfBall = (player.x - ballX) * attackDirection > 0;
  const beyondSecondLast =
    (player.x - secondLastX) * attackDirection > 0;
  return inOpponentHalf && aheadOfBall && beyondSecondLast;
}

export function offsidePlayersAtKick(
  pitch: Pitch,
  attackers: readonly OffsideActor[],
  defenders: readonly OffsideActor[],
  kickerId: string,
  ballX: number,
  attackDirection: AttackDirection,
): string[] {
  const secondLastX = secondLastDefenderLine(
    pitch,
    defenders,
    attackDirection,
  );
  const flagged: string[] = [];
  for (const attacker of attackers) {
    if (attacker.id === kickerId || attacker.sentOff === true) {
      continue;
    }
    if (
      isOffsidePosition(
        pitch,
        attacker,
        ballX,
        attackDirection,
        secondLastX,
      )
    ) {
      flagged.push(attacker.id);
    }
  }
  return flagged;
}
