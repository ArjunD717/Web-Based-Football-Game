// packages/server/src/rooms/control.ts
import {
  CONTROL_BUTTONS,
  TUNING,
  type InputFrame,
} from "@fb/shared";
import {
  isInsidePenaltyArea,
  playPass,
  playShot,
  playTackle,
  topSpeedFor,
  type MatchState,
  type PlayerState,
  type TeamSide,
} from "@fb/sim";
import type { SnapshotControlState } from "./match-stream";

export interface TeamControlRuntime {
  activePlayerId: string | null;
  input: InputFrame | null;
  lastInputSeq: number;
  lastInputAtMs: number;
  previousButtons: number;
  shootCharge: number;
  switchCooldown: number;
  autoSwitchCooldown: number;
}

export function createTeamControlRuntime(): TeamControlRuntime {
  return {
    activePlayerId: null,
    input: null,
    lastInputSeq: 0,
    lastInputAtMs: 0,
    previousButtons: 0,
    shootCharge: 0,
    switchCooldown: 0,
    autoSwitchCooldown: 0,
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
  runtime.shootCharge = 0;
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

  const fresh =
    runtime.input !== null &&
    Date.now() - runtime.lastInputAtMs <= TUNING.control.inputStaleMs;
  const input = fresh ? runtime.input : null;
  const moveX = input?.moveX ?? 0;
  const moveY = input?.moveY ?? 0;
  const buttons = input?.buttons ?? 0;

  let active = findPlayer(team.players, runtime.activePlayerId);
  if (active === null) {
    active = nearestCandidate(state, side, ballInOwnBox, null);
  }

  const pressed = buttons & ~runtime.previousButtons;
  let switched = false;

  if (
    active !== null &&
    fresh &&
    (pressed & CONTROL_BUTTONS.SWITCH) !== 0 &&
    runtime.switchCooldown <= 0
  ) {
    active = nextSwitchCandidate(state, side, active, ballInOwnBox);
    runtime.switchCooldown = TUNING.control.switchCooldownSeconds;
    runtime.autoSwitchCooldown = TUNING.control.autoSwitchCooldownSeconds;
    runtime.shootCharge = 0;
    switched = true;
  } else if (!switched && runtime.autoSwitchCooldown <= 0) {
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
      runtime.shootCharge = 0;
      switched = true;
    }
  }

  runtime.activePlayerId = active?.id ?? null;
  for (const player of team.players) {
    player.isUserControlled = player === active;
  }

  if (active !== null) {
    applyMovement(active, state, moveX, moveY, buttons, input !== null);
    if (!switched && input !== null) {
      applyActions(active, state, runtime, input, dt);
    }
  }

  runtime.previousButtons = buttons;
  if (!fresh) {
    runtime.shootCharge = 0;
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
  dt: number,
): void {
  const pressed = input.buttons & ~runtime.previousButtons;
  const aim = normalizedAim(input.moveX, input.moveY);
  const passAim = Math.hypot(input.moveX, input.moveY) >=
    TUNING.control.aimDeadzone
    ? aim
    : { x: 0, y: 0 };

  let actionAttempted = false;

  if ((pressed & CONTROL_BUTTONS.TACKLE) !== 0) {
    actionAttempted = true;
    playTackle(state, player);
  } else if ((pressed & CONTROL_BUTTONS.LOB) !== 0) {
    actionAttempted = true;
    playPass(state, player, "lob", passAim.x, passAim.y);
  } else if ((pressed & CONTROL_BUTTONS.THROUGH) !== 0) {
    actionAttempted = true;
    playPass(state, player, "through", passAim.x, passAim.y);
  } else if ((pressed & CONTROL_BUTTONS.PASS) !== 0) {
    actionAttempted = true;
    playPass(state, player, "pass", passAim.x, passAim.y);
  }

  const shootHeld = (input.buttons & CONTROL_BUTTONS.SHOOT) !== 0;
  const shootReleased =
    shootHeld === false &&
    (runtime.previousButtons & CONTROL_BUTTONS.SHOOT) !== 0;

  if (shootHeld) {
    runtime.shootCharge = Math.min(
      1,
      runtime.shootCharge + dt / TUNING.control.shotChargeSeconds,
    );
  }

  if (shootReleased && !actionAttempted) {
    const power = Math.max(
      TUNING.control.minShotPower,
      runtime.shootCharge,
    );
    const finesse = (input.buttons & CONTROL_BUTTONS.FINESSE) !== 0;
    if (player.role === "GK") {
      playPass(state, player, "lob", passAim.x, passAim.y);
    } else {
      playShot(state, player, passAim.x, passAim.y, power, finesse);
    }
    runtime.shootCharge = 0;
  }
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
  return players.find((player) => player.id === id) ?? null;
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
    if (player === exclude) {
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
        player.role !== "GK" || includeGoalkeeper,
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
  if (active === null) {
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
