// packages/sim/src/ai/decisions.ts

import { TUNING, clamp, lerp, type Rng } from "@fb/shared";
import {
  getAttackingGoalForDirection,
  getDefendingGoalForDirection,
} from "../pitch";
import { kickBall } from "../physics/ball";
import { decisionRng } from "../random";
import { beginKick } from "../rules/referee";
import { isAvailablePlayer } from "../rules/management";
import type {
  GoalGeometry,
  MatchState,
  PlayerState,
  TeamState,
} from "../types";
import { offsideLineFor } from "./context";
import { difficultyProfile } from "./profiles";

interface PassOption {
  readonly target: PlayerState;
  readonly score: number;
  readonly through: boolean;
  readonly offside: boolean;
}

interface ActionScores {
  readonly shoot: number;
  readonly pass: PassOption | null;
  readonly dribble: number;
  readonly clear: number;
}

/**
 * The on-ball brain. Every option is scored from the same 0..1 scale, then the
 * difficulty profile adds bounded noise so weaker AI is less consistent rather
 * than merely slower.
 */
export function decideAndExecute(
  state: MatchState,
  player: PlayerState,
): boolean {
  if (
    !isAvailablePlayer(player) ||
    player.kickCooldown > 0 ||
    player.isUserControlled ||
    state.referee.phase !== "live"
  ) {
    return false;
  }

  if (executeSetPiece(state, player)) {
    return true;
  }

  const team = player.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const approach = nearestOpponentDistance(state, player);
  const rng = decisionRng(
    state.seed,
    state.tick,
    player.team,
    player.number + (player.role === "GK" ? 3_000 : 0),
  );
  const difficulty = difficultyProfile(state.rules.aiDifficulty);

  if (player.role === "GK") {
    return keeperDistribution(state, team, player, rng);
  }

  if (
    rng.chance(TUNING.ai.offsideIntentChance * difficulty.throughBias) &&
    executeOffsideIntent(state, team, player, rng)
  ) {
    return true;
  }

  const scores = scoreActions(
    state,
    team,
    player,
    goal,
    approach,
    difficulty.throughBias,
  );
  const noise = difficulty.decisionNoise * TUNING.ai.decisionNoiseRange;
  const shoot = scores.shoot + rng.range(-noise, noise);
  const pass = scores.pass;
  const passNoise = pass === null ? -Infinity : pass.score + rng.range(-noise, noise);
  const dribble = scores.dribble + rng.range(-noise, noise);
  const clear = scores.clear + rng.range(-noise, noise);

  // Keepers never reach this branch; field players always have a safe outlet:
  // dribbling forward is the fallback when every score is negative.
  if (clear >= shoot && clear >= passNoise && clear >= dribble) {
    return executeClear(state, team, player, rng);
  }
  if (shoot >= passNoise && shoot >= dribble) {
    return executeShot(state, team, player, goal, rng, false);
  }
  if (pass !== null && passNoise >= dribble) {
    return executePass(state, team, player, pass, rng);
  }
  return executeDribble(state, player, goal, rng);
}

function scoreActions(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  goal: GoalGeometry,
  pressureDistance: number,
  throughBias: number,
): ActionScores {
  const familiarity = player.roleFamiliarity;
  const distanceToGoal = Math.hypot(
    goal.lineX - player.x,
    goal.centreY - player.y,
  );
  const pressure = clamp(
    pressureDistance / TUNING.ai.pressDistanceM,
    0,
    1,
  );
  const technical = (rating: number): number =>
    clamp(rating / 99, 0, 1) * familiarity;

  const shoot = shootScore(
    player,
    goal,
    distanceToGoal,
    pressure,
    technical,
  );
  const pass = bestPassOption(
    state,
    team,
    player,
    pressure,
    throughBias,
    technical,
  );
  const dribble = dribbleScore(
    state,
    player,
    distanceToGoal,
    pressure,
    technical,
  );
  const clear = clearScore(
    state,
    team,
    player,
    distanceToGoal,
    pressure,
    technical,
  );
  return { shoot, pass, dribble, clear };
}

function shootScore(
  player: PlayerState,
  goal: GoalGeometry,
  distance: number,
  pressure: number,
  technical: (rating: number) => number,
): number {
  if (
    distance < TUNING.ai.shootMinRangeM ||
    distance > TUNING.ai.shootMaxRangeM
  ) {
    return -Infinity;
  }
  const finishing = technical(player.attributes.finishing);
  const power = technical(player.attributes.shotPower);
  const composure = technical(player.attributes.composure);
  const longShots = technical(player.attributes.longShots);
  const distanceQuality = clamp(
    1 -
      Math.abs(distance - TUNING.ai.shootSweetRangeM) /
        (TUNING.ai.shootMaxRangeM - TUNING.ai.shootMinRangeM),
    0,
    1,
  );
  const angle = clamp(
    goal.widthM / Math.max(distance * 0.42, 1),
    0,
    1,
  );
  const accuracy =
    finishing * 0.45 + power * 0.2 + composure * 0.2 + longShots * 0.15;
  const weights = TUNING.ai.decision;
  return clamp(
    weights.shootBase +
      accuracy *
        weights.shootAccuracyWeight *
        (weights.shootDistanceFloor + distanceQuality * 0.42) *
        (weights.shootAngleFloor + angle * 0.45) +
      (distance <= weights.shootCloseRangeM ? weights.shootCloseBonus : 0) +
      (distance <= weights.shootZoneRangeM ? weights.shootZoneBonus : 0) -
      pressure * weights.shootPressureWeight,
    0,
    1.2,
  );
}

function bestPassOption(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  pressure: number,
  throughBias: number,
  technical: (rating: number) => number,
): PassOption | null {
  const teammates = team.players;
  const offsideLine = offsideLineFor(state, team);
  let best: PassOption | null = null;
  for (const target of teammates) {
    if (target === player || !isAvailablePlayer(target)) {
      continue;
    }
    const distance = Math.hypot(target.x - player.x, target.y - player.y);
    if (
      distance < TUNING.ai.minPassDistanceM ||
      distance > TUNING.ai.passLongRangeM
    ) {
      continue;
    }
    const lane = passLaneClearance(state, player, target);
    const openness = nearestOpponentDistanceTo(
      state,
      team,
      target.x,
      target.y,
    );
    const forward = (target.x - player.x) * team.attackDirection;
    const attackGoal = getAttackingGoalForDirection(
      state.pitch,
      team.attackDirection,
    );
    const goalDistance = Math.hypot(
      attackGoal.lineX - target.x,
      attackGoal.centreY - target.y,
    );
    const inOffsidePosition =
      (target.x - offsideLine) * team.attackDirection > 0;
    const offsideRisk = inOffsidePosition
      ? clamp(
          ((target.x - offsideLine) * team.attackDirection) /
            TUNING.ai.passLongRangeM,
          0,
          1,
        )
      : 0;
    const through =
      forward > 3 &&
      target.role !== "GK" &&
      distance > TUNING.ai.minPassDistanceM &&
      goalDistance < TUNING.ai.passLongRangeM;
    const style = buildUpStyleScore(
      team.tactics.buildUpStyle,
      distance,
      forward,
    );
    const passingRating =
      distance <= TUNING.ai.passShortRangeM
        ? player.attributes.shortPassing
        : forward > 15
          ? player.attributes.longPassing
          : player.attributes.shortPassing * 0.5 +
            player.attributes.longPassing * 0.5;
    const vision = technical(player.attributes.vision);
    const execution = clamp(
      (technical(passingRating) * 0.65 +
        vision * 0.2 +
        technical(player.attributes.composure) * 0.15),
      0,
      1,
    );
    const danger =
      clamp(1 - goalDistance / TUNING.ai.passLongRangeM, 0, 1) *
      (target.role === "ST" || target.role === "CF" || target.role === "CAM"
        ? 1
        : 0.65);
    const laneScore = clamp(lane / 6, 0, 1);
    const targetOpen = clamp(openness / 8, 0, 1);
    const forwardScore = clamp(forward / 25, 0, 1);
    const weights = TUNING.ai.decision;
    const risk = offsideRisk * throughBias * weights.passRiskWeight;
    const throughBonus =
      through && forward > 10
        ? ((1 - targetOpen) + (inOffsidePosition ? 0.8 : 0)) *
          weights.passThroughBonus *
          throughBias
        : 0;
    const backwardPenalty =
      forward < -weights.passLightBackwardM
        ? weights.passBackwardPenalty
        : forward < 0
          ? weights.passLightBackwardPenalty
          : 0;
    const score = clamp(
      weights.passBase +
        execution * weights.passExecutionWeight +
        laneScore * weights.passLaneWeight +
        targetOpen * weights.passOpenWeight +
        forwardScore * weights.passForwardWeight +
        danger * weights.passDangerWeight +
        style * weights.passStyleWeight +
        throughBonus -
        pressure * weights.passPressureWeight -
        backwardPenalty -
        risk,
      0,
      1.2,
    );
    if (best === null || score > best.score) {
      best = { target, score, through, offside: inOffsidePosition };
    }
  }
  return best;
}

function dribbleScore(
  state: MatchState,
  player: PlayerState,
  distanceToGoal: number,
  pressure: number,
  technical: (rating: number) => number,
): number {
  const nearest = nearestOpponentDistance(state, player);
  const space = clamp(nearest / TUNING.ai.dribbleEvadeDistanceM, 0, 1);
  const dribble = technical(player.attributes.dribbling);
  const control = technical(player.attributes.ballControl);
  const goalPull = clamp(1 - distanceToGoal / 60, 0, 1);
  const weights = TUNING.ai.decision;
  return clamp(
    weights.dribbleBase +
      (dribble * weights.dribbleWeight + control * weights.dribbleControlWeight) *
        (weights.dribbleSpaceFloor + space * 0.5) +
      goalPull * weights.dribbleGoalWeight -
      pressure * weights.dribblePressureWeight,
    0,
    1.2,
  );
}

function clearScore(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  distanceToGoal: number,
  pressure: number,
  technical: (rating: number) => number,
): number {
  const ownGoal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const fromOwnGoal = Math.hypot(
    player.x - ownGoal.lineX,
    player.y - ownGoal.centreY,
  );
  if (fromOwnGoal > TUNING.ai.clearZoneDepthM) {
    return -Infinity;
  }
  const defender =
    player.role === "CB" ||
    player.role === "LB" ||
    player.role === "RB" ||
    player.role === "CDM";
  return clamp(
    0.2 +
      pressure * 0.5 +
      (defender ? 0.15 : 0) -
      technical(player.attributes.composure) * 0.12 -
      clamp(distanceToGoal / 80, 0, 0.2),
    0,
    1.2,
  );
}

function buildUpStyleScore(
  style: TeamState["tactics"]["buildUpStyle"],
  distance: number,
  forward: number,
): number {
  if (style === "short") {
    return distance <= TUNING.ai.passShortRangeM
      ? 0.16
      : -0.06;
  }
  if (style === "direct") {
    return distance >= TUNING.ai.passShortRangeM || forward > 15
      ? 0.16
      : -0.04;
  }
  return forward > 0 ? 0.06 : 0.02;
}

function passLaneClearance(
  state: MatchState,
  from: PlayerState,
  to: PlayerState,
): number {
  const opponents =
    from.team === "home" ? state.away.players : state.home.players;
  let minimum = Infinity;
  for (const opponent of opponents) {
    if (!isAvailablePlayer(opponent)) {
      continue;
    }
    minimum = Math.min(
      minimum,
      distanceToSegment(
        opponent.x,
        opponent.y,
        from.x,
        from.y,
        to.x,
        to.y,
      ),
    );
  }
  return minimum === Infinity ? TUNING.ai.passLongRangeM : minimum;
}

function nearestOpponentDistance(
  state: MatchState,
  player: PlayerState,
): number {
  let nearest = Infinity;
  const opponents =
    player.team === "home" ? state.away.players : state.home.players;
  for (const opponent of opponents) {
    if (!isAvailablePlayer(opponent)) {
      continue;
    }
    nearest = Math.min(
      nearest,
      Math.hypot(opponent.x - player.x, opponent.y - player.y),
    );
  }
  return nearest;
}

function nearestOpponentDistanceTo(
  state: MatchState,
  team: TeamState,
  x: number,
  y: number,
): number {
  const opponents = team.side === "home" ? state.away.players : state.home.players;
  let nearest = Infinity;
  for (const opponent of opponents) {
    if (!isAvailablePlayer(opponent)) {
      continue;
    }
    nearest = Math.min(
      nearest,
      Math.hypot(opponent.x - x, opponent.y - y),
    );
  }
  return nearest;
}

function executeShot(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  goal: GoalGeometry,
  rng: Rng,
  penalty: boolean,
): boolean {
  if (!beginKick(state, player, "shot")) {
    return false;
  }
  const difficulty = difficultyProfile(state.rules.aiDifficulty);
  const attackKeeper = (team.side === "home"
    ? state.away
    : state.home
  ).players.find((candidate) => candidate.role === "GK");
  const inset = TUNING.ball.radiusM * 2;
  const halfWidth = goal.widthM / 2 - inset - TUNING.ai.shootAimInsetM;
  const pressure = clamp(
    (TUNING.ai.pressDistanceM - nearestOpponentDistance(state, player)) /
      TUNING.ai.pressDistanceM,
    0,
    1,
  );
  const composure = clamp(player.attributes.composure / 99, 0, 1);
  const error =
    difficulty.shotAimErrorM *
    (1.55 - composure * 0.55) *
    (0.7 + pressure * 0.8);
  const keeperSide =
    attackKeeper === undefined
      ? 0
      : Math.sign(attackKeeper.y - goal.centreY);
  const preferredSide =
    keeperSide === 0 ? (rng.chance(0.5) ? 1 : -1) : -keeperSide;
  const aimOffset = penalty
    ? preferredSide * TUNING.ai.penaltyAimOffsetM
    : preferredSide * halfWidth * rng.range(0.35, 0.85);
  const targetY = clamp(
    goal.centreY + aimOffset + rng.range(-error, error),
    goal.centreY - goal.widthM / 2 + inset,
    goal.centreY + goal.widthM / 2 - inset,
  );
  const targetX = goal.lineX + goal.netDirection * TUNING.ai.shootAimDepthM;
  const distance = Math.hypot(goal.lineX - player.x, goal.centreY - player.y);
  const power = clamp(
    (TUNING.ai.shootPowerBaseMps +
      TUNING.ai.shootPowerRangeMps * (player.attributes.shotPower / 99) +
      (penalty ? TUNING.ai.penaltyPowerMps * 0.25 : 0)) /
      TUNING.ai.shootPowerBaseMps,
    0,
    1,
  );
  const lift = clamp(
    TUNING.ai.shootLiftBaseMps +
      TUNING.ai.shootLiftRangeMps * clamp(distance / 30, 0, 1),
    TUNING.ai.shootLiftBaseMps,
    TUNING.ai.shootLiftBaseMps + TUNING.ai.shootLiftRangeMps,
  );
  const curveSign = aimOffset >= 0 ? 1 : -1;
  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed:
      TUNING.ai.shootPowerBaseMps +
      TUNING.ai.shootPowerRangeMps * power,
    lift,
    spinY: -TUNING.ai.shotBackspinRadPerS,
    spinZ:
      curveSign *
      TUNING.ai.shotCurveSpinRadPerS *
      clamp(player.attributes.curve / 99, 0, 1),
    velocityTransfer: TUNING.ai.shootVelocityTransfer,
  });
  markAction(player, "shoot", TUNING.player.kickCooldownSeconds);
  return true;
}

/**
 * A mistimed through ball: the AI sees a runner near the last line and plays
 * into the space before the run is reset. This is intentionally a small,
 * seeded share of passes so offside remains a genuine risk rather than a
 * scripted event.
 */
function executeOffsideIntent(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  rng: Rng,
): boolean {
  const line = offsideLineFor(state, team);
  const candidates = team.players.filter((candidate) => {
    if (
      candidate === player ||
      !isAvailablePlayer(candidate) ||
      candidate.role === "GK"
    ) {
      return false;
    }
    const beyond = (candidate.x - line) * team.attackDirection;
    const forward = (candidate.x - player.x) * team.attackDirection;
    const distance = Math.hypot(
      candidate.x - player.x,
      candidate.y - player.y,
    );
    return (
      beyond > 0 &&
      beyond < TUNING.ai.offsideIntentMaxBeyondM &&
      forward > TUNING.ai.minPassDistanceM &&
      distance <= TUNING.ai.passThroughRangeM
    );
  });
  if (candidates.length === 0) {
    return false;
  }
  candidates.sort(
    (a, b) =>
      nearestOpponentDistanceTo(state, team, b.x, b.y) -
        nearestOpponentDistanceTo(state, team, a.x, a.y) ||
      a.id.localeCompare(b.id),
  );
  const target = candidates[0];
  if (target === undefined) {
    return false;
  }
  const played = executePass(state, team, player, {
    target,
    score: 1,
    through: true,
    offside: true,
  }, rng);
  if (played) {
    state.offsidePassTargetId = target.id;
  }
  return played;
}

function executePass(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  option: PassOption,
  rng: Rng,
): boolean {
  if (!beginKick(state, player, "pass")) {
    return false;
  }
  const difficulty = difficultyProfile(state.rules.aiDifficulty);
  const target = option.target;
  const rawDistance = Math.hypot(
    target.x - player.x,
    target.y - player.y,
  );
  const speed =
    option.through
      ? clamp(
          rawDistance * TUNING.ai.throughPassSpeedPerMetre,
          TUNING.ai.passMinSpeedMps,
          TUNING.ai.passMaxSpeedMps,
        )
      : clamp(
          rawDistance * TUNING.ai.passSpeedPerMetre,
          TUNING.ai.passMinSpeedMps,
          TUNING.ai.passMaxSpeedMps,
        );
  const flightTime = clamp(
    rawDistance / speed,
    TUNING.ai.passMinFlightSeconds,
    TUNING.ai.passMaxFlightSeconds,
  );
  let targetX = target.x + target.vx * flightTime;
  let targetY = target.y + target.vy * flightTime;
  if (option.through) {
    targetX += team.attackDirection *
      (option.offside
        ? TUNING.ai.offsideIntentLeadM
        : TUNING.ai.runnerLeadM);
  }
  const distance = Math.hypot(targetX - player.x, targetY - player.y);
  const pressure = clamp(
    (TUNING.ai.pressDistanceM - nearestOpponentDistance(state, player)) /
      TUNING.ai.pressDistanceM,
    0,
    1,
  );
  const error =
    difficulty.passErrorM *
    (1.5 - player.roleFamiliarity * 0.5) *
    (0.7 + pressure * 0.8) *
    (option.offside ? TUNING.ai.offsideIntentAccuracyFactor : 1);
  const errorAngle = rng.range(0, Math.PI * 2);
  const errorDistance = rng.chance(0.5) ? error : -error;
  targetX += Math.cos(errorAngle) * errorDistance;
  targetY += Math.sin(errorAngle) * errorDistance;
  const lift =
    distance > TUNING.ai.passShortRangeM
      ? TUNING.ai.passLiftMps * 3
      : TUNING.ai.passLiftMps;
  const spinZ =
    rng.range(-TUNING.ai.passCurveSpinRadPerS, TUNING.ai.passCurveSpinRadPerS) *
    clamp(player.attributes.curve / 99, 0, 1);
  kickBall(state.ball, player, {
    targetX,
    targetY,
    speed,
    lift,
    spinZ,
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(player, "pass", TUNING.player.kickCooldownSeconds);
  return true;
}

function executeDribble(
  state: MatchState,
  player: PlayerState,
  goal: GoalGeometry,
  rng: Rng,
): boolean {
  const nearestOpponent = closestOpponentTo(state, player);
  let targetX = goal.lineX;
  let targetY = goal.centreY;
  if (
    nearestOpponent !== null &&
    nearestOpponent.distance <= TUNING.ai.dribbleEvadeDistanceM
  ) {
    const goalAngle = Math.atan2(
      goal.centreY - player.y,
      goal.lineX - player.x,
    );
    const opponentAngle = Math.atan2(
      nearestOpponent.player.y - player.y,
      nearestOpponent.player.x - player.x,
    );
    const normalised = normalizeSigned(
      opponentAngle - goalAngle,
    );
    const side = normalised >= 0 ? -1 : 1;
    const evadeAngle =
      goalAngle + side * TUNING.ai.dribbleEvadeTurnRad;
    targetX =
      player.x +
      Math.cos(evadeAngle) * TUNING.ai.dribbleEvadeTargetM;
    targetY =
      player.y +
      Math.sin(evadeAngle) * TUNING.ai.dribbleEvadeTargetM;
  }
  if (!beginKick(state, player, "dribble")) {
    return false;
  }
  const control = clamp(player.attributes.ballControl / 99, 0, 1);
  const speed = lerp(
    TUNING.ai.dribbleTouchSpeedMps * 0.7,
    TUNING.ai.dribbleTouchSpeedMps,
    control,
  );
  kickBall(state.ball, player, {
    targetX: clamp(
      targetX,
      TUNING.player.pitchMarginM,
      state.pitch.lengthM - TUNING.player.pitchMarginM,
    ),
    targetY: clamp(
      targetY,
      TUNING.player.pitchMarginM,
      state.pitch.widthM - TUNING.player.pitchMarginM,
    ),
    speed,
    lift: 0,
    spinZ: rng.range(-TUNING.ai.passCurveSpinRadPerS, TUNING.ai.passCurveSpinRadPerS) * 0.2,
    velocityTransfer: TUNING.ai.dribbleVelocityTransfer,
  });
  markAction(player, "dribble", TUNING.ai.dribbleCooldownSeconds);
  return true;
}

function executeClear(
  state: MatchState,
  team: TeamState,
  player: PlayerState,
  rng: Rng,
): boolean {
  if (!beginKick(state, player, "clear")) {
    return false;
  }
  const side = rng.chance(0.5) ? 1 : -1;
  const flankY = clamp(
    state.pitch.centreY + side * state.pitch.widthM * 0.32,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );
  const targetX =
    player.x + team.attackDirection * TUNING.ai.keeperClearSpreadM * 2;
  kickBall(state.ball, player, {
    targetX,
    targetY: flankY,
    speed: TUNING.ai.keeperClearPowerMps,
    lift: TUNING.ai.keeperClearLiftMps,
    spinY: -TUNING.ai.shotBackspinRadPerS,
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(player, "pass", TUNING.player.kickCooldownSeconds);
  return true;
}

function keeperDistribution(
  state: MatchState,
  team: TeamState,
  keeper: PlayerState,
  rng: Rng,
): boolean {
  const ownGoal = getDefendingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const distanceFromGoal = Math.hypot(
    keeper.x - ownGoal.lineX,
    keeper.y - ownGoal.centreY,
  );
  if (
    distanceFromGoal > TUNING.ai.clearZoneDepthM ||
    nearestOpponentDistance(state, keeper) < TUNING.ai.clearPressureM
  ) {
    return executeClear(state, team, keeper, rng);
  }
  const pass = bestPassOption(
    state,
    team,
    keeper,
    clamp(
      (TUNING.ai.pressDistanceM - nearestOpponentDistance(state, keeper)) /
        TUNING.ai.pressDistanceM,
      0,
      1,
    ),
    difficultyProfile(state.rules.aiDifficulty).throughBias,
    (rating) => clamp(rating / 99, 0, 1) * keeper.roleFamiliarity,
  );
  if (pass !== null && pass.score > 0.3) {
    return executePass(state, team, keeper, pass, rng);
  }
  return executeClear(state, team, keeper, rng);
}

function executeSetPiece(
  state: MatchState,
  player: PlayerState,
): boolean {
  const setPiece = state.referee.setPiece;
  if (setPiece === null || setPiece.takerId !== player.id) {
    return false;
  }
  if (setPiece.type === "penalty") {
    const team = player.team === "home" ? state.home : state.away;
    const goal = getAttackingGoalForDirection(
      state.pitch,
      team.attackDirection,
    );
    const rng = decisionRng(
      state.seed,
      state.tick,
      player.team,
      player.number + 5_000,
    );
    return executeShot(state, team, player, goal, rng, true);
  }
  if (setPiece.type === "corner") {
    return executeCorner(state, player);
  }
  if (
    setPiece.type === "directFreeKick" ||
    setPiece.type === "indirectFreeKick"
  ) {
    return executeFreeKick(state, player);
  }
  if (setPiece.type === "goalKick") {
    return executeGoalKick(state, player);
  }
  if (setPiece.type === "throwIn") {
    return executeThrowIn(state, player);
  }
  return false;
}

function executeCorner(state: MatchState, player: PlayerState): boolean {
  if (!beginKick(state, player, "pass")) {
    return false;
  }
  const team = player.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const nearPost = state.ball.y <= state.pitch.centreY;
  const nearY = goal.centreY + (nearPost ? -1 : 1) * goal.widthM * 0.28;
  const farY = goal.centreY + (nearPost ? 1 : -1) * goal.widthM * 0.3;
  const targetY = Math.abs(player.attributes.curve - 50) > 10
    ? farY
    : nearY;
  kickBall(state.ball, player, {
    targetX: goal.lineX - team.attackDirection * TUNING.ai.shootAimDepthM,
    targetY,
    speed: TUNING.ai.cornerDeliverySpeedMps,
    lift: TUNING.ai.cornerDeliveryLiftMps,
    spinY: -TUNING.ai.shotBackspinRadPerS * 0.4,
    spinZ:
      (nearPost ? 1 : -1) *
      TUNING.ai.passCurveSpinRadPerS *
      (player.attributes.curve / 99),
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(player, "pass", TUNING.player.kickCooldownSeconds);
  return true;
}

function executeFreeKick(
  state: MatchState,
  player: PlayerState,
): boolean {
  const team = player.team === "home" ? state.home : state.away;
  const goal = getAttackingGoalForDirection(
    state.pitch,
    team.attackDirection,
  );
  const distance = Math.hypot(
    goal.lineX - player.x,
    goal.centreY - player.y,
  );
  const rng = decisionRng(
    state.seed,
    state.tick,
    player.team,
    player.number + 6_000,
  );
  if (
    distance <= TUNING.ai.freeKickDirectRangeM &&
    state.referee.setPiece?.type === "directFreeKick"
  ) {
    return executeShot(state, team, player, goal, rng, false);
  }
  if (!beginKick(state, player, "pass")) {
    return false;
  }
  const nearPost = goal.centreY - goal.widthM * 0.25;
  const farPost = goal.centreY + goal.widthM * 0.25;
  const targetY = rng.chance(0.5) ? nearPost : farPost;
  kickBall(state.ball, player, {
    targetX: goal.lineX - team.attackDirection * TUNING.ai.shootAimDepthM,
    targetY,
    speed: TUNING.ai.cornerDeliverySpeedMps,
    lift: TUNING.ai.cornerDeliveryLiftMps,
    spinZ: rng.range(
      -TUNING.ai.passCurveSpinRadPerS,
      TUNING.ai.passCurveSpinRadPerS,
    ),
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(player, "pass", TUNING.player.kickCooldownSeconds);
  return true;
}

function executeGoalKick(state: MatchState, player: PlayerState): boolean {
  if (!beginKick(state, player, "pass")) {
    return false;
  }
  const team = player.team === "home" ? state.home : state.away;
  const direction = team.attackDirection;
  const style = team.tactics.buildUpStyle;
  const rng = decisionRng(
    state.seed,
    state.tick,
    player.team,
    player.number + 7_000,
  );
  if (style === "short" && rng.chance(0.7)) {
    const target = team.players
      .filter(
        (candidate) =>
          candidate.role !== "GK" &&
          candidate.role !== "ST" &&
          candidate.role !== "CF",
      )
      .sort(
        (a, b) =>
          nearestOpponentDistanceTo(state, team, b.x, b.y) -
          nearestOpponentDistanceTo(state, team, a.x, a.y),
      )[0];
    if (target !== undefined) {
      kickBall(state.ball, player, {
        targetX: target.x,
        targetY: target.y,
        speed: TUNING.ai.passMinSpeedMps +
          Math.hypot(target.x - player.x, target.y - player.y) *
            TUNING.ai.passSpeedPerMetre,
        lift: TUNING.ai.passLiftMps,
        velocityTransfer: TUNING.ai.passVelocityTransfer,
      });
      markAction(player, "pass", TUNING.player.kickCooldownSeconds);
      return true;
    }
  }
  const flank = clamp(
    state.pitch.centreY + (rng.chance(0.5) ? 1 : -1) * state.pitch.widthM * 0.3,
    TUNING.player.pitchMarginM,
    state.pitch.widthM - TUNING.player.pitchMarginM,
  );
  kickBall(state.ball, player, {
    targetX: player.x + direction * TUNING.ai.keeperClearSpreadM * 2.5,
    targetY: flank,
    speed: TUNING.ai.keeperClearPowerMps,
    lift: TUNING.ai.keeperClearLiftMps,
    velocityTransfer: TUNING.ai.passVelocityTransfer,
  });
  markAction(player, "pass", TUNING.player.kickCooldownSeconds);
  return true;
}

function executeThrowIn(state: MatchState, player: PlayerState): boolean {
  if (!beginKick(state, player, "pass")) {
    return false;
  }
  const team = player.team === "home" ? state.home : state.away;
  const target = team.players
    .filter((candidate) => candidate !== player && candidate.role !== "GK")
    .sort(
      (a, b) =>
        Math.hypot(a.x - player.x, a.y - player.y) -
        Math.hypot(b.x - player.x, b.y - player.y),
    )[0];
  if (target !== undefined) {
    kickBall(state.ball, player, {
      targetX: target.x,
      targetY: target.y,
      speed: clamp(
        Math.hypot(target.x - player.x, target.y - player.y) *
          TUNING.ai.passSpeedPerMetre,
        TUNING.ai.passMinSpeedMps,
        TUNING.ai.passMaxSpeedMps,
      ),
      lift: TUNING.ai.passLiftMps,
      velocityTransfer: TUNING.ai.passVelocityTransfer,
    });
    markAction(player, "pass", TUNING.player.kickCooldownSeconds);
    return true;
  }
  return false;
}

function markAction(
  player: PlayerState,
  action: "dribble" | "pass" | "shoot",
  cooldownSeconds: number,
): void {
  player.state = action;
  player.actionTimer = TUNING.player.actionStateSeconds;
  player.kickCooldown = cooldownSeconds;
}

function closestOpponentTo(
  state: MatchState,
  player: PlayerState,
): { player: PlayerState; distance: number } | null {
  const opponents =
    player.team === "home" ? state.away.players : state.home.players;
  let best: { player: PlayerState; distance: number } | null = null;
  for (const opponent of opponents) {
    if (!isAvailablePlayer(opponent)) {
      continue;
    }
    const distance = Math.hypot(
      opponent.x - player.x,
      opponent.y - player.y,
    );
    if (best === null || distance < best.distance) {
      best = { player: opponent, distance };
    }
  }
  return best;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function normalizeSigned(angle: number): number {
  let value = angle;
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  while (value < -Math.PI) {
    value += Math.PI * 2;
  }
  return value;
}
