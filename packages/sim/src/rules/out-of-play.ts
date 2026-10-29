// packages/sim/src/rules/out-of-play.ts
import { TUNING, clamp } from "@fb/shared";
import type {
  BallState,
  GoalGeometry,
  LastTouch,
  Pitch,
  RestartType,
  TeamSide,
} from "../types";

export interface GoalEvent {
  readonly kind: "goal";
  readonly scoringSide: TeamSide;
  readonly goal: "home" | "away";
}

export interface RestartEvent {
  readonly kind: "restart";
  readonly type: Exclude<RestartType, "kickoff">;
  readonly side: TeamSide;
  readonly x: number;
  readonly y: number;
}

export type BoundaryEvent = GoalEvent | RestartEvent;

/**
 * Goal-line test from the Laws: the whole ball must cross the line, between the
 * posts and under the crossbar. Net physics keeps the ball in the goal mouth
 * long enough for this check on the same tick.
 */
export function detectGoal(
  pitch: Pitch,
  ball: BallState,
): GoalEvent | null {
  return (
    goalAt(pitch.homeGoal, ball, "away", "home") ??
    goalAt(pitch.awayGoal, ball, "home", "away") ??
    null
  );
}

function goalAt(
  goal: GoalGeometry,
  ball: BallState,
  scoringSide: TeamSide,
  goalSide: "home" | "away",
): GoalEvent | null {
  const radius = TUNING.ball.radiusM;
  const beyondLine =
    goal.netDirection === 1
      ? ball.x - radius > goal.lineX
      : ball.x + radius < goal.lineX;
  if (!beyondLine) {
    return null;
  }
  const betweenPosts =
    ball.y - radius > goal.centreY - goal.widthM / 2 &&
    ball.y + radius < goal.centreY + goal.widthM / 2;
  const underBar = ball.z + radius < goal.heightM;
  if (!betweenPosts || !underBar) {
    return null;
  }
  return {
    kind: "goal",
    scoringSide,
    goal: goalSide,
  };
}

/**
 * Classify the first whole-ball exit. Goal-line exits take precedence over the
 * touchline at a corner, where the ball can cross both lines on the same tick.
 */
export function classifyBoundary(
  pitch: Pitch,
  ball: BallState,
  lastTouch: LastTouch | null,
): BoundaryEvent | null {
  const goal = detectGoal(pitch, ball);
  if (goal !== null) {
    return goal;
  }

  if (ball.x + TUNING.ball.radiusM < 0) {
    return goalLineRestart(pitch, ball, lastTouch, "home");
  }
  if (ball.x - TUNING.ball.radiusM > pitch.lengthM) {
    return goalLineRestart(pitch, ball, lastTouch, "away");
  }

  const outTop = ball.y + TUNING.ball.radiusM < 0;
  const outBottom = ball.y - TUNING.ball.radiusM > pitch.widthM;
  if (!outTop && !outBottom) {
    return null;
  }

  const lastTeam = lastTouch?.team ?? "home";
  return {
    kind: "restart",
    type: "throwIn",
    side: lastTeam === "home" ? "away" : "home",
    x: clamp(ball.x, 0, pitch.lengthM),
    y: outTop ? 0 : pitch.widthM,
  };
}

function goalLineRestart(
  pitch: Pitch,
  ball: BallState,
  lastTouch: LastTouch | null,
  defendingSide: TeamSide,
): RestartEvent {
  const defendingLastTouch = lastTouch?.team === defendingSide;
  const attackingSide: TeamSide = defendingSide === "home" ? "away" : "home";
  if (defendingLastTouch) {
    return {
      kind: "restart",
      type: "corner",
      side: attackingSide,
      x: defendingSide === "home" ? 0 : pitch.lengthM,
      y: ball.y < pitch.centreY ? 0 : pitch.widthM,
    };
  }

  const goal =
    defendingSide === "home" ? pitch.homeGoal : pitch.awayGoal;
  const inward = -goal.netDirection;
  return {
    kind: "restart",
    type: "goalKick",
    side: defendingSide,
    x: goal.lineX + inward * TUNING.match.goalKickSpotFromLineM,
    y: pitch.centreY,
  };
}
