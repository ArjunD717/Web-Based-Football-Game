// packages/client/src/match/event-label.ts
import type { SnapshotEvent, SnapshotFrame } from "@fb/shared";

/** "YC home–away · RC home–away" for the persistent scoreboard badge. */
export function formatCardCounts(frame: SnapshotFrame): string {
  let homeYellow = 0;
  let awayYellow = 0;
  let homeRed = 0;
  let awayRed = 0;
  for (let index = 0; index < frame.players.length; index += 1) {
    const player = frame.players[index]!;
    const isHome = index < 11;
    if (player.yellowCards > 0) {
      if (isHome) {
        homeYellow += 1;
      } else {
        awayYellow += 1;
      }
    }
    if (player.sentOff) {
      if (isHome) {
        homeRed += 1;
      } else {
        awayRed += 1;
      }
    }
  }
  return `YC ${homeYellow}–${awayYellow} · RC ${homeRed}–${awayRed}`;
}

/** Short banner copy for the most recent server-authoritative rule event. */
export function describeMatchEvent(
  event: SnapshotEvent,
  homeName: string,
  awayName: string,
): string {
  const teamName = event.side === "home" ? homeName : awayName;
  const player =
    event.playerNumber === null ? teamName : `#${event.playerNumber} ${teamName}`;

  switch (event.type) {
    case "foul":
      return `Foul — ${player}`;
    case "advantage":
      return `Advantage — ${teamName}`;
    case "yellowCard":
      return `Yellow card — ${player}`;
    case "redCard":
      return `Red card — ${player}`;
    case "offside":
      return `Offside — ${player}`;
    case "handball":
      return `Handball — ${player}`;
    case "penalty":
      return `Penalty — ${teamName}`;
    case "injury":
      return `Injury — ${player}`;
    case "substitution":
      return `Substitution — ${player}`;
    case "goalkeeperHold":
      return `Goalkeeper hold — ${player}`;
    case "varReview":
      return `VAR review — ${teamName}`;
    case "shootoutGoal":
      return `Shootout goal — ${player}`;
    case "shootoutMiss":
      return `Shootout miss — ${player}`;
    case "forfeit":
      return `Forfeit — ${teamName}`;
  }
}
