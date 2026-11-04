// packages/client/src/camera/context/contextTrigger.ts

import type {
  SnapshotEvent,
  SnapshotMatchPhase,
  SnapshotRestartType,
} from "@fb/shared";
import type { TeamSide } from "@fb/sim";
import type { MatchView, RenderPlayer } from "../../render/view";

export interface ContextMemory {
  initialized: boolean;
  lastScore: string | null;
  lastEventSeq: number;
  lastRestartKey: string | null;
  lastPhase: SnapshotMatchPhase | null;
}

export type ContextTrigger =
  | {
      readonly kind: "goal";
      readonly side: TeamSide;
      readonly scorer: { readonly x: number; readonly y: number } | null;
    }
  | {
      readonly kind: "phase";
      readonly phase: "halfTime" | "fullTime";
    }
  | {
      readonly kind: "incident";
      readonly event: SnapshotEvent;
    }
  | {
      readonly kind: "substitution";
      readonly event: SnapshotEvent;
    }
  | {
      readonly kind: "restart";
      readonly restartType: Exclude<SnapshotRestartType, "kickoff">;
      readonly side: TeamSide;
    }
  | { readonly kind: "kickoff" };

export function createContextMemory(): ContextMemory {
  return {
    initialized: false,
    lastScore: null,
    lastEventSeq: 0,
    lastRestartKey: null,
    lastPhase: null,
  };
}

/**
 * Detect a new presentation moment from authoritative match metadata.
 *
 * The memory is updated for every observed change, even when several changes
 * arrive together. That prevents an old restart or card from being replayed
 * after a higher-priority goal or phase transition.
 */
export function nextContextTrigger(
  view: MatchView,
  previousView: MatchView | null,
  memory: ContextMemory,
): ContextTrigger | null {
  const match = view.match;
  if (match === null) {
    return null;
  }

  const score = `${match.scoreHome}:${match.scoreAway}`;
  const restartKey =
    match.restartType === null || match.restartSide === null
      ? null
      : `${match.restartType}:${match.restartSide}`;
  const eventSeq = match.lastEvent?.seq ?? 0;
  const phase = match.phase;

  if (!memory.initialized) {
    memory.initialized = true;
    memory.lastScore = score;
    memory.lastEventSeq = eventSeq;
    memory.lastPhase = phase;
    memory.lastRestartKey = null;
    if (
      restartKey !== null &&
      match.restartType === "kickoff" &&
      phase !== "halfTime" &&
      phase !== "fullTime"
    ) {
      memory.lastRestartKey = restartKey;
      return { kind: "kickoff" };
    }
    memory.lastRestartKey = restartKey;
    return null;
  }

  let goal: ContextTrigger | null = null;
  if (memory.lastScore !== null && score !== memory.lastScore) {
    const previousHome = Number(memory.lastScore.split(":")[0] ?? 0);
    const side: TeamSide =
      match.scoreHome > previousHome ? "home" : "away";
    const scorerView = previousView ?? view;
    goal = {
      kind: "goal",
      side,
      scorer: nearestPlayerToBall(scorerView, side),
    };
  }
  memory.lastScore = score;

  let phaseTrigger: ContextTrigger | null = null;
  if (memory.lastPhase !== phase) {
    if (phase === "halfTime" || phase === "fullTime") {
      phaseTrigger = { kind: "phase", phase };
    }
  }
  memory.lastPhase = phase;

  let eventTrigger: ContextTrigger | null = null;
  if (match.lastEvent !== null && eventSeq !== memory.lastEventSeq) {
    if (
      match.lastEvent.type === "foul" ||
      match.lastEvent.type === "yellowCard" ||
      match.lastEvent.type === "redCard" ||
      match.lastEvent.type === "injury"
    ) {
      eventTrigger = { kind: "incident", event: match.lastEvent };
    } else if (match.lastEvent.type === "substitution") {
      eventTrigger = { kind: "substitution", event: match.lastEvent };
    }
  }
  if (eventSeq !== memory.lastEventSeq) {
    memory.lastEventSeq = eventSeq;
  }

  let restartTrigger: ContextTrigger | null = null;
  if (restartKey === null) {
    memory.lastRestartKey = null;
  } else if (restartKey !== memory.lastRestartKey) {
    if (
      match.restartType !== null &&
      match.restartSide !== null &&
      phase !== "halfTime" &&
      phase !== "fullTime"
    ) {
      restartTrigger =
        match.restartType === "kickoff"
          ? { kind: "kickoff" }
          : {
              kind: "restart",
              restartType: match.restartType,
              side: match.restartSide,
            };
    }
    memory.lastRestartKey = restartKey;
  }

  // A goal is the strongest moment. A full-time whistle beats a card, and a
  // card beats a routine restart so the player can see the incident.
  return goal ?? phaseTrigger ?? eventTrigger ?? restartTrigger;
}

function nearestPlayerToBall(
  view: MatchView,
  side: TeamSide,
): { x: number; y: number } | null {
  const team = side === "home" ? view.home : view.away;
  let best: RenderPlayer | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const player of team.players) {
    if (player.sentOff) {
      continue;
    }
    const distance =
      (player.x - view.ball.x) ** 2 + (player.y - view.ball.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best === null ? null : { x: best.x, y: best.y };
}
