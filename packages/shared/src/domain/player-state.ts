// packages/shared/src/domain/player-state.ts

/** Canonical player-state vocabulary shared by sim, wire codec and renderer. */
export const PLAYER_STATE_CODES = [
  "idle",
  "jog",
  "sprint",
  "dribble",
  "pass",
  "shoot",
  "header",
  "volley",
  "tackle",
  "slide",
  "fall",
  "injured",
  "celebrate",
] as const;

export type PlayerStateName = (typeof PLAYER_STATE_CODES)[number];

export function playerStateCode(state: PlayerStateName): number {
  return PLAYER_STATE_CODES.indexOf(state);
}

export function isPlayerStateCode(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 0 && value < PLAYER_STATE_CODES.length
  );
}

export function playerStateName(value: number): PlayerStateName {
  const state = PLAYER_STATE_CODES[value];
  if (state === undefined) {
    throw new RangeError(`Unknown player state code ${value}`);
  }
  return state;
}
