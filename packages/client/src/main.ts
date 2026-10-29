// packages/client/src/main.ts
import {
  TUNING,
  isRoomCode,
  normalizeRoomCode,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type ServerLobbyStateMessage,
} from "@fb/shared";
import { WireViewBuilder } from "./match/view-from-wire";
import {
  DEFAULT_KEY_BINDINGS,
  DesktopControls,
  loadKeyBindings,
  saveKeyBindings,
  type ControlAction,
  type ControlFrame,
  type KeyBindings,
} from "./input/desktop-controls";
import {
  GameClient,
  type GameClientState,
  type GameLinkStatus,
} from "./net/game-client";
import { createCanvasRenderer } from "./render/canvas-renderer";
import type { MatchView } from "./render/view";
import "./style.css";

const TOAST_DURATION_MS = 2_600;
const STATUS_LABELS: Record<GameLinkStatus, string> = {
  connecting: "Connecting",
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
  fatal: "Connection error",
};

const canvas = byId<HTMLCanvasElement>("pitch");
const renderer = createCanvasRenderer(canvas);
const client = new GameClient();

const connectionDot = byId<HTMLSpanElement>("connection-dot");
const connectionLabel = byId<HTMLElement>("connection-label");
const pingLabel = byId<HTMLElement>("ping-label");
const lobbyView = byId<HTMLElement>("lobby-view");
const matchView = byId<HTMLElement>("match-view");
const entryView = byId<HTMLElement>("entry-view");
const roomView = byId<HTMLElement>("room-view");
const createRoomButton = byId<HTMLButtonElement>("create-room");
const joinForm = byId<HTMLFormElement>("join-form");
const roomInput = byId<HTMLInputElement>("room-input");
const joinSubmit = byId<HTMLButtonElement>("join-submit");
const roomCode = byId<HTMLElement>("room-code");
const copyCodeButton = byId<HTMLButtonElement>("copy-code");
const roomPhase = byId<HTMLElement>("room-phase");
const roomBadge = byId<HTMLElement>("room-badge");
const joinUrl = byId<HTMLElement>("join-url");
const controllerUrl = byId<HTMLElement>("controller-url");
const roomPlayers = byId<HTMLElement>("room-players");
const readyButton = byId<HTMLButtonElement>("ready");
const leaveRoomButton = byId<HTMLButtonElement>("leave-room");
const roomHint = byId<HTMLElement>("room-hint");
const homeSwatch = byId<HTMLElement>("home-swatch");
const awaySwatch = byId<HTMLElement>("away-swatch");
const homeName = byId<HTMLElement>("home-name");
const awayName = byId<HTMLElement>("away-name");
const matchRoom = byId<HTMLElement>("match-room");
const matchChip = byId<HTMLElement>("match-chip");
const scoreHome = byId<HTMLElement>("score-home");
const scoreAway = byId<HTMLElement>("score-away");
const scoreClock = byId<HTMLElement>("score-clock");
const scorePhase = byId<HTMLElement>("score-phase");
const leaveMatchButton = byId<HTMLButtonElement>("leave-match");
const bufferChip = byId<HTMLElement>("buffer-chip");
const controlPlayerChip = byId<HTMLElement>("control-player");
const hudRoom = byId<HTMLElement>("hud-room");
const hudPing = byId<HTMLElement>("hud-ping");
const hudTick = byId<HTMLElement>("hud-tick");
const hudSnapshot = byId<HTMLElement>("hud-snapshot");
const hudBuffer = byId<HTMLElement>("hud-buffer");
const hudBall = byId<HTMLElement>("hud-ball");
const matchOverlay = byId<HTMLElement>("match-overlay");
const overlayTitle = byId<HTMLElement>("overlay-title");
const overlayDetail = byId<HTMLElement>("overlay-detail");
const powerMeter = byId<HTMLElement>("power-meter");
const powerFill = byId<HTMLElement>("power-fill");
const powerValue = byId<HTMLElement>("power-value");
const openBindingsButton = byId<HTMLButtonElement>("open-bindings");
const controlsDialog = byId<HTMLDialogElement>("controls-dialog");
const closeBindingsButton = byId<HTMLButtonElement>("close-bindings");
const resetBindingsButton = byId<HTMLButtonElement>("reset-bindings");
const bindingsGrid = byId<HTMLElement>("bindings-grid");
const toast = byId<HTMLElement>("toast");

const queryCode = readQueryRoomCode();
if (queryCode !== null) {
  roomInput.value = queryCode;
}

let currentState: GameClientState | null = null;
let lastLobby: ServerLobbyStateMessage | null | undefined;
let lastStatus: GameLinkStatus | null = null;
let lastNotice: string | null = null;
let lastSetupId: string | null = null;
let builder: WireViewBuilder | null = null;
let latestView: MatchView | null = null;
let autoJoinAttempted = false;
let lastHudAt = 0;
let toastTimer: number | null = null;
let controls: DesktopControls | null = null;
let lastSelfTeam: "home" | "away" | null = null;
let lastLoopAt = performance.now();
let controlAccumulator = 0;
let lastControlFrame: ControlFrame | null = null;
let bindings: KeyBindings = loadKeyBindings();
let capturingAction: ControlAction | null = null;

client.subscribe((state) => {
  currentState = state;
  applyState(state);
});

client.start();
requestAnimationFrame(renderLoop);

createRoomButton.addEventListener("click", () => {
  client.createRoom();
});

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
  if (you === null) {
    return;
  }
  client.setReady(!you.ready);
});

copyCodeButton.addEventListener("click", () => {
  void copyRoomCode();
});

leaveRoomButton.addEventListener("click", () => {
  client.leaveRoom();
});

leaveMatchButton.addEventListener("click", () => {
  client.leaveRoom();
});

openBindingsButton.addEventListener("click", () => {
  controls?.destroy();
  controls = null;
  lastControlFrame = null;
  controlAccumulator = 0;
  hidePowerMeter();
  renderBindings();
  controlsDialog.showModal();
});

closeBindingsButton.addEventListener("click", () => {
  controlsDialog.close();
});

resetBindingsButton.addEventListener("click", () => {
  bindings = cloneBindings(DEFAULT_KEY_BINDINGS);
  saveKeyBindings(bindings);
  capturingAction = null;
  renderBindings();
});

controlsDialog.addEventListener("close", () => {
  capturingAction = null;
  if (
    currentState?.setup != null &&
    controls === null &&
    !controlsDialog.open
  ) {
    controls = new DesktopControls(bindings);
    lastLoopAt = performance.now();
    controlAccumulator = 0;
  }
});

window.addEventListener(
  "keydown",
  (event) => {
    if (capturingAction === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      capturingAction = null;
      renderBindings();
      return;
    }
    const action = capturingAction;
    const next: Record<ControlAction, readonly string[]> = {
      ...bindings,
    };
    for (const key of Object.keys(next) as ControlAction[]) {
      if (key === action) {
        continue;
      }
      const remaining = next[key].filter((code) => code !== event.code);
      next[key] =
        remaining.length > 0 ? remaining : DEFAULT_KEY_BINDINGS[key].slice(0, 1);
    }
    next[action] = [event.code];
    bindings = next;
    saveKeyBindings(bindings);
    capturingAction = null;
    renderBindings();
  },
  true,
);

function renderBindings(): void {
  const labels: Record<ControlAction, string> = {
    up: "Move up",
    down: "Move down",
    left: "Move left",
    right: "Move right",
    sprint: "Sprint",
    pass: "Pass",
    through: "Through pass",
    lob: "Lob / cross",
    shoot: "Shoot",
    tackle: "Tackle",
    switch: "Switch player",
    finesse: "Finesse modifier",
  };
  bindingsGrid.replaceChildren();
  for (const action of Object.keys(labels) as ControlAction[]) {
    const row = document.createElement("div");
    row.className = "binding-row";
    const label = document.createElement("span");
    label.className = "binding-label";
    label.textContent = labels[action];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "binding-key";
    if (capturingAction === action) {
      button.classList.add("capturing");
      button.textContent = "Press a key…";
    } else {
      button.textContent = bindings[action].map(formatKey).join(" / ");
    }
    button.addEventListener("click", () => {
      capturingAction = action;
      renderBindings();
    });
    row.append(label, button);
    bindingsGrid.append(row);
  }
}

function formatKey(code: string): string {
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  const names: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ShiftLeft: "Shift L",
    ShiftRight: "Shift R",
    ControlLeft: "Ctrl L",
    ControlRight: "Ctrl R",
    Space: "Space",
    Escape: "Esc",
  };
  return names[code] ?? code;
}

function cloneBindings(source: KeyBindings): KeyBindings {
  return {
    up: [...source.up],
    down: [...source.down],
    left: [...source.left],
    right: [...source.right],
    sprint: [...source.sprint],
    pass: [...source.pass],
    through: [...source.through],
    lob: [...source.lob],
    shoot: [...source.shoot],
    tackle: [...source.tackle],
    switch: [...source.switch],
    finesse: [...source.finesse],
  };
}

function applyState(state: GameClientState): void {
  renderConnection(state);

  if (
    state.lobby !== lastLobby ||
    state.status !== lastStatus ||
    state.notice !== lastNotice
  ) {
    renderLobby(state);
    lastLobby = state.lobby;
  }
  lastStatus = state.status;

  const selfTeam = state.lobby?.you?.team ?? null;
  if (selfTeam !== lastSelfTeam) {
    lastSelfTeam = selfTeam;
    if (state.setup !== null) {
      builder = new WireViewBuilder(state.setup, selfTeam);
    }
  }

  const setupId = state.setup?.matchId ?? null;
  if (setupId !== lastSetupId) {
    lastSetupId = setupId;
    builder =
      state.setup === null
        ? null
        : new WireViewBuilder(state.setup, selfTeam);
    latestView = null;
    if (state.setup === null) {
      controls?.destroy();
      controls = null;
      lastControlFrame = null;
      controlAccumulator = 0;
      hidePowerMeter();
      showLobby();
    } else {
      if (controls === null && !controlsDialog.open) {
        controls = new DesktopControls(bindings);
        lastLoopAt = performance.now();
        controlAccumulator = 0;
      }
      showMatch();
      renderMatchIdentity(state);
    }
  }
  if (state.setup !== null) {
    renderMatchIdentity(state);
  }

  if (state.notice !== null && state.notice !== lastNotice) {
    showToast(state.notice);
    lastNotice = state.notice;
  } else if (state.notice === null) {
    lastNotice = null;
  }

  maybeAutoJoin(state);
  updateHud(state);
  updateOverlay(state);
}

function renderLoop(now: number): void {
  const loopDt = Math.min(
    Math.max(0, (now - lastLoopAt) / 1_000),
    TUNING.presentation.maxFrameDeltaSeconds,
  );
  lastLoopAt = now;

  if (builder !== null) {
    const frame = client.sampleSnapshot(now);
    if (frame !== null) {
      const view = builder.build(frame);
      if (view !== null) {
        latestView = view;
        renderer.render(view);
      }
    } else if (latestView !== null) {
      renderer.render(latestView);
    }
  }

  updateControlLoop(now, loopDt);

  if (
    currentState !== null &&
    now - lastHudAt >= 1_000 / TUNING.presentation.hudUpdateHz
  ) {
    lastHudAt = now;
    updateHud(currentState);
    updateOverlay(currentState);
  }

  requestAnimationFrame(renderLoop);
}

function updateControlLoop(now: number, loopDt: number): void {
  const desktopControls = controls;
  const active =
    desktopControls !== null &&
    builder !== null &&
    currentState !== null &&
    currentState.status === "online" &&
    currentState.setup !== null &&
    currentState.pausedReason === null;

  if (!active) {
    desktopControls?.reset();
    lastControlFrame = null;
    controlAccumulator = 0;
    hidePowerMeter();
    return;
  }

  controlAccumulator += loopDt;
  const tickSeconds = 1 / TUNING.sim.tickHz;
  let steps = 0;
  while (
    controlAccumulator >= tickSeconds &&
    steps < TUNING.sim.maxCatchUpTicks
  ) {
    const frame = desktopControls.read(now);
    lastControlFrame = frame;
    client.sendInput(frame);
    controlAccumulator -= tickSeconds;
    steps += 1;
  }
  if (steps === TUNING.sim.maxCatchUpTicks) {
    controlAccumulator = 0;
  }

  updatePowerMeter(lastControlFrame?.chargePower ?? 0);
}

function updatePowerMeter(charge: number): void {
  if (charge <= 0.005) {
    hidePowerMeter();
    return;
  }
  const percent = Math.round(charge * 100);
  powerMeter.hidden = false;
  powerFill.style.width = `${percent}%`;
  powerValue.textContent = `${percent}%`;
}

function hidePowerMeter(): void {
  powerMeter.hidden = true;
  powerFill.style.width = "0%";
  powerValue.textContent = "0%";
}

function renderConnection(state: GameClientState): void {
  connectionDot.dataset.status = state.status;
  connectionLabel.textContent = STATUS_LABELS[state.status];
  connectionLabel.title = state.detail;
  pingLabel.textContent =
    state.pingMs === null ? "— ms" : `${Math.round(state.pingMs)} ms`;

  const canCommand = state.status === "online";
  createRoomButton.disabled = !canCommand;
  joinSubmit.disabled = !canCommand;
  readyButton.disabled =
    !canCommand ||
    (state.lobby?.room?.phase !== "waiting" &&
      state.lobby?.room?.phase !== "ready");
  leaveRoomButton.disabled = !canCommand;
  leaveMatchButton.disabled = !canCommand;
}

function renderLobby(state: GameClientState): void {
  const room = state.lobby?.room ?? null;
  if (room === null) {
    entryView.hidden = false;
    roomView.hidden = true;
    return;
  }

  entryView.hidden = true;
  roomView.hidden = false;
  roomCode.textContent = room.code;
  joinUrl.textContent = `Player: ${window.location.origin}/?room=${room.code}`;
  controllerUrl.textContent = `Phone: ${window.location.origin}/controller.html?room=${room.code}`;
  roomPhase.textContent = phaseDescription(room);
  roomBadge.textContent = phaseLabel(room.phase);
  roomBadge.dataset.state =
    room.phase === "paused"
      ? "paused"
      : room.phase === "live"
        ? "live"
        : "idle";

  const you = state.lobby?.you ?? null;
  readyButton.disabled =
    state.status !== "online" ||
    room.phase === "live" ||
    room.phase === "paused";
  readyButton.textContent = you?.ready ? "Cancel ready" : "Ready";
  roomHint.textContent = roomHintText(room);

  renderRoomPlayers(room, you?.seat ?? null);
}

function renderRoomPlayers(
  room: LobbyRoomWire,
  selfSeat: number | null,
): void {
  roomPlayers.replaceChildren();
  for (const player of room.players) {
    roomPlayers.append(buildPlayerCard(player, selfSeat));
  }
  if (room.players.length < 2) {
    const empty = document.createElement("div");
    empty.className = "room-player-empty";
    empty.textContent = "Waiting for the second device";
    roomPlayers.append(empty);
  }
}

function buildPlayerCard(
  player: LobbyPlayerWire,
  selfSeat: number | null,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "room-player";
  card.dataset.self = String(player.seat === selfSeat);
  card.dataset.connected = String(player.connected);

  const nameRow = document.createElement("div");
  nameRow.className = "room-player-name";
  const name = document.createElement("span");
  name.textContent = player.name;
  const tag = document.createElement("span");
  tag.className = "room-player-tag";
  tag.textContent =
    player.seat === selfSeat ? "You" : player.host ? "Host" : "Guest";
  nameRow.append(name, tag);

  const meta = document.createElement("div");
  meta.className = "room-player-meta";
  meta.append(
    chip(`${player.team === "home" ? "Home" : "Away"} XI`),
    chip(player.ready ? "Ready" : "Not ready"),
    chip(player.connected ? "Connected" : "Reconnecting"),
  );

  card.append(nameRow, meta);
  return card;
}

function chip(text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "chip";
  element.textContent = text;
  return element;
}

function renderMatchIdentity(state: GameClientState): void {
  const setup = state.setup;
  if (setup === null) {
    return;
  }
  homeName.textContent = setup.home.name;
  awayName.textContent = setup.away.name;
  homeSwatch.style.backgroundColor = setup.home.colors.primary;
  awaySwatch.style.backgroundColor = setup.away.colors.primary;
  const code = state.lobby?.room?.code ?? "----";
  matchRoom.textContent = code;
  hudRoom.textContent = code;
}

function updateScoreboard(): void {
  const frame = client.latestSnapshot();
  if (frame === null) {
    scoreHome.textContent = "0";
    scoreAway.textContent = "0";
    scoreClock.textContent = "00:00";
    scorePhase.textContent = "Kick-off";
    return;
  }
  const match = frame.match;
  scoreHome.textContent = String(match.scoreHome);
  scoreAway.textContent = String(match.scoreAway);
  scoreClock.textContent = formatMatchClock(match.clockSeconds);
  scorePhase.textContent =
    match.phase === "live"
      ? match.half === 1
        ? "1st half"
        : "2nd half"
      : match.phase === "halfTime"
        ? "Half time"
        : match.phase === "fullTime"
          ? "Full time"
          : "Dead ball";
}

function formatMatchClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateHud(state: GameClientState): void {
  const ping = state.pingMs === null ? "—" : `${Math.round(state.pingMs)} ms`;
  hudPing.textContent = ping;
  hudTick.textContent = state.lastServerTick.toLocaleString("en-US");
  hudSnapshot.textContent = String(state.lastSnapshotSeq);
  hudBuffer.textContent = `${TUNING.network.snapshotInterpolationDelayMs} ms`;
  bufferChip.textContent = `${TUNING.network.snapshotInterpolationDelayMs} ms interpolation`;
  hudBall.textContent = `${Math.hypot(
    latestView?.ball.vx ?? 0,
    latestView?.ball.vy ?? 0,
    latestView?.ball.vz ?? 0,
  ).toFixed(1)} m/s`;

  updateScoreboard();
  updateControlPlayerChip(state);

  const paused = state.pausedReason !== null;
  const online = state.status === "online";
  const frame = client.latestSnapshot();
  const phase = frame?.match.phase ?? null;
  matchChip.textContent = !online
    ? "Offline"
    : paused
      ? "Paused"
      : phase === "fullTime"
        ? "Full time"
        : phase === "halfTime"
          ? "Half time"
          : phase === "deadBall"
            ? "Restart"
            : "Live";
  matchChip.dataset.state = !online
    ? "offline"
    : paused
      ? "paused"
      : "live";
}

function updateControlPlayerChip(state: GameClientState): void {
  const setup = state.setup;
  const team = state.lobby?.you?.team ?? null;
  const frame = client.latestSnapshot();
  if (setup === null || team === null || frame === null) {
    controlPlayerChip.textContent = "You: —";
    return;
  }
  const index = team === "home" ? frame.controlledHome : frame.controlledAway;
  if (index < 0) {
    controlPlayerChip.textContent = "You: —";
    return;
  }
  const localIndex = team === "home" ? index : index - 11;
  const roster = team === "home" ? setup.home.players : setup.away.players;
  const player = roster[localIndex];
  controlPlayerChip.textContent =
    player === undefined ? "You: —" : `You: #${player.number}`;
}

function updateOverlay(state: GameClientState): void {
  if (state.setup === null) {
    matchOverlay.hidden = true;
    return;
  }
  if (state.status === "fatal" || state.status === "offline") {
    showOverlay("Connection failed", state.detail);
    return;
  }

  if (state.status !== "online") {
    showOverlay(
      "Connection lost",
      "Reconnecting to the host. Your seat is held for 60 seconds.",
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
    showOverlay("Kick-off", "Waiting for the first server snapshot.");
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

  if (latestView === null) {
    showOverlay("Kick-off", "Waiting for the first server snapshot.");
    return;
  }

  matchOverlay.hidden = true;
}

function showOverlay(title: string, detail: string): void {
  matchOverlay.hidden = false;
  overlayTitle.textContent = title;
  overlayDetail.textContent = detail;
}

function showMatch(): void {
  lobbyView.hidden = true;
  matchView.hidden = false;
  window.requestAnimationFrame(() => {
    renderer.resize();
  });
}

function showLobby(): void {
  matchView.hidden = true;
  lobbyView.hidden = false;
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

function phaseLabel(phase: LobbyRoomWire["phase"]): string {
  switch (phase) {
    case "waiting":
      return "Lobby";
    case "ready":
      return "Ready";
    case "live":
      return "Live";
    case "paused":
      return "Paused";
  }
}

function phaseDescription(room: LobbyRoomWire): string {
  switch (room.phase) {
    case "waiting":
      return room.players.length < 2
        ? "Waiting for a second device"
        : "Waiting for both players to ready up";
    case "ready":
      return "Both players ready — starting";
    case "live":
      return "Server match in progress";
    case "paused":
      return `Paused — ${
        room.reconnectSeconds ?? 0
      }s reconnect window`;
  }
}

function roomHintText(room: LobbyRoomWire): string {
  if (room.phase === "live") {
    return "The match is running on the host server.";
  }
  if (room.phase === "paused") {
    return "The match is frozen while the disconnected seat is held.";
  }
  return "The match starts automatically when both players are ready.";
}

async function copyRoomCode(): Promise<void> {
  const code = currentState?.lobby?.room?.code;
  if (code === undefined) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    showToast(`Room ${code} copied`);
  } catch {
    showToast(`Room code: ${code}`);
  }
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
