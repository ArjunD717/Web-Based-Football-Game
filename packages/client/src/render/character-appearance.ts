// packages/client/src/render/character-appearance.ts

import { VISUAL_TUNING } from "./visualTuning";

export interface AuthoredAppearance {
  readonly skin: string;
  readonly boots: string;
}

/** Small FNV-1a variant used only for stable, presentation-only variation. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function pick(values: readonly string[], seed: string, salt: string): string {
  const value = values[hash(`${salt}:${seed}`) % values.length];
  if (value === undefined) {
    throw new Error("Authored appearance palette must not be empty");
  }
  return value;
}

/**
 * Stable per-player appearance. The seed must be based on identity, never on
 * frame time or an RNG, so a reconnect or replay renders the same player.
 */
export function appearanceFor(seed: string): AuthoredAppearance {
  const palette = VISUAL_TUNING.authoredPlayer.appearance;
  return {
    skin: pick(palette.skinTones, seed, "skin"),
    boots: pick(palette.bootColors, seed, "boots"),
  };
}
