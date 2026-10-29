// packages/client/src/controller/main.ts
import {
  TUNING,
  isRoomCode,
  normalizeRoomCode,
  type LobbyRoomWire,
} from "@fb/shared";
import { TouchControls } from "../input/touch-controls";
import {
  GameClient,
  type GameClientState,
  type GameLinkStatus,
} from "../net/game-client";
import "./controller.css";

const TOAST_DURATION_MS = 2_400;
const STATUS_LABELS: Record<GameLinkStatus, string> = {
  connecting: "Connecting",
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
  fatal: "Connection error",
};

const connectionDot = byId<HTMLSpanElement>("connection-dot");
const connectionLabel = byId<HTMLElement>("connection-label");
const pingLabel = byId<HTMLElement>("ping-label");
const roomBadge = byId<HTMLElement>("room-badge");
const entryView = byId<HTMLElement>("entry-view");
const joinForm = byId<HTMLFormElement>("join-form");
const roomInput = byId<HTMLInputElement>("room-input");
const joinSubmit = byId<HTMLButtonElement>("join-submit");
const roomView = byId<HTMLElement>("room-view");
const roomCode = byId<HTMLElement>("room-code");
const roomPhase = byId<HTMLElement>("room-phase");
const roomStatus = byId<HTMLElement>("room-status");
const readyButton = byId<HTMLButtonElement>("ready");
const leaveRoomButton = byId<HTMLButtonElement>("leave-room");
const playView = byId<HTMLElement>("play-view");
const playChip = byId<HTMLElement>("play-chip");
const playRoom = byId<HTMLElement>("play-room");
const playScore = byId<HTMLElement>("play-score");
const playClock = byId<HTMLElement>("play-clock");
const playPhase = byId<HTMLElement>("play-phase");
const playPlayer = byId<HTMLElement>("play-player");
const leavePlayButton = byId<HTMLButtonElement>("leave-play");
const powerMeter = byId<HTMLElement>("controller-power");
const powerFill = byId<HTMLElement>("power-fill");
const powerValue = byId<HTMLElement>("power-value");
const overlay = byId<HTMLElement>("controller-overlay");
const overlayTitle = byId<HTMLElement>("overlay-title");
const overlayDetail = byId<HTMLElement>("overlay-detail");
const toast = byId<HTMLElement>("toast");

const client = new GameClient();
const controls = new TouchControls(playView);
const queryCode = readQueryRoomCode();
if (queryCode !== null) {
  roomInput.value = queryCode;
}

let currentState: GameClientState | null = null;
let autoJoinAttempted = false;
let lastStatus: GameLinkStatus | null = null;
let lastLobbyKey = "";
let lastNotice: string | null = null;
let lastSetupId: string | null = null;
let lastLoopAt = performance.now();
let controlAccumulator = 0;
let toastTimer: number | null = null;
let lastHudAt = 0;

client.subscribe((state) => {
  currentState = state;
  applyState(state);
});
client.start();
requestAnimationFrame(frame);

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeRoomCode(roomInput.value);
  if (!isRoomCode(code)) {
    showToast("Enter the four-letter room code");
    return;
  }
  roomInput.value = code;
  autoJoinAttempted = true;
  client.joinRoom(code);
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);
});

readyButton.addEventListener("click", () => {
  const you = currentState?.lobby?.you ?? null;
  if (you !== null) {
    client.setReady(!you.ready);
  }
});

leaveRoomButton.addEventListener("click", () => {
  client.leaveRoom();
});

leavePlayButton.addEventListener("click", () => {
  client.leaveRoom();
});

window.addEventListener("blur", () => {
  controls.reset();
});

function applyState(state: GameClientState): void {
  renderConnection(state);

  const lobbyKey = JSON.stringify(state.lobby);
  if (lobbyKey !== lastLobbyKey || state.status !== lastStatus) {
    renderLobby(state);
    lastLobbyKey = lobbyKey;
  }
  lastStatus = state.status;

  if (state.setup?.matchId !== lastSetupId) {
    lastSetupId = state.setup?.matchId ?? null;
    if (state.setup === null) {
      controls.reset();
      controlAccumulator = 0;
      hidePower();
    }
  }

  const room = state.lobby?.room ?? null;
  const inMatch = state.setup !== null;
  playView.hidden = !inMatch;
  roomView.hidden = inMatch || room === null;
  entryView.hidden = inMatch || room !== null;

  if (inMatch) {
    playRoom.textContent = room?.code ?? "—";
    updatePlayerLabel(state);
  }

  maybeAutoJoin(state);
  updateOverlay(state);
  updateHud(state);

  if (state.notice !== null && state.notice !== lastNotice) {
    showToast(state.notice);
    lastNotice = state.notice;
  } else if (state.notice === null) {
    lastNotice = null;
  }
}

function renderConnection(state: GameClientState): void {
  connectionDot.dataset.status = state.status;
  connectionLabel.textContent = STATUS_LABELS[state.status];
  connectionLabel.title = state.detail;
  pingLabel.textContent =
    state.pingMs === null ? "— ms" : `${Math.round(state.pingMs)} ms`;
  joinSubmit.disabled = state.status !== "online";
  readyButton.disabled = state.status !== "online";
  leaveRoomButton.disabled = state.status !== "online";
  leavePlayButton.disabled = state.status !== "online";
}

function renderLobby(state: GameClientState): void {
  const room = state.lobby?.room ?? null;
  if (room === null) {
    roomBadge.textContent = "----";
    return;
  }

  roomBadge.textContent = room.code;
  roomCode.textContent = room.code;
  roomPhase.textContent = phaseTitle(room);
  roomStatus.textContent = `${describePlayers(room)} · ${
    room.phase === "paused"
      ? `${room.reconnectSeconds ?? 0}s reconnect window`
      : "Keep this page open"
  }`;
  readyButton.textContent = state.lobby?.you?.ready ? "Cancel ready" : "Ready";
  readyButton.disabled =
    state.status !== "online" ||
    room.phase === "live" ||
    room.phase === "paused";
}

function frame(now: number): void {
  const loopDt = Math.min(
    Math.max(0, (now - lastLoopAt) / 1_000),
    TUNING.presentation.maxFrameDeltaSeconds,
  );
  lastLoopAt = now;

  updateInput(now, loopDt);

  if (
    currentState !== null &&
    now - lastHudAt >= 1_000 / TUNING.presentation.hudUpdateHz
  ) {
    lastHudAt = now;
    updateHud(currentState);
    updateOverlay(currentState);
  }

  requestAnimationFrame(frame);
}

function updateInput(now: number, loopDt: number): void {
  const active =
    currentState !== null &&
    currentState.setup !== null &&
    currentState.status === "online" &&
    currentState.pausedReason === null;

  if (!active) {
    controls.reset();
    controlAccumulator = 0;
    hidePower();
    return;
  }

  controlAccumulator += loopDt;
  const tickSeconds = 1 / TUNING.sim.tickHz;
  let steps = 0;
  while (
    controlAccumulator >= tickSeconds &&
    steps < TUNING.sim.maxCatchUpTicks
  ) {
    const command = controls.read(now);
    client.sendInput(command);
    controlAccumulator -= tickSeconds;
    steps += 1;
  }
  if (steps === TUNING.sim.maxCatchUpTicks) {
    controlAccumulator = 0;
  }
  updatePower(controls.chargePower);
}

function updatePower(charge: number): void {
  if (charge <= 0.005) {
    hidePower();
    return;
  }
  const percent = Math.round(charge * 100);
  powerMeter.hidden = false;
  powerFill.style.width = `${percent}%`;
  powerValue.textContent = `${percent}%`;
}

function hidePower(): void {
  powerMeter.hidden = true;
  powerFill.style.width = "0%";
  powerValue.textContent = "0%";
}

function updatePlayerLabel(state: GameClientState): void {
  const setup = state.setup;
  const team = state.lobby?.you?.team ?? null;
  const frame = client.latestSnapshot();
  if (setup === null || team === null || frame === null) {
    playPlayer.textContent = "—";
    return;
  }
  const index = team === "home" ? frame.controlledHome : frame.controlledAway;
  if (index < 0) {
    playPlayer.textContent = "—";
    return;
  }
  const localIndex = team === "home" ? index : index - 11;
  const roster = team === "home" ? setup.home.players : setup.away.players;
  const player = roster[localIndex];
  playPlayer.textContent =
    player === undefined ? "—" : `You: #${player.number}`;
}

function updateHud(state: GameClientState): void {
  const room = state.lobby?.room ?? null;
  playRoom.textContent = room?.code ?? "—";
  updatePlayerLabel(state);

  const frame = client.latestSnapshot();
  const match = frame?.match ?? null;
  playScore.textContent =
    match === null ? "0 – 0" : `${match.scoreHome} – ${match.scoreAway}`;
  playClock.textContent =
    match === null ? "00:00" : formatMatchClock(match.clockSeconds);
  playPhase.textContent =
    match === null
      ? "1st half"
      : match.half === 1
        ? "1st half"
        : "2nd half";

  const paused = state.pausedReason !== null;
  const online = state.status === "online";
  playChip.textContent = !online
    ? "Offline"
    : paused
      ? "Paused"
      : match === null
        ? "Live"
        : match.phase === "fullTime"
          ? "Full time"
          : match.phase === "halfTime"
            ? "Half time"
            : match.phase === "deadBall"
              ? "Restart"
              : "Live";
  playChip.dataset.state = !online ? "offline" : paused ? "paused" : "live";
}

function formatMatchClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateOverlay(state: GameClientState): void {
  if (state.setup === null) {
    overlay.hidden = true;
    return;
  }
  if (state.status !== "online") {
    showOverlay(
      state.status === "fatal" ? "Connection failed" : "Connection lost",
      state.detail,
    );
    return;
  }
  if (state.pausedReason !== null) {
    const seconds =
      state.pausedUntilMs === null
        ? 0
        : Math.max(
            0,
            Math.ceil((state.pausedUntilMs - Date.now()) / 1_000),
          );
    showOverlay(
      "Match paused",
      `${state.pausedReason}. ${
        seconds > 0 ? `Reconnect window: ${seconds}s.` : "Waiting for server."
      }`,
    );
    return;
  }

  const frame = client.latestSnapshot();
  if (frame === null) {
    overlay.hidden = true;
    return;
  }
  const match = frame.match;
  const score = `${match.scoreHome} – ${match.scoreAway}`;
  if (match.phase === "fullTime") {
    showOverlay("Full time", `${score}. The match is complete.`);
    return;
  }
  if (match.phase === "halfTime") {
    showOverlay("Half time", `${score}. The second half starts shortly.`);
    return;
  }
  if (match.phase === "deadBall") {
    const restart = match.restartType;
    if (restart === null || match.restartSide === null) {
      showOverlay("Referee", `${score}. Play is being set up.`);
      return;
    }
    const sideName =
      match.restartSide === "home" ? state.setup.home.name : state.setup.away.name;
    const title =
      restart === "kickoff"
        ? "Kick-off"
        : restart === "throwIn"
          ? "Throw-in"
          : restart === "goalKick"
            ? "Goal kick"
            : "Corner";
    showOverlay(title, `${sideName} restart. ${score}.`);
    return;
  }
  overlay.hidden = true;
}

function showOverlay(title: string, detail: string): void {
  overlay.hidden = false;
  overlayTitle.textContent = title;
  overlayDetail.textContent = detail;
}

function maybeAutoJoin(state: GameClientState): void {
  if (
    autoJoinAttempted ||
    queryCode === null ||
    state.status !== "online" ||
    state.lobby === null ||
    state.lobby.room !== null
  ) {
    return;
  }
  autoJoinAttempted = true;
  client.joinRoom(queryCode);
}

function phaseTitle(room: LobbyRoomWire): string {
  switch (room.phase) {
    case "waiting":
      return "Waiting";
    case "ready":
      return "Ready";
    case "live":
      return "Match live";
    case "paused":
      return "Paused";
  }
}

function describePlayers(room: LobbyRoomWire): string {
  return room.players
    .map(
      (player) =>
        `${player.name}${player.ready ? " ready" : " not ready"}${
          player.connected ? "" : " (offline)"
        }`,
    )
    .join(" / ");
}

function readQueryRoomCode(): string | null {
  const raw = new URLSearchParams(window.location.search).get("room");
  if (raw === null) {
    return null;
  }
  const code = normalizeRoomCode(raw);
  return isRoomCode(code) ? code : null;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, TOAST_DURATION_MS);
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}
