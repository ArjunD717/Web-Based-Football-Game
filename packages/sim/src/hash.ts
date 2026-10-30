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
    mixInt(player.yellowCards);
    mixInt(player.sentOff ? 1 : 0);
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
  mixString(state.rules.aiDifficulty);
  for (const side of ["home", "away"] as const) {
    const stats = side === "home" ? state.stats.home : state.stats.away;
    mixInt(stats.goals);
    mixInt(stats.shots);
    mixInt(stats.shotsOnTarget);
    mixInt(stats.fouls);
    mixInt(stats.offsides);
    mixInt(stats.yellowCards);
    mixInt(stats.redCards);
    mixInt(stats.saves);
    mixInt(stats.passes);
    mixInt(stats.passesCompleted);
    mixInt(stats.possessionTicks);
  }
  if (state.referee.restart !== null) {
    mixString(state.referee.restart.type);
    mixString(state.referee.restart.side);
    mixNumber(state.referee.restart.x);
    mixNumber(state.referee.restart.y);
  }
  if (state.referee.setPiece !== null) {
    const setPiece = state.referee.setPiece;
    mixString(setPiece.type);
    mixString(setPiece.side);
    mixString(setPiece.takerId ?? "");
    mixString(setPiece.firstTouchId ?? "");
    mixInt(setPiece.otherTouched ? 1 : 0);
    for (const id of setPiece.wallPlayerIds) {
      mixString(id);
    }
    if (setPiece.penalty !== null) {
      mixString(setPiece.penalty.takerId);
      mixString(setPiece.penalty.goalkeeperId);
      mixInt(setPiece.penalty.kicked ? 1 : 0);
      mixString(setPiece.penalty.encroachment);
    }
  }
  if (state.referee.offside !== null) {
    mixString(state.referee.offside.side);
    mixInt(state.referee.offside.tick);
    for (const id of state.referee.offside.playerIds) {
      mixString(id);
    }
  }
  if (state.referee.pendingFoul !== null) {
    const pending = state.referee.pendingFoul;
    mixString(pending.side);
    mixString(pending.offenderId);
    mixString(pending.restartType);
    mixNumber(pending.x);
    mixNumber(pending.y);
    mixInt(pending.expiresTick);
  }
  mixInt(state.referee.eventSeq);
  if (state.referee.lastEvent !== null) {
    const event = state.referee.lastEvent;
    mixInt(event.seq);
    mixString(event.type);
    mixString(event.side);
    mixString(event.playerId ?? "");
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

  if (state.passInFlight !== null) {
    mixString(state.passInFlight.side);
    mixString(state.passInFlight.passerId);
  } else {
    mixString("");
  }
  mixString(state.offsidePassTargetId ?? "");
  if (state.lastTouch !== null) {
    mixString(state.lastTouch.team);
    mixString(state.lastTouch.playerId);
    mixInt(state.lastTouch.playerNumber);
  }

  return hash >>> 0;
}
