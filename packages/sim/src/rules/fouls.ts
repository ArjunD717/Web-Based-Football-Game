// packages/sim/src/rules/fouls.ts
import { TUNING, clamp } from "@fb/shared";
import { getAttackingGoalForDirection } from "../pitch";
import type {
  FoulStrictness,
  MatchState,
  PlayerState,
  TeamSide,
} from "../types";

export type FoulContactPoint = "ball" | "lowerLeg" | "upperBody";

export interface TackleContact {
  readonly tick: number;
  readonly tacklerTeam: TeamSide;
  readonly tacklerId: string;
  readonly victimId: string | null;
  /** Angle between the tackler's motion and the direction to the victim. */
  readonly approachAngleRad: number;
  readonly relativeSpeedMps: number;
  readonly ballWonFirst: boolean;
  readonly fromBehind: boolean;
  readonly contactPoint: FoulContactPoint;
  readonly tacklerAggression: number;
  readonly tacklerTackle: number;
  readonly victimBalance: number;
  readonly sliding: boolean;
  readonly dogso: boolean;
}

export interface FoulAssessment {
  readonly severity: number;
  readonly foul: boolean;
  readonly card: "yellow" | "red" | null;
  readonly reason: "none" | "careless" | "reckless" | "excessive" | "dogso";
}

const RULES = TUNING.referee;

export function assessTackle(
  contact: TackleContact,
  strictness: FoulStrictness,
): FoulAssessment {
  const speed = clamp(
    contact.relativeSpeedMps / RULES.foulMaxRelativeSpeedMps,
    0,
    1,
  );
  const angle = clamp(
    (1 - Math.cos(contact.approachAngleRad)) / 2,
    0,
    1,
  );
  const tacklerAggression = clamp(
    contact.tacklerAggression / 99,
    0,
    1,
  );
  const tacklerSkill = clamp(contact.tacklerTackle / 99, 0, 1);
  const victimBalance = clamp(contact.victimBalance / 99, 0, 1);

  let severity =
    RULES.foulBaseSeverity +
    speed * RULES.foulSpeedWeight +
    (contact.fromBehind ? RULES.foulBehindWeight : 0) +
    (contact.sliding ? RULES.foulSlideWeight : 0) +
    (contact.contactPoint === "upperBody"
      ? RULES.foulUpperBodyWeight
      : 0) +
    (contact.ballWonFirst ? 0 : RULES.foulNoBallWeight) +
    tacklerAggression * RULES.foulAggressionWeight +
    (1 - tacklerSkill) * RULES.foulTackleWeight +
    (1 - victimBalance) * RULES.foulBalanceWeight +
    angle * RULES.foulAngleWeight -
    (contact.ballWonFirst ? RULES.foulBallFirstReduction : 0);

  if (contact.fromBehind && contact.sliding) {
    // A sliding contact from behind is at least careless. Even a clean ball
    // win does not remove the danger of the follow-through.
    severity = Math.max(
      severity,
      contact.ballWonFirst
        ? RULES.foulThreshold + RULES.foulSlideWeight
        : RULES.foulThreshold,
    );
  }

  severity += strictnessOffset(strictness);

  const foul = severity >= RULES.foulThreshold;
  const red = foul && (contact.dogso || severity >= RULES.redThreshold);
  const yellow = foul && !red && severity >= RULES.yellowThreshold;
  const card: FoulAssessment["card"] = red
    ? "red"
    : yellow
      ? "yellow"
      : null;
  const reason: FoulAssessment["reason"] = !foul
    ? "none"
    : contact.dogso && red
      ? "dogso"
      : red
        ? "excessive"
        : yellow
          ? "reckless"
          : "careless";

  return { severity, foul, card, reason };
}

export function tackleContactFromPlayers(
  tick: number,
  tackler: PlayerState,
  victim: PlayerState | null,
  ballWonFirst: boolean,
  dogso: boolean,
): TackleContact {
  const sliding = tackler.state === "slide";

  if (victim === null) {
    return {
      tick,
      tacklerTeam: tackler.team,
      tacklerId: tackler.id,
      victimId: null,
      approachAngleRad: 0,
      relativeSpeedMps: 0,
      ballWonFirst,
      fromBehind: false,
      contactPoint: "ball",
      tacklerAggression: tackler.attributes.aggression,
      tacklerTackle: sliding
        ? tackler.attributes.slidingTackle
        : tackler.attributes.standingTackle,
      victimBalance: 0,
      sliding,
      dogso: false,
    };
  }

  const toTacklerX = tackler.x - victim.x;
  const toTacklerY = tackler.y - victim.y;
  const toTacklerDistance = Math.hypot(toTacklerX, toTacklerY);
  const behindDot =
    toTacklerDistance > 1e-6
      ? (Math.cos(victim.facing) * toTacklerX +
          Math.sin(victim.facing) * toTacklerY) /
        toTacklerDistance
      : 1;
  const fromBehind = behindDot < RULES.behindDotThreshold;

  const toVictimX = victim.x - tackler.x;
  const toVictimY = victim.y - tackler.y;
  const toVictimDistance = Math.hypot(toVictimX, toVictimY);
  const motionSpeed = Math.hypot(tackler.vx, tackler.vy);
  const motionX =
    motionSpeed > 1e-6 ? tackler.vx / motionSpeed : Math.cos(tackler.facing);
  const motionY =
    motionSpeed > 1e-6 ? tackler.vy / motionSpeed : Math.sin(tackler.facing);
  const alignment =
    toVictimDistance > 1e-6
      ? (toVictimX * motionX + toVictimY * motionY) / toVictimDistance
      : 1;
  const approachAngleRad = Math.acos(clamp(alignment, -1, 1));
  const relativeSpeedMps = Math.hypot(
    tackler.vx - victim.vx,
    tackler.vy - victim.vy,
  );

  return {
    tick,
    tacklerTeam: tackler.team,
    tacklerId: tackler.id,
    victimId: victim.id,
    approachAngleRad,
    relativeSpeedMps,
    ballWonFirst,
    fromBehind,
    contactPoint: ballWonFirst ? "ball" : "lowerLeg",
    tacklerAggression: tackler.attributes.aggression,
    tacklerTackle: sliding
      ? tackler.attributes.slidingTackle
      : tackler.attributes.standingTackle,
    victimBalance: victim.attributes.balance,
    sliding,
    dogso,
  };
}

export function findTackleVictim(
  opponents: readonly PlayerState[],
  tackler: PlayerState,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance: number = TUNING.referee.tackleContactRangeM;

  for (const opponent of opponents) {
    if (
      opponent.sentOff ||
      opponent.state === "fall" ||
      opponent.state === "injured"
    ) {
      continue;
    }
    const distance = Math.hypot(opponent.x - tackler.x, opponent.y - tackler.y);
    if (distance < bestDistance) {
      best = opponent;
      bestDistance = distance;
    }
  }

  return best;
}

/** A compact DOGSO test: central, close to goal, with at most one defender back. */
export function isDenyingGoalscoringOpportunity(
  state: MatchState,
  victim: PlayerState,
): boolean {
  const team = victim.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const goalCentreDistance = Math.hypot(
    goal.lineX - victim.x,
    goal.centreY - victim.y,
  );
  if (goalCentreDistance > RULES.dogsoMaxDistanceM) {
    return false;
  }
  if (Math.abs(victim.y - goal.centreY) > RULES.dogsoCentralHalfWidthM) {
    return false;
  }

  const defenders = victim.team === "home" ? state.away : state.home;
  let goalSideDefenders = 0;
  for (const defender of defenders.players) {
    if (defender.sentOff) {
      continue;
    }
    const goalSide =
      team.attackDirection === 1
        ? defender.x > victim.x && defender.x < goal.lineX
        : defender.x < victim.x && defender.x > goal.lineX;
    if (goalSide) {
      goalSideDefenders += 1;
    }
  }

  return (
    goalSideDefenders <= RULES.dogsoMaxDefendersGoalSide
  );
}

function strictnessOffset(strictness: FoulStrictness): number {
  if (strictness === "lenient") {
    return RULES.lenientOffset;
  }
  if (strictness === "strict") {
    return RULES.strictOffset;
  }
  return 0;
}
