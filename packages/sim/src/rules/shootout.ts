// packages/sim/src/rules/shootout.ts

import { TUNING, clamp } from "@fb/shared";
import { eventRng } from "../random";
import type {
  MatchState,
  PlayerState,
  ShootoutKick,
  ShootoutState,
  TeamSide,
} from "../types";

function otherSide(side: TeamSide): TeamSide {
  return side === "home" ? "away" : "home";
}

/** The shootout alternates kicks; a seeded coin decides who starts. */
export function createShootout(state: MatchState): ShootoutState {
  const firstSide =
    state.referee.firstKickoffSide === "home" ? "away" : "home";
  return {
    firstSide,
    index: 0,
    homeScore: 0,
    awayScore: 0,
    timerSeconds: TUNING.shootout.kickIntervalSeconds,
    winner: null,
    suddenDeath: false,
    lastKick: null,
    kicks: [],
  };
}

function kickerScore(player: PlayerState): number {
  return (
    player.attributes.finishing * TUNING.shootout.takerFinishingWeight +
    player.attributes.composure * TUNING.shootout.takerComposureWeight +
    player.attributes.shotPower * TUNING.shootout.takerPowerWeight
  ) / 99;
}

function keeperScore(player: PlayerState | null): number {
  if (player === null) {
    return TUNING.shootout.missingKeeperScore;
  }
  const keeper = player.attributes.goalkeeper;
  if (keeper === null) {
    return (
      player.attributes.reactions *
        TUNING.shootout.emergencyReactionsWeight +
      player.attributes.defAwareness *
        TUNING.shootout.emergencyDefenceWeight +
      player.attributes.agility * TUNING.shootout.emergencyAgilityWeight
    ) / 99;
  }
  return (
    keeper.diving * TUNING.shootout.keeperDivingWeight +
    keeper.handling * TUNING.shootout.keeperHandlingWeight +
    keeper.reflexes * TUNING.shootout.keeperReflexesWeight +
    keeper.positioning * TUNING.shootout.keeperPositioningWeight
  ) / 99;
}

function conversionChance(
  taker: PlayerState,
  keeper: PlayerState | null,
): number {
  return clamp(
    TUNING.shootout.baseConversionChance +
      kickerScore(taker) * TUNING.shootout.takerWeight -
      keeperScore(keeper) * TUNING.shootout.keeperWeight,
    TUNING.shootout.minChance,
    TUNING.shootout.maxChance,
  );
}

function sidePlayers(state: MatchState, side: TeamSide): PlayerState[] {
  const team = side === "home" ? state.home : state.away;
  return team.players
    .filter((player) => !player.sentOff && !player.unavailable)
    .slice()
    .sort(
      (a, b) =>
        kickerScore(b) - kickerScore(a) ||
        a.number - b.number,
    );
}

function kickWinner(shootout: ShootoutState): TeamSide | null {
  const regulation = TUNING.shootout.regulationKicks;
  const homeTaken = shootout.kicks.filter((kick) => kick.side === "home").length;
  const awayTaken = shootout.kicks.filter((kick) => kick.side === "away").length;
  const homeRemaining = Math.max(0, regulation - homeTaken);
  const awayRemaining = Math.max(0, regulation - awayTaken);
  if (!shootout.suddenDeath) {
    if (shootout.homeScore > shootout.awayScore + awayRemaining) {
      return "home";
    }
    if (shootout.awayScore > shootout.homeScore + homeRemaining) {
      return "away";
    }
    if (homeTaken >= regulation && awayTaken >= regulation) {
      if (shootout.homeScore !== shootout.awayScore) {
        return shootout.homeScore > shootout.awayScore ? "home" : "away";
      }
      shootout.suddenDeath = true;
    }
    return null;
  }
  if (homeTaken === awayTaken && homeTaken > regulation) {
    if (shootout.homeScore !== shootout.awayScore) {
      return shootout.homeScore > shootout.awayScore ? "home" : "away";
    }
  }
  return null;
}

/**
 * Take the next deterministic kick. The caller owns the interval timer and
 * transitions the match to full time once `winner` is set.
 */
export function takeShootoutKick(state: MatchState): ShootoutKick | null {
  const shootout = state.referee.shootout;
  if (shootout === null || shootout.winner !== null) {
    return null;
  }
  const side: TeamSide =
    shootout.index % 2 === 0 ? shootout.firstSide : otherSide(shootout.firstSide);
  const players = sidePlayers(state, side);
  if (players.length === 0) {
    shootout.winner = otherSide(side);
    return null;
  }
  const kickNumber = Math.floor(shootout.index / 2);
  const taker = players[kickNumber % players.length]!;
  const opponents = side === "home" ? state.away : state.home;
  const keeper =
    opponents.players.find(
      (player) => player.role === "GK" && !player.sentOff && !player.unavailable,
    ) ?? null;
  const rng = eventRng(
    state.seed,
    state.tick,
    0x7a11 + shootout.index * 0x101,
  );
  const scored = rng.chance(conversionChance(taker, keeper));
  const kick: ShootoutKick = {
    side,
    playerId: taker.id,
    playerNumber: taker.number,
    scored,
  };
  shootout.kicks.push(kick);
  shootout.index += 1;
  shootout.lastKick = kick;
  if (scored) {
    if (side === "home") {
      shootout.homeScore = Math.min(255, shootout.homeScore + 1);
    } else {
      shootout.awayScore = Math.min(255, shootout.awayScore + 1);
    }
  }
  const winner = kickWinner(shootout);
  if (winner !== null) {
    shootout.winner = winner;
    shootout.timerSeconds = TUNING.shootout.finishDelaySeconds;
  } else {
    shootout.timerSeconds = TUNING.shootout.kickIntervalSeconds;
  }
  return kick;
}
