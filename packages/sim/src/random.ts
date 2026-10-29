// packages/sim/src/random.ts
import { createRng, type Rng } from "@fb/shared";
import type { TeamSide } from "./types";

const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const HOME_SALT = 0x9e3779b9;
const AWAY_SALT = 0x85ebca6b;

/** Stable 32-bit mix used for ratings and per-decision RNG streams. */
export function mixSeeds(...values: readonly number[]): number {
  let hash = FNV_OFFSET;
  for (const value of values) {
    hash ^= value >>> 0;
    hash = Math.imul(hash, FNV_PRIME);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

/**
 * Stateless decision randomness: the seed is derived from match seed, tick and
 * player identity, so no mutable RNG state has to enter snapshots or replays.
 */
export function decisionRng(
  seed: number,
  tick: number,
  side: TeamSide,
  playerNumber: number,
): Rng {
  return createRng(
    mixSeeds(
      seed,
      tick,
      side === "home" ? HOME_SALT : AWAY_SALT,
      playerNumber,
      0x27d4eb2d,
    ),
  );
}

/** Separate deterministic stream for referee contacts (handball, deflections). */
export function eventRng(
  seed: number,
  tick: number,
  salt: number,
): Rng {
  return createRng(mixSeeds(seed, tick, salt, 0x165667b1));
}
