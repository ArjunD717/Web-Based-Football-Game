// packages/sim/src/rules/referee.ts
import { TUNING, clamp } from "@fb/shared";
import {
  getAttackingGoalForDirection,
  getDefendingGoalForDirection,
  isInsideOwnPenaltyArea,
  isInsidePenaltyArea,
} from "../pitch";
import type { BallContact } from "../physics/ball";
import { eventRng } from "../random";
import type {
  CardKind,
  MatchEvent,
  MatchEventType,
  MatchRules,
  MatchState,
  PendingFoul,
  PenaltyEncroachment,
  PenaltyRuntime,
  PlayerState,
  RefereeState,
  SetPieceRuntime,
  TeamSide,
} from "../types";
import {
  assessTackle,
  isDenyingGoalscoringOpportunity,
  tackleContactFromPlayers,
} from "./fouls";
import {
  assessHandball,
  handballContextFromContact,
} from "./handball";
import { offsidePlayersAtKick } from "./offside";
import {
  classifyBoundary,
  type BoundaryEvent,
} from "./out-of-play";
import {
  setupCorner,
  setupFreeKick,
  setupGoalKick,
  setupKickoff,
  setupPenalty,
  setupThrowIn,
} from "./restarts";

const DEFAULT_RULES: MatchRules = {
  realHalfSeconds: TUNING.match.halfRealMinutes * 60,
  halfTimeSeconds: TUNING.match.halfTimeSeconds,
  restartDelaySeconds: TUNING.match.restartDelaySeconds,
  goalRestartDelaySeconds: TUNING.match.goalRestartDelaySeconds,
  kickoffDelaySeconds: TUNING.match.kickoffDelaySeconds,
  gameSecondsPerHalf: TUNING.match.gameMinutesPerHalf * 60,
  strictness: "standard",
};

export function createMatchRules(
  overrides: Partial<MatchRules> = {},
): MatchRules {
  const rules: MatchRules = { ...DEFAULT_RULES, ...overrides };
  for (const [key, value] of Object.entries(rules)) {
    if (key === "strictness") {
      continue;
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`match rule ${key} must be positive`);
    }
  }
  if (
    rules.strictness !== "lenient" &&
    rules.strictness !== "standard" &&
    rules.strictness !== "strict"
  ) {
    throw new RangeError("invalid referee strictness");
  }
  return rules;
}

export function createReferee(firstKickoffSide: TeamSide): RefereeState {
  return {
    phase: "deadBall",
    half: 1,
    clockSeconds: 0,
    scoreHome: 0,
    scoreAway: 0,
    restart: null,
    timerSeconds: 0,
    firstKickoffSide,
    setPiece: null,
    offside: null,
    pendingFoul: null,
    lastEvent: null,
    eventSeq: 0,
  };
}

export function startKickoff(
  state: MatchState,
  side: TeamSide,
  delaySeconds: number,
): void {
  const takerId = setupKickoff(state, side);
  prepareRestart(
    state,
    { type: "kickoff", side, x: state.pitch.centreX, y: state.pitch.centreY },
    delaySeconds,
    takerId,
  );
}

export function startThrowIn(
  state: MatchState,
  side: TeamSide,
  x: number,
  y: number,
): void {
  const spotX = clamp(x, 0, state.pitch.lengthM);
  const spotY = y <= 0 ? 0 : state.pitch.widthM;
  const takerId = setupThrowIn(state, side, spotX, spotY);
  prepareRestart(
    state,
    { type: "throwIn", side, x: spotX, y: spotY },
    state.rules.restartDelaySeconds,
    takerId,
  );
}

export function startGoalKick(state: MatchState, side: TeamSide): void {
  const takerId = setupGoalKick(state, side);
  const team = side === "home" ? state.home : state.away;
  const goal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const inward = -goal.netDirection;
  prepareRestart(
    state,
    {
      type: "goalKick",
      side,
      x: goal.lineX + inward * TUNING.match.goalKickSpotFromLineM,
      y: state.pitch.centreY,
    },
    state.rules.restartDelaySeconds,
    takerId,
  );
}

export function startCorner(
  state: MatchState,
  side: TeamSide,
  x: number,
  y: number,
): void {
  const spotX = x <= state.pitch.centreX ? 0 : state.pitch.lengthM;
  const spotY = y <= state.pitch.centreY ? 0 : state.pitch.widthM;
  const takerId = setupCorner(state, side, x, y);
  prepareRestart(
    state,
    { type: "corner", side, x: spotX, y: spotY },
    state.rules.restartDelaySeconds,
    takerId,
  );
}

export function startFreeKick(
  state: MatchState,
  side: TeamSide,
  type: "directFreeKick" | "indirectFreeKick",
  x: number,
  y: number,
): void {
  const spotX = clamp(x, 0, state.pitch.lengthM);
  const spotY = clamp(y, 0, state.pitch.widthM);
  const setup = setupFreeKick(state, side, spotX, spotY);
  prepareRestart(
    state,
    { type, side, x: spotX, y: spotY },
    state.rules.restartDelaySeconds,
    setup.takerId,
    setup.wallPlayerIds,
  );
}

export function startPenalty(state: MatchState, side: TeamSide): void {
  const setup = setupPenalty(state, side);
  const team = side === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const spotX =
    goal.lineX - goal.netDirection * state.pitch.penaltySpotDistanceM;
  const penalty: PenaltyRuntime | null =
    setup.takerId === null || setup.goalkeeperId === null
      ? null
      : {
          side,
          takerId: setup.takerId,
          goalkeeperId: setup.goalkeeperId,
          kicked: false,
          encroachment: "none",
        };
  prepareRestart(
    state,
    { type: "penalty", side, x: spotX, y: state.pitch.centreY },
    state.rules.restartDelaySeconds,
    setup.takerId,
    [],
    penalty,
  );
  if (setup.takerId !== null) {
    const taker = findPlayer(state, side, setup.takerId);
    emitEvent(
      state,
      "penalty",
      side,
      setup.takerId,
      taker?.number ?? null,
    );
  }
}

/**
 * Advance clocks and restart timers. Returns false when the caller must not
 * simulate physics this tick (dead ball, half-time or full-time).
 */
export function advanceReferee(state: MatchState, dt: number): boolean {
  const referee = state.referee;

  if (referee.phase === "halfTime") {
    referee.timerSeconds = Math.max(0, referee.timerSeconds - dt);
    if (referee.timerSeconds <= 0) {
      startSecondHalf(state);
    }
    return false;
  }
  if (referee.phase === "fullTime") {
    return false;
  }

  const scale =
    state.rules.gameSecondsPerHalf / state.rules.realHalfSeconds;
  const halfEnd =
    referee.half === 1
      ? state.rules.gameSecondsPerHalf
      : state.rules.gameSecondsPerHalf * 2;
  referee.clockSeconds = Math.min(
    halfEnd,
    referee.clockSeconds + dt * scale,
  );

  if (referee.clockSeconds >= halfEnd) {
    if (referee.half === 1) {
      enterHalfTime(state);
    } else {
      enterFullTime(state);
    }
    return false;
  }

  if (referee.phase === "deadBall") {
    referee.timerSeconds = Math.max(0, referee.timerSeconds - dt);
    if (referee.timerSeconds <= 0) {
      referee.phase = "live";
      referee.restart = null;
    }
    return referee.phase === "live";
  }

  if (referee.pendingFoul !== null) {
    const pending = referee.pendingFoul;
    if (state.tick >= pending.expiresTick) {
      const team =
        pending.side === "home" ? state.home : state.away;
      const progress =
        (state.ball.x - pending.x) * team.attackDirection;
      referee.pendingFoul = null;
      if (progress < TUNING.referee.advantageGainM) {
        restartFromPendingFoul(state, pending);
        return false;
      }
    }
  }

  return true;
}

export function evaluateBoundary(state: MatchState): void {
  if (state.referee.phase !== "live") {
    return;
  }
  const event = classifyBoundary(
    state.pitch,
    state.ball,
    state.lastTouch,
  );
  if (event === null) {
    return;
  }
  if (event.kind === "goal") {
    applyGoal(state, event);
    return;
  }
  applyRestart(state, event);
}

/**
 * Called by every deliberate kick before the ball leaves the player's body.
 * Handles the first touch of a set piece, double touches and the offside
 * snapshot. Returns false when the referee has stopped play instead.
 */
export function beginKick(
  state: MatchState,
  player: PlayerState,
  _kind: "pass" | "shot" | "clear" | "dribble",
): boolean {
  if (state.referee.phase !== "live" || player.sentOff) {
    return false;
  }

  const referee = state.referee;
  const previousOffside = referee.offside;
  if (previousOffside !== null) {
    if (previousOffside.playerIds.includes(player.id)) {
      awardOffside(state, player);
      return false;
    }
    referee.offside = null;
  }

  const setPiece = referee.setPiece;
  let offsideExempt = false;
  if (setPiece !== null) {
    offsideExempt =
      (setPiece.type === "throwIn" ||
        setPiece.type === "goalKick" ||
        setPiece.type === "corner") &&
      setPiece.firstTouchId === null;

    if (
      setPiece.firstTouchId === player.id &&
      setPiece.takerId === player.id
    ) {
      awardDoubleTouch(state, player, setPiece);
      return false;
    }

    if (setPiece.firstTouchId === null) {
      setPiece.firstTouchId = player.id;
      if (player.id !== setPiece.takerId) {
        setPiece.otherTouched = true;
      }
      if (setPiece.penalty !== null) {
        markPenaltyKick(state, setPiece, player);
      }
    } else if (setPiece.firstTouchId !== player.id) {
      setPiece.otherTouched = true;
    }

    state.lastTouch = {
      team: player.team,
      playerId: player.id,
      playerNumber: player.number,
    };

    if (!offsideExempt) {
      captureOffside(state, player);
    }

    if (setPiece.otherTouched) {
      referee.setPiece = null;
    }
  } else {
    state.lastTouch = {
      team: player.team,
      playerId: player.id,
      playerNumber: player.number,
    };
    captureOffside(state, player);
  }

  return true;
}

export function registerTouch(
  state: MatchState,
  contact: BallContact,
): void {
  if (state.referee.phase !== "live") {
    return;
  }
  const referee = state.referee;
  const player = findPlayer(state, contact.team, contact.playerId);

  if (referee.offside !== null) {
    if (referee.offside.playerIds.includes(contact.playerId)) {
      if (player !== null) {
        awardOffside(state, player);
        return;
      }
    }
    referee.offside = null;
  }

  const setPiece = referee.setPiece;
  if (setPiece !== null) {
    if (
      setPiece.firstTouchId === contact.playerId &&
      setPiece.takerId === contact.playerId
    ) {
      awardDoubleTouch(state, player, setPiece);
      return;
    }
    if (
      setPiece.penalty !== null &&
      setPiece.firstTouchId === contact.playerId &&
      setPiece.penalty.takerId === contact.playerId
    ) {
      const penalty = setPiece.penalty;
      // The first taker contact is the kick itself. A later contact before
      // anyone else is a double touch.
      if (penalty.kicked) {
        awardDoubleTouch(state, player, setPiece);
        return;
      }
      penalty.kicked = true;
      penalty.encroachment = penaltyEncroachment(state, penalty);
      setPiece.firstTouchId = contact.playerId;
    } else if (setPiece.firstTouchId === null) {
      setPiece.firstTouchId = contact.playerId;
      if (contact.playerId !== setPiece.takerId) {
        setPiece.otherTouched = true;
      }
    } else if (setPiece.firstTouchId !== contact.playerId) {
      setPiece.otherTouched = true;
    }

    if (setPiece.otherTouched) {
      referee.setPiece = null;
    }
  }

  state.lastTouch = {
    team: contact.team,
    playerId: contact.playerId,
    playerNumber: contact.playerNumber,
  };
}

/** Detects active involvement by an offside-positioned player between ticks. */
export function checkOffsideInvolvement(state: MatchState): boolean {
  const offside = state.referee.offside;
  if (offside === null || state.referee.phase !== "live") {
    return false;
  }

  const opponents =
    offside.side === "home" ? state.away : state.home;
  for (const id of offside.playerIds) {
    const player = findPlayer(state, offside.side, id);
    if (player === null || player.sentOff) {
      continue;
    }
    const ballDistance = Math.hypot(
      state.ball.x - player.x,
      state.ball.y - player.y,
    );
    const touchesBall =
      ballDistance <= TUNING.referee.offsideInvolvementRadiusM &&
      state.ball.z <= TUNING.ai.controlMaxBallHeightM;
    const challenges = opponents.players.some(
      (opponent) =>
        !opponent.sentOff &&
        Math.hypot(opponent.x - player.x, opponent.y - player.y) <=
          TUNING.referee.offsideChallengeRadiusM &&
        Math.hypot(state.ball.x - opponent.x, state.ball.y - opponent.y) <=
          TUNING.referee.offsideChallengeBallRadiusM,
    );
    if (touchesBall || challenges) {
      awardOffside(state, player);
      return true;
    }
  }
  return false;
}

/** Applies a tackle contact, card and advantage/free-kick consequence. */
export function commitTackleFoul(
  state: MatchState,
  tackler: PlayerState,
  victim: PlayerState,
  ballWonFirst: boolean,
): boolean {
  if (state.referee.phase !== "live") {
    return false;
  }
  const dogso = isDenyingGoalscoringOpportunity(state, victim);
  const contact = tackleContactFromPlayers(
    state.tick,
    tackler,
    victim,
    ballWonFirst,
    dogso,
  );
  const assessment = assessTackle(contact, state.rules.strictness);
  if (!assessment.foul) {
    return false;
  }

  victim.state = "fall";
  victim.actionTimer = TUNING.referee.fallSeconds;
  victim.vx *= 0.2;
  victim.vy *= 0.2;

  emitEvent(
    state,
    "foul",
    tackler.team,
    tackler.id,
    tackler.number,
  );

  const inPenaltyArea = isInsideOwnPenaltyArea(
    state.pitch,
    tackler.team === "home"
      ? state.home.attackDirection
      : state.away.attackDirection,
    victim.x,
    victim.y,
  );
  const restartType = inPenaltyArea ? "penalty" : "directFreeKick";
  const pending: PendingFoul = {
    side: victim.team,
    offenderId: tackler.id,
    offenderNumber: tackler.number,
    restartType,
    x: clamp(victim.x, 0, state.pitch.lengthM),
    y: clamp(victim.y, 0, state.pitch.widthM),
    expiresTick:
      state.tick +
      Math.round(TUNING.referee.advantageSeconds * TUNING.sim.tickHz),
  };

  if (
    restartType === "directFreeKick" &&
    advantageAvailable(state, victim.team)
  ) {
    state.referee.pendingFoul = pending;
    if (assessment.card !== null) {
      issueCard(state, tackler, assessment.card);
    } else {
      emitEvent(state, "advantage", victim.team, victim.id, victim.number);
    }
  } else {
    // Start the restart first so a card/penalty event ordering cannot hide the
    // card behind the penalty banner. The restart overlay still names the
    // penalty, while the event feed keeps the disciplinary outcome.
    restartFromPendingFoul(state, pending);
    if (assessment.card !== null) {
      issueCard(state, tackler, assessment.card);
    }
  }
  return true;
}

/** Applies a physical ball/arm contact through the handball law. */
export function evaluateHandball(
  state: MatchState,
  contact: BallContact,
): boolean {
  if (state.referee.phase !== "live") {
    return false;
  }
  const player = findPlayer(state, contact.team, contact.playerId);
  if (player === null) {
    return false;
  }
  const team =
    contact.team === "home" ? state.home : state.away;
  const defender =
    contact.team === "home" ? state.away : state.home;
  const inOwnPenaltyArea = isInsideOwnPenaltyArea(
    state.pitch,
    team.attackDirection,
    contact.contactX,
    contact.contactY,
  );
  const attackingPenaltyArea = isInsidePenaltyArea(
    state.pitch,
    defender.side,
    contact.contactX,
    contact.contactY,
  );
  const roll = eventRng(
    state.seed,
    state.tick,
    contact.playerNumber +
      (contact.team === "home" ? 0 : 10_000),
  ).next();
  const context = handballContextFromContact({
    player,
    ballHeightM: contact.ballHeightM,
    relativeSpeedMps: contact.relativeSpeedMps,
    inOwnPenaltyArea,
    deliberateRoll: roll,
    attackerBeforeGoal:
      !inOwnPenaltyArea &&
      attackingPenaltyArea &&
      Math.hypot(state.ball.vx, state.ball.vy) >
        TUNING.referee.handballMinRelativeSpeedMps,
  });
  const decision = assessHandball(context);
  if (decision === "none") {
    return false;
  }

  emitEvent(
    state,
    "handball",
    contact.team,
    contact.playerId,
    contact.playerNumber,
  );
  const opponent = otherSide(contact.team);
  if (decision === "penalty") {
    startPenalty(state, opponent);
  } else {
    startFreeKick(
      state,
      opponent,
      "directFreeKick",
      contact.contactX,
      contact.contactY,
    );
  }
  return true;
}

export function isRefereePlayable(state: MatchState): boolean {
  return state.referee.phase === "live";
}

export function heldBySetPiece(
  state: MatchState,
  player: PlayerState,
): boolean {
  const setPiece = state.referee.setPiece;
  if (setPiece === null || state.referee.phase !== "live") {
    return false;
  }
  if (
    setPiece.takerId === player.id &&
    setPiece.firstTouchId === player.id &&
    !setPiece.otherTouched
  ) {
    return true;
  }
  if (setPiece.penalty !== null) {
    if (setPiece.penalty.kicked) {
      return false;
    }
    return player.id !== setPiece.penalty.takerId;
  }
  if (setPiece.firstTouchId !== null) {
    return false;
  }
  return setPiece.wallPlayerIds.includes(player.id);
}

function prepareRestart(
  state: MatchState,
  restart: NonNullable<RefereeState["restart"]>,
  timerSeconds: number,
  takerId: string | null,
  wallPlayerIds: readonly string[] = [],
  penalty: PenaltyRuntime | null = null,
): void {
  state.referee.phase = "deadBall";
  state.referee.restart = restart;
  state.referee.timerSeconds = timerSeconds;
  state.referee.setPiece = {
    type: restart.type,
    side: restart.side,
    takerId,
    firstTouchId: null,
    otherTouched: false,
    wallPlayerIds,
    penalty,
  };
  state.referee.offside = null;
  state.referee.pendingFoul = null;
}

function applyGoal(
  state: MatchState,
  event: Extract<BoundaryEvent, { kind: "goal" }>,
): void {
  const referee = state.referee;

  if (
    referee.pendingFoul !== null &&
    event.scoringSide !== referee.pendingFoul.side
  ) {
    const pending = referee.pendingFoul;
    referee.pendingFoul = null;
    restartFromPendingFoul(state, pending);
    return;
  }
  if (referee.pendingFoul !== null) {
    referee.pendingFoul = null;
  }

  if (applyPenaltyEncroachment(state)) {
    return;
  }

  if (disallowDirectRestartGoal(state, event)) {
    return;
  }

  if (event.scoringSide === "home") {
    referee.scoreHome = Math.min(255, referee.scoreHome + 1);
  } else {
    referee.scoreAway = Math.min(255, referee.scoreAway + 1);
  }
  startKickoff(
    state,
    event.scoringSide === "home" ? "away" : "home",
    state.rules.goalRestartDelaySeconds,
  );
}

function applyRestart(
  state: MatchState,
  event: Extract<BoundaryEvent, { kind: "restart" }>,
): void {
  if (applyPenaltyEncroachment(state)) {
    return;
  }
  applyBoundaryRestart(state, event.type, event.side, event.x, event.y);
}

function applyBoundaryRestart(
  state: MatchState,
  type: Extract<BoundaryEvent, { kind: "restart" }>["type"],
  side: TeamSide,
  x: number,
  y: number,
): void {
  switch (type) {
    case "throwIn":
      startThrowIn(state, side, x, y);
      return;
    case "goalKick":
      startGoalKick(state, side);
      return;
    case "corner":
      startCorner(state, side, x, y);
      return;
  }
}

function disallowDirectRestartGoal(
  state: MatchState,
  event: Extract<BoundaryEvent, { kind: "goal" }>,
): boolean {
  const setPiece = state.referee.setPiece;
  if (setPiece === null) {
    return false;
  }
  const direct =
    setPiece.firstTouchId === null ||
    (setPiece.firstTouchId === setPiece.takerId &&
      !setPiece.otherTouched);
  if (!direct) {
    return false;
  }

  const kickerSide = setPiece.side;
  const opponent = otherSide(kickerSide);
  if (setPiece.type === "penalty") {
    return false;
  }
  if (
    (setPiece.type === "throwIn" ||
      setPiece.type === "indirectFreeKick") &&
    event.scoringSide === kickerSide
  ) {
    startGoalKick(state, opponent);
    return true;
  }
  if (event.scoringSide !== kickerSide) {
    startCorner(
      state,
      event.scoringSide,
      event.goal === "home" ? 0 : state.pitch.lengthM,
      state.ball.y <= state.pitch.centreY ? 0 : state.pitch.widthM,
    );
    return true;
  }
  return false;
}

function restartFromPendingFoul(
  state: MatchState,
  pending: PendingFoul,
): void {
  state.referee.pendingFoul = null;
  if (pending.restartType === "penalty") {
    startPenalty(state, pending.side);
    return;
  }
  startFreeKick(
    state,
    pending.side,
    "directFreeKick",
    pending.x,
    pending.y,
  );
}

function applyPenaltyEncroachment(state: MatchState): boolean {
  const setPiece = state.referee.setPiece;
  const penalty = setPiece?.penalty ?? null;
  if (penalty === null || !penalty.kicked) {
    return false;
  }
  if (penalty.encroachment === "none") {
    return false;
  }
  if (penalty.encroachment === "attacker") {
    const goal = getAttackingGoalForDirection(
      state.pitch,
      (penalty.side === "home" ? state.home : state.away).attackDirection,
    );
    startFreeKick(
      state,
      otherSide(penalty.side),
      "indirectFreeKick",
      goal.lineX - goal.netDirection * state.pitch.penaltySpotDistanceM,
      state.pitch.centreY,
    );
    return true;
  }
  startPenalty(state, penalty.side);
  return true;
}

function markPenaltyKick(
  state: MatchState,
  setPiece: SetPieceRuntime,
  player: PlayerState,
): void {
  const penalty = setPiece.penalty;
  if (penalty === null || player.id !== penalty.takerId) {
    return;
  }
  penalty.kicked = true;
  penalty.encroachment = penaltyEncroachment(state, penalty);
}

function penaltyEncroachment(
  state: MatchState,
  penalty: PenaltyRuntime,
): PenaltyEncroachment {
  const defendingSide = otherSide(penalty.side);
  const goal = getDefendingGoalForDirection(
    state.pitch,
    (defendingSide === "home" ? state.home : state.away).attackDirection,
  );
  const spotX =
    goal.lineX - goal.netDirection * state.pitch.penaltySpotDistanceM;
  const spotY = state.pitch.centreY;
  let attacker = false;
  let defender = false;

  for (const team of [state.home, state.away]) {
    for (const player of team.players) {
      if (
        player.sentOff ||
        player.id === penalty.takerId ||
        player.id === penalty.goalkeeperId
      ) {
        continue;
      }
      const insideArea = isInsidePenaltyArea(
        state.pitch,
        defendingSide,
        player.x,
        player.y,
      );
      const insideArc =
        Math.hypot(player.x - spotX, player.y - spotY) <
        state.pitch.penaltyArcRadiusM;
      if (!insideArea && !insideArc) {
        continue;
      }
      if (player.team === penalty.side) {
        attacker = true;
      } else {
        defender = true;
      }
    }
  }

  if (attacker && defender) {
    return "both";
  }
  if (attacker) {
    return "attacker";
  }
  if (defender) {
    return "defender";
  }
  return "none";
}

function captureOffside(state: MatchState, kicker: PlayerState): void {
  const team = kicker.team === "home" ? state.home : state.away;
  const opponents =
    kicker.team === "home" ? state.away : state.home;
  const flagged = offsidePlayersAtKick(
    state.pitch,
    team.players,
    opponents.players,
    kicker.id,
    state.ball.x,
    team.attackDirection,
  );
  state.referee.offside =
    flagged.length === 0
      ? null
      : { side: team.side, tick: state.tick, playerIds: flagged };
}

function awardOffside(state: MatchState, player: PlayerState): void {
  const opponent = otherSide(player.team);
  emitEvent(
    state,
    "offside",
    player.team,
    player.id,
    player.number,
  );
  state.referee.offside = null;
  startFreeKick(
    state,
    opponent,
    "indirectFreeKick",
    player.x,
    player.y,
  );
}

function awardDoubleTouch(
  state: MatchState,
  player: PlayerState | null,
  setPiece: SetPieceRuntime,
): void {
  const opponent = otherSide(setPiece.side);
  state.referee.setPiece = null;
  startFreeKick(
    state,
    opponent,
    "indirectFreeKick",
    state.ball.x,
    state.ball.y,
  );
  if (player !== null) {
    emitEvent(
      state,
      "foul",
      player.team,
      player.id,
      player.number,
    );
  }
}

function advantageAvailable(state: MatchState, side: TeamSide): boolean {
  const team = side === "home" ? state.home : state.away;
  let nearest = Infinity;
  for (const player of team.players) {
    if (player.sentOff) {
      continue;
    }
    nearest = Math.min(
      nearest,
      Math.hypot(state.ball.x - player.x, state.ball.y - player.y),
    );
  }
  return nearest <= TUNING.referee.advantagePossessionRadiusM;
}

function issueCard(
  state: MatchState,
  player: PlayerState,
  card: CardKind,
): void {
  if (card === "red") {
    sendOff(state, player);
    return;
  }
  player.yellowCards += 1;
  if (player.yellowCards >= 2) {
    sendOff(state, player);
    return;
  }
  emitEvent(
    state,
    "yellowCard",
    player.team,
    player.id,
    player.number,
  );
}

function sendOff(state: MatchState, player: PlayerState): void {
  player.sentOff = true;
  player.isUserControlled = false;
  player.vx = 0;
  player.vy = 0;
  player.targetX = player.x;
  player.targetY = player.y;
  player.targetSpeed = 0;
  emitEvent(
    state,
    "redCard",
    player.team,
    player.id,
    player.number,
  );
}

function emitEvent(
  state: MatchState,
  type: MatchEventType,
  side: TeamSide,
  playerId: string | null,
  playerNumber: number | null,
): void {
  state.referee.eventSeq += 1;
  const event: MatchEvent = {
    seq: state.referee.eventSeq,
    tick: state.tick,
    type,
    side,
    playerId,
    playerNumber,
  };
  state.referee.lastEvent = event;
}

function enterHalfTime(state: MatchState): void {
  clearTransient(state);
  state.referee.phase = "halfTime";
  state.referee.half = 1;
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf;
  state.referee.timerSeconds = state.rules.halfTimeSeconds;
  state.referee.restart = null;
  freezeBall(state);
}

function startSecondHalf(state: MatchState): void {
  state.home.attackDirection = state.home.attackDirection === 1 ? -1 : 1;
  state.away.attackDirection = state.away.attackDirection === 1 ? -1 : 1;
  state.referee.half = 2;
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf;
  state.referee.restart = null;
  const kickoffSide: TeamSide =
    state.referee.firstKickoffSide === "home" ? "away" : "home";
  startKickoff(state, kickoffSide, state.rules.kickoffDelaySeconds);
}

function enterFullTime(state: MatchState): void {
  clearTransient(state);
  state.referee.phase = "fullTime";
  state.referee.clockSeconds = state.rules.gameSecondsPerHalf * 2;
  state.referee.timerSeconds = 0;
  state.referee.restart = null;
  freezeBall(state);
}

function clearTransient(state: MatchState): void {
  state.referee.setPiece = null;
  state.referee.offside = null;
  state.referee.pendingFoul = null;
}

function freezeBall(state: MatchState): void {
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
  state.ball.spinX = 0;
  state.ball.spinY = 0;
  state.ball.spinZ = 0;
  state.ball.z = clamp(
    state.ball.z,
    TUNING.ball.radiusM,
    TUNING.pitch.goalHeightM,
  );
}

function findPlayer(
  state: MatchState,
  side: TeamSide,
  playerId: string,
): PlayerState | null {
  const team = side === "home" ? state.home : state.away;
  return team.players.find((player) => player.id === playerId) ?? null;
}

function otherSide(side: TeamSide): TeamSide {
  return side === "home" ? "away" : "home";
}
