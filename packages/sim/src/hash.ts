// packages/sim/src/hash.ts
import type { MatchState, PlayerState } from "./types";

const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const HASH_SCALE = 10_000;

/**
 * Compact state hash for determinism tests and the M2 desync detector.
 * Quantisation hides sub-0.1 mm float noise while preserving real divergence.
 */
export function hashMatchState(state: MatchState): number {
  let hash = FNV_OFFSET;

  const mixInt = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), FNV_PRIME);
    hash ^= hash >>> 13;
  };
  const mixNumber = (value: number): void => {
    mixInt(Math.round(value * HASH_SCALE));
  };
  const mixString = (value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      mixInt(value.charCodeAt(i));
    }
    mixInt(value.length);
  };
  const mixPlayer = (player: PlayerState): void => {
    mixString(player.id);
    mixNumber(player.x);
    mixNumber(player.y);
    mixNumber(player.vx);
    mixNumber(player.vy);
    mixNumber(player.facing);
    mixNumber(player.stamina);
    mixNumber(player.actionTimer);
    mixNumber(player.kickCooldown);
    mixString(player.state);
    mixInt(player.isUserControlled ? 1 : 0);
  };

  mixNumber(state.seed);
  mixInt(state.tick);
  mixNumber(state.elapsedSeconds);
  mixNumber(state.home.attackDirection);
  mixNumber(state.away.attackDirection);

  mixString(state.referee.phase);
  mixInt(state.referee.half);
  mixNumber(state.referee.clockSeconds);
  mixInt(state.referee.scoreHome);
  mixInt(state.referee.scoreAway);
  mixNumber(state.referee.timerSeconds);
  if (state.referee.restart !== null) {
    mixString(state.referee.restart.type);
    mixString(state.referee.restart.side);
    mixNumber(state.referee.restart.x);
    mixNumber(state.referee.restart.y);
  }
  if (state.referee.throwIn !== null) {
    mixString(state.referee.throwIn.side);
    mixString(state.referee.throwIn.playerId);
  }

  mixNumber(state.ball.x);
  mixNumber(state.ball.y);
  mixNumber(state.ball.z);
  mixNumber(state.ball.vx);
  mixNumber(state.ball.vy);
  mixNumber(state.ball.vz);
  mixNumber(state.ball.spinX);
  mixNumber(state.ball.spinY);
  mixNumber(state.ball.spinZ);

  for (const player of state.home.players) {
    mixPlayer(player);
  }
  for (const player of state.away.players) {
    mixPlayer(player);
  }

  if (state.lastTouch !== null) {
    mixString(state.lastTouch.team);
    mixString(state.lastTouch.playerId);
    mixInt(state.lastTouch.playerNumber);
  }

  return hash >>> 0;
}
