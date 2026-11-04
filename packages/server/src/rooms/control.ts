// packages/server/src/rooms/control.ts
import {
  CONTROL_BUTTONS,
  TUNING,
  type InputFrame,
} from "@fb/shared";
import {
  heldBySetPiece,
  isAvailablePlayer,
  isInsidePenaltyArea,
  playDribbleTouch,
  playPass,
  playShot,
  playSkillMove,
  playTackle,
  topSpeedFor,
  type MatchState,
  type PassKind,
  type PlayerState,
  type TeamSide,
} from "@fb/sim";
import type { SnapshotControlState } from "./match-stream";

const SKILL_BUTTON_BITS =
  CONTROL_BUTTONS.SKILL_UP |
  CONTROL_BUTTONS.SKILL_DOWN |
  CONTROL_BUTTONS.SKILL_LEFT |
  CONTROL_BUTTONS.SKILL_RIGHT;

export interface TeamControlRuntime {
  activePlayerId: string | null;
  input: InputFrame | null;
  lastInputSeq: number;
  lastInputAtMs: number;
  previousButtons: number;
  /** Press edges collected from every queued frame, not just the latest. */
  pendingPresses: number;
  /** Release edges collected from every queued frame, not just the latest. */
  pendingReleases: number;
  receivedButtons: number;
  shootCharge: number;
  /** Pass button currently held through the release-to-kick charge, if any. */
  passChargeKind: PassKind | null;
  passCharge: number;
  switchCooldown: number;
  autoSwitchCooldown: number;
  idleSeconds: number;
  dribbleCooldown: number;
  /** Clock time of the last deliberate pass/shot, for kick grace. */
  lastKickAtMs: number;
  bufferedPass: BufferedPass | null;
  bufferedShot: BufferedShot | null;
}

interface BufferedPass {
  readonly kind: PassKind;
  readonly aimX: number;
  readonly aimY: number;
  readonly power: number;
  readonly driven: boolean;
  remainingSeconds: number;
}

interface BufferedShot {
  readonly aimX: number;
  readonly aimY: number;
  readonly power: number;
  readonly finesse: boolean;
  remainingSeconds: number;
}

export function createTeamControlRuntime(): TeamControlRuntime {
  return {
    activePlayerId: null,
    input: null,
    lastInputSeq: 0,
    lastInputAtMs: 0,
    previousButtons: 0,
    pendingPresses: 0,
    pendingReleases: 0,
    receivedButtons: 0,
    shootCharge: 0,
    passChargeKind: null,
    passCharge: 0,
    switchCooldown: 0,
    autoSwitchCooldown: 0,
    idleSeconds: 0,
    dribbleCooldown: 0,
    lastKickAtMs: 0,
    bufferedPass: null,
    bufferedShot: null,
  };
}

export function updateControlInput(
  runtime: TeamControlRuntime,
  frame: InputFrame,
  nowMs: number,
): boolean {
  if (frame.seq <= runtime.lastInputSeq) {
    return false;
  }
  const previous = runtime.receivedButtons;
  runtime.pendingPresses |= frame.buttons & ~previous;
  runtime.pendingReleases |= previous & ~frame.buttons;
  runtime.receivedButtons = frame.buttons;
  runtime.previousButtons = frame.buttons;
  runtime.input = frame;
  runtime.lastInputSeq = frame.seq;
  runtime.lastInputAtMs = nowMs;
  return true;
}

/** A reloaded/reconnected page restarts its input sequence at zero. */
export function markControlReconnected(runtime: TeamControlRuntime): void {
  runtime.input = null;
  runtime.lastInputSeq = 0;
  runtime.lastInputAtMs = 0;
  runtime.previousButtons = 0;
  runtime.pendingPresses = 0;
  runtime.pendingReleases = 0;
  runtime.receivedButtons = 0;
  runtime.shootCharge = 0;
  runtime.passChargeKind = null;
  runtime.passCharge = 0;
  runtime.dribbleCooldown = 0;
  runtime.idleSeconds = 0;
  runtime.bufferedPass = null;
  runtime.bufferedShot = null;
}

/**
 * Select the controlled player, route movement targets and execute discrete
 * button actions for one team tick. Player bodies with isUserControlled are
 * ignored by the placeholder AI, so this runs immediately before stepMatch.
 */
export function prepareTeamControl(
  state: MatchState,
  side: TeamSide,
  runtime: TeamControlRuntime,
  dt: number,
): void {
  const team = side === "home" ? state.home : state.away;
  const ballInOwnBox = isInsidePenaltyArea(
    state.pitch,
    side,
    state.ball.x,
    state.ball.y,
  );
  runtime.switchCooldown = Math.max(0, runtime.switchCooldown - dt);
  runtime.autoSwitchCooldown = Math.max(0, runtime.autoSwitchCooldown - dt);
  runtime.dribbleCooldown = Math.max(0, runtime.dribbleCooldown - dt);
  tickActionBuffers(runtime, dt);

  const fresh =
    runtime.input !== null &&
    Date.now() - runtime.lastInputAtMs <= TUNING.control.inputStaleMs;
  const input = fresh ? runtime.input : null;
  const moveX = input?.moveX ?? 0;
  const moveY = input?.moveY ?? 0;
  const buttons = input?.buttons ?? 0;
  const pressed = fresh ? runtime.pendingPresses : 0;
  const released = fresh ? runtime.pendingReleases : 0;
  const steerMagnitude = Math.hypot(moveX, moveY);
  runtime.idleSeconds =
    steerMagnitude < TUNING.control.autoSwitchSteerDeadzone
      ? runtime.idleSeconds + dt
      : 0;

  let active = findPlayer(team.players, runtime.activePlayerId);
  if (active !== null && heldBySetPiece(state, active)) {
    active = null;
    runtime.autoSwitchCooldown = 0;
    clearPassCharge(runtime);
  }
  if (active === null) {
    active = nearestCandidate(state, side, ballInOwnBox, null);
  }

  let switched = false;

  if (
    active !== null &&
    fresh &&
    (pressed & CONTROL_BUTTONS.SWITCH) !== 0 &&
    runtime.switchCooldown <= 0
  ) {
    active = nextSwitchCandidate(state, side, active, ballInOwnBox);
    runtime.switchCooldown = TUNING.control.switchCooldownSeconds;
    runtime.autoSwitchCooldown =
      TUNING.control.manualSwitchAutoLockSeconds;
    runtime.idleSeconds = 0;
    runtime.shootCharge = 0;
    clearPassCharge(runtime);
    clearActionBuffers(runtime);
    switched = true;
  } else if (
    !switched &&
    runtime.autoSwitchCooldown <= 0 &&
    runtime.shootCharge <= 0 &&
    runtime.passChargeKind === null &&
    (runtime.idleSeconds >= TUNING.control.autoSwitchIdleSeconds ||
      (active?.role === "GK" && !ballInOwnBox))
  ) {
    const auto = chooseAutoSwitch(
      state,
      side,
      active,
      ballInOwnBox,
    );
    if (auto !== null) {
      active = auto;
      runtime.autoSwitchCooldown =
        TUNING.control.autoSwitchCooldownSeconds;
      runtime.idleSeconds = 0;
      runtime.shootCharge = 0;
      clearPassCharge(runtime);
      clearActionBuffers(runtime);
      switched = true;
    }
  }

  if (
    runtime.activePlayerId !== null &&
    active?.id !== runtime.activePlayerId
  ) {
    clearPassCharge(runtime);
  }
  runtime.activePlayerId = active?.id ?? null;
  for (const player of team.players) {
    player.isUserControlled = player === active;
  }

  if (active !== null) {
    applyMovement(active, state, moveX, moveY, buttons, input !== null);
    if (!switched && input !== null) {
      applyActions(active, state, runtime, input, pressed, released, dt);
      const actionPressed =
        (pressed &
          (CONTROL_BUTTONS.TACKLE |
            CONTROL_BUTTONS.LOB |
            CONTROL_BUTTONS.THROUGH |
            CONTROL_BUTTONS.PASS |
            SKILL_BUTTON_BITS)) !==
        0;
      const shootReleased = (released & CONTROL_BUTTONS.SHOOT) !== 0;
      const passReleased =
        (released &
          (CONTROL_BUTTONS.PASS |
            CONTROL_BUTTONS.LOB |
            CONTROL_BUTTONS.THROUGH)) !==
        0;
      if (
        !actionPressed &&
        !shootReleased &&
        !passReleased &&
        runtime.passChargeKind === null
      ) {
        applyBufferedAction(state, active, runtime);
      }
      applyDribbleControl(active, state, runtime, input, buttons, dt);
    }
  }

  runtime.pendingPresses = 0;
  runtime.pendingReleases = 0;
  runtime.previousButtons = buttons;
  if (!fresh) {
    runtime.shootCharge = 0;
    runtime.passChargeKind = null;
    runtime.passCharge = 0;
    runtime.pendingPresses = 0;
    runtime.pendingReleases = 0;
    runtime.receivedButtons = 0;
    clearActionBuffers(runtime);
  }
}

export function controlSnapshotIndices(
  state: MatchState,
  home: TeamControlRuntime,
  away: TeamControlRuntime,
): SnapshotControlState {
  const homeIndex = state.home.players.findIndex(
    (player) => player.id === home.activePlayerId,
  );
  const awayLocal = state.away.players.findIndex(
    (player) => player.id === away.activePlayerId,
  );
  return {
    home: homeIndex,
    away: awayLocal < 0 ? -1 : awayLocal + state.home.players.length,
  };
}

function applyMovement(
  player: PlayerState,
  state: MatchState,
  moveX: number,
  moveY: number,
  buttons: number,
  hasInput: boolean,
): void {
  const magnitude = Math.min(1, Math.hypot(moveX, moveY));
  if (!hasInput || magnitude < 0.05) {
    player.targetX = player.x;
    player.targetY = player.y;
    player.targetSpeed = 0;
    return;
  }

  const dirX = moveX / magnitude;
  const dirY = moveY / magnitude;
  const distance = TUNING.control.inputMoveTargetDistanceM;
  player.targetX = Math.max(
    TUNING.player.pitchMarginM,
    Math.min(state.pitch.lengthM - TUNING.player.pitchMarginM, player.x + dirX * distance),
  );
  player.targetY = Math.max(
    TUNING.player.pitchMarginM,
    Math.min(state.pitch.widthM - TUNING.player.pitchMarginM, player.y + dirY * distance),
  );
  const sprint = (buttons & CONTROL_BUTTONS.SPRINT) !== 0;
  player.targetSpeed =
    topSpeedFor(player.attributes) *
    (sprint ? 1 : TUNING.control.jogSpeedFactor) *
    magnitude;
}

function applyActions(
  player: PlayerState,
  state: MatchState,
  runtime: TeamControlRuntime,
  input: InputFrame,
  pressed: number,
  released: number,
  dt: number,
): void {
  if (heldBySetPiece(state, player)) {
    return;
  }
  const aim = normalizedAim(input.moveX, input.moveY);
  const passAim = Math.hypot(input.moveX, input.moveY) >=
    TUNING.control.aimDeadzone
    ? aim
    : { x: 0, y: 0 };

  let actionAttempted = false;
  const skillDirection = skillDirectionFromPress(pressed, player);
  const passPressKind =
    (pressed & CONTROL_BUTTONS.LOB) !== 0
      ? "lob"
      : (pressed & CONTROL_BUTTONS.THROUGH) !== 0
        ? "through"
        : (pressed & CONTROL_BUTTONS.PASS) !== 0
          ? "pass"
          : null;

  if ((pressed & CONTROL_BUTTONS.TACKLE) !== 0) {
    actionAttempted = true;
    clearActionBuffers(runtime);
    clearPassCharge(runtime);
    runtime.shootCharge = 0;
    if (playTackle(state, player)) {
      runtime.dribbleCooldown = TUNING.control.dribbleTouchIntervalSeconds;
    }
  } else if (
    passPressKind !== null &&
    (input.buttons & CONTROL_BUTTONS.SHOOT) === 0
  ) {
    actionAttempted = true;
    clearActionBuffers(runtime);
    runtime.passChargeKind = passPressKind;
    runtime.passCharge = 0;
    runtime.shootCharge = 0;
  } else if (
    skillDirection !== null &&
    runtime.passChargeKind === null &&
    (input.buttons & CONTROL_BUTTONS.SHOOT) === 0
  ) {
    actionAttempted = true;
    clearActionBuffers(runtime);
    runtime.shootCharge = 0;
    if (playSkillMove(state, player, skillDirection.x, skillDirection.y)) {
      runtime.dribbleCooldown =
        TUNING.control.dribbleTouchIntervalSeconds;
      runtime.lastKickAtMs = runtime.lastInputAtMs;
    }
  }

  if (runtime.passChargeKind !== null) {
    const passKind = runtime.passChargeKind;
    const passBit = passButtonBit(passKind);
    const passHeld = (input.buttons & passBit) !== 0;
    if (passHeld) {
      runtime.passCharge = Math.min(
        1,
        runtime.passCharge + dt / TUNING.control.passChargeSeconds,
      );
    }
    if (!passHeld || (released & passBit) !== 0) {
      const power = Math.max(
        TUNING.control.minPassPower,
        runtime.passCharge,
      );
      const driven = (input.buttons & CONTROL_BUTTONS.DRIVEN_PASS) !== 0;
      clearPassCharge(runtime);
      actionAttempted = true;
      if (
        playPass(
          state,
          player,
          passKind,
          passAim.x,
          passAim.y,
          power,
          driven,
        )
      ) {
        clearActionBuffers(runtime);
        runtime.shootCharge = 0;
        runtime.dribbleCooldown =
          TUNING.control.dribbleTouchIntervalSeconds;
        runtime.lastKickAtMs = runtime.lastInputAtMs;
      } else {
        runtime.bufferedPass = {
          kind: passKind,
          aimX: passAim.x,
          aimY: passAim.y,
          power,
          driven,
          remainingSeconds: TUNING.control.actionBufferSeconds,
        };
      }
    }
  }

  const shootHeld = (input.buttons & CONTROL_BUTTONS.SHOOT) !== 0;
  const shootReleased = (released & CONTROL_BUTTONS.SHOOT) !== 0;

  if ((pressed & CONTROL_BUTTONS.SHOOT) !== 0) {
    runtime.bufferedShot = null;
    clearPassCharge(runtime);
  }

  if (shootHeld) {
    runtime.shootCharge = Math.min(
      1,
      runtime.shootCharge + dt / TUNING.control.shotChargeSeconds,
    );
  }

  if (shootReleased) {
    const power = Math.max(
      TUNING.control.minShotPower,
      runtime.shootCharge,
    );
    const finesse = (input.buttons & CONTROL_BUTTONS.FINESSE) !== 0;
    runtime.shootCharge = 0;
    if (!actionAttempted) {
      const committed =
        player.role === "GK"
          ? playPass(
              state,
              player,
              "lob",
              passAim.x,
              passAim.y,
              power,
            )
          : playShot(state, player, passAim.x, passAim.y, power, finesse);
      if (committed) {
        clearActionBuffers(runtime);
        runtime.dribbleCooldown =
          TUNING.control.dribbleTouchIntervalSeconds;
        runtime.lastKickAtMs = runtime.lastInputAtMs;
      } else {
        runtime.bufferedShot = {
          aimX: passAim.x,
          aimY: passAim.y,
          power,
          finesse,
          remainingSeconds: TUNING.control.actionBufferSeconds,
        };
      }
    }
  }
}

function tickActionBuffers(
  runtime: TeamControlRuntime,
  dt: number,
): void {
  if (runtime.bufferedPass !== null) {
    runtime.bufferedPass.remainingSeconds -= dt;
    if (runtime.bufferedPass.remainingSeconds <= 0) {
      runtime.bufferedPass = null;
    }
  }
  if (runtime.bufferedShot !== null) {
    runtime.bufferedShot.remainingSeconds -= dt;
    if (runtime.bufferedShot.remainingSeconds <= 0) {
      runtime.bufferedShot = null;
    }
  }
}

function clearActionBuffers(runtime: TeamControlRuntime): void {
  runtime.bufferedPass = null;
  runtime.bufferedShot = null;
}

function clearPassCharge(runtime: TeamControlRuntime): void {
  runtime.passChargeKind = null;
  runtime.passCharge = 0;
}

function passButtonBit(kind: PassKind): number {
  if (kind === "lob") {
    return CONTROL_BUTTONS.LOB;
  }
  if (kind === "through") {
    return CONTROL_BUTTONS.THROUGH;
  }
  return CONTROL_BUTTONS.PASS;
}

function skillDirectionFromPress(
  pressed: number,
  player: PlayerState,
): { readonly x: number; readonly y: number } | null {
  const forward =
    (pressed & CONTROL_BUTTONS.SKILL_UP) !== 0
      ? 1
      : 0;
  const back =
    (pressed & CONTROL_BUTTONS.SKILL_DOWN) !== 0
      ? 1
      : 0;
  const right =
    (pressed & CONTROL_BUTTONS.SKILL_RIGHT) !== 0
      ? 1
      : 0;
  const left =
    (pressed & CONTROL_BUTTONS.SKILL_LEFT) !== 0
      ? 1
      : 0;
  const forwardAmount = forward - back;
  const rightAmount = right - left;
  if (forwardAmount === 0 && rightAmount === 0) {
    return null;
  }
  const forwardX = Math.cos(player.facing);
  const forwardY = Math.sin(player.facing);
  const rightX = -forwardY;
  const rightY = forwardX;
  const x = forwardAmount * forwardX + rightAmount * rightX;
  const y = forwardAmount * forwardY + rightAmount * rightY;
  const length = Math.hypot(x, y);
  return length < 1e-6
    ? null
    : { x: x / length, y: y / length };
}

function applyBufferedAction(
  state: MatchState,
  player: PlayerState,
  runtime: TeamControlRuntime,
): void {
  if (heldBySetPiece(state, player)) {
    return;
  }
  const pass = runtime.bufferedPass;
  if (pass !== null) {
    if (
      playPass(
        state,
        player,
        pass.kind,
        pass.aimX,
        pass.aimY,
        pass.power,
        pass.driven,
      )
    ) {
      clearActionBuffers(runtime);
      runtime.dribbleCooldown = TUNING.control.dribbleTouchIntervalSeconds;
      runtime.lastKickAtMs = runtime.lastInputAtMs;
      return;
    }
  }

  const shot = runtime.bufferedShot;
  if (shot === null) {
    return;
  }
  const committed =
    player.role === "GK"
      ? playPass(
          state,
          player,
          "lob",
          shot.aimX,
          shot.aimY,
          shot.power,
        )
      : playShot(
          state,
          player,
          shot.aimX,
          shot.aimY,
          shot.power,
          shot.finesse,
        );
  if (committed) {
    runtime.bufferedShot = null;
    runtime.dribbleCooldown = TUNING.control.dribbleTouchIntervalSeconds;
    runtime.lastKickAtMs = runtime.lastInputAtMs;
  }
}

function applyDribbleControl(
  player: PlayerState,
  state: MatchState,
  runtime: TeamControlRuntime,
  input: InputFrame,
  buttons: number,
  dt: number,
): void {
  const ballDistance = Math.hypot(
    state.ball.x - player.x,
    state.ball.y - player.y,
  );
  const moveMagnitude = Math.hypot(input.moveX, input.moveY);
  if (
    ballDistance <= TUNING.control.dribbleAcquireRadiusM &&
    state.ball.z <= TUNING.ai.controlMaxBallHeightM &&
    moveMagnitude < TUNING.control.dribbleMinMoveMagnitude
  ) {
    // Stopping with the ball is part of close control: without extra braking
    // momentum carries a sprinter straight over the ball.
    const damping = Math.exp(
      -TUNING.control.onBallBrakePerSecond * dt,
    );
    player.vx *= damping;
    player.vy *= damping;
    const sinceKickSeconds =
      (runtime.lastInputAtMs - runtime.lastKickAtMs) / 1000;
    if (
      sinceKickSeconds >
      TUNING.control.possessionBrakeKickGraceSeconds
    ) {
      // Cushion the ball too, otherwise the last dribble touch keeps rolling
      // away from a player who has already stopped.
      const ballDamping = Math.exp(
        -TUNING.control.possessionBallBrakeRatePerSecond * dt,
      );
      state.ball.vx *= ballDamping;
      state.ball.vy *= ballDamping;
    }
    return;
  }
  if (
    runtime.dribbleCooldown > 0 ||
    player.kickCooldown > 0 ||
    moveMagnitude < TUNING.control.dribbleMinMoveMagnitude
  ) {
    return;
  }
  if (
    player.state === "slide" ||
    player.state === "tackle" ||
    player.state === "pass" ||
    player.state === "shoot" ||
    player.state === "volley" ||
    player.state === "header"
  ) {
    return;
  }
  if (
    ballDistance > TUNING.control.dribbleAcquireRadiusM ||
    state.ball.z > TUNING.ai.controlMaxBallHeightM
  ) {
    return;
  }
  if (
    Math.hypot(state.ball.vx, state.ball.vy) >
    TUNING.control.dribbleMaxBallSpeedMps
  ) {
    return;
  }

  const nearestTeammate = closestToBall(state, player.team);
  if (
    nearestTeammate !== null &&
    nearestTeammate.player !== player &&
    nearestTeammate.distance <
      ballDistance - TUNING.control.dribbleOpponentClearanceM
  ) {
    return;
  }
  const nearestOpponent = closestToBall(
    state,
    player.team === "home" ? "away" : "home",
  );
  if (
    nearestOpponent !== null &&
    nearestOpponent.distance <
      ballDistance - TUNING.control.dribbleOpponentClearanceM
  ) {
    return;
  }

  const sprinting = (buttons & CONTROL_BUTTONS.SPRINT) !== 0;
  if (
    playDribbleTouch(
      state,
      player,
      input.moveX,
      input.moveY,
      sprinting,
    )
  ) {
    runtime.dribbleCooldown =
      TUNING.control.dribbleTouchIntervalSeconds *
      (sprinting ? TUNING.control.dribbleSprintIntervalFactor : 1);
  }
}

function closestToBall(
  state: MatchState,
  side: TeamSide,
): { readonly player: PlayerState; readonly distance: number } | null {
  const team = side === "home" ? state.home : state.away;
  let best: { player: PlayerState; distance: number } | null = null;
  for (const player of team.players) {
    if (!isAvailablePlayer(player)) {
      continue;
    }
    const distance = Math.hypot(
      player.x - state.ball.x,
      player.y - state.ball.y,
    );
    if (best === null || distance < best.distance) {
      best = { player, distance };
    }
  }
  return best;
}

function normalizedAim(moveX: number, moveY: number): { x: number; y: number } {
  const length = Math.hypot(moveX, moveY);
  if (length < 1e-6) {
    return { x: 0, y: 0 };
  }
  return { x: moveX / length, y: moveY / length };
}

function findPlayer(
  players: readonly PlayerState[],
  id: string | null,
): PlayerState | null {
  if (id === null) {
    return null;
  }
  return players.find(
    (player) => player.id === id && isAvailablePlayer(player),
  ) ?? null;
}

function nearestCandidate(
  state: MatchState,
  side: TeamSide,
  includeGoalkeeper: boolean,
  exclude: PlayerState | null,
): PlayerState | null {
  const team = side === "home" ? state.home : state.away;
  let best: PlayerState | null = null;
  let bestDistance = Infinity;

  for (const player of team.players) {
    if (
      player === exclude ||
      !isAvailablePlayer(player) ||
      heldBySetPiece(state, player)
    ) {
      continue;
    }
    if (player.role === "GK" && !includeGoalkeeper) {
      continue;
    }
    const distance = Math.hypot(
      player.x - state.ball.x,
      player.y - state.ball.y,
    );
    if (distance < bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }
  return best;
}

function nextSwitchCandidate(
  state: MatchState,
  side: TeamSide,
  active: PlayerState,
  includeGoalkeeper: boolean,
): PlayerState {
  const team = side === "home" ? state.home : state.away;
  const candidates = team.players
    .filter(
      (player) =>
        isAvailablePlayer(player) &&
        !heldBySetPiece(state, player) &&
        (player.role !== "GK" || includeGoalkeeper),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - state.ball.x, a.y - state.ball.y) -
        Math.hypot(b.x - state.ball.x, b.y - state.ball.y),
    );
  if (candidates.length === 0) {
    return active;
  }
  const index = candidates.indexOf(active);
  return candidates[(index + 1) % candidates.length] ?? active;
}

function chooseAutoSwitch(
  state: MatchState,
  side: TeamSide,
  active: PlayerState | null,
  ballInOwnBox: boolean,
): PlayerState | null {
  if (active === null || !isAvailablePlayer(active)) {
    return nearestCandidate(state, side, ballInOwnBox, null);
  }
  if (active.role === "GK" && !ballInOwnBox) {
    return nearestCandidate(state, side, false, null);
  }

  const activeDistance = Math.hypot(
    active.x - state.ball.x,
    active.y - state.ball.y,
  );
  if (activeDistance <= TUNING.control.possessionRadiusM) {
    return null;
  }

  const nearest = nearestCandidate(
    state,
    side,
    ballInOwnBox,
    active,
  );
  if (nearest === null) {
    return null;
  }
  const nearestDistance = Math.hypot(
    nearest.x - state.ball.x,
    nearest.y - state.ball.y,
  );

  if (
    nearestDistance <= TUNING.control.possessionRadiusM &&
    nearestDistance < activeDistance - 0.5
  ) {
    return nearest;
  }
  if (
    activeDistance > TUNING.control.autoSwitchDistanceM &&
    nearestDistance <
      activeDistance - TUNING.control.autoSwitchAdvantageM
  ) {
    return nearest;
  }
  return null;
}
