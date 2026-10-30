// packages/client/src/main.ts
import {
  TUNING,
  isRoomCode,
  normalizeRoomCode,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type MatchSetupWire,
  type ServerLobbyStateMessage,
  type SnapshotFrame,
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
import { TeamEditor } from "./lobby/team-editor";
import {
  mountMatchRenderer,
  preferredRendererMode,
  saveRendererMode,
  type RendererMode,
} from "./render/factory";
import type { MatchView } from "./render/view";
import { describeMatchEvent, formatCardCounts } from "./match/event-label";
import { SubstitutionPanel } from "./match/substitution-panel";
import { MatchAudio } from "./audio/match-audio";
import { MatchReplayBuffer } from "./presentation/replay";
import {
  renderMatchStatsScreen,
  type MatchStatsViewRow,
} from "./match/stats-screen";
import * as QRCode from "qrcode";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./ui/tokens.css";
import "./style.css";
import "./ui/components.css";
import "./ui/menu.css";
import "./ui/squad.css";
import { installConsoleMenu } from "./ui/menu";

const TOAST_DURATION_MS = 2_600;
// Canvas fills cannot read CSS custom properties; keep these in sync with
// --ui-ink and --ui-chalk so the QR keeps the console palette.
const QR_DARK = "#0A0B09";
const QR_LIGHT = "#F2EEE3";
const STATUS_LABELS: Record<GameLinkStatus, string> = {
  connecting: "Connecting",
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
  fatal: "Connection error",
};

const pitchStage = byId<HTMLElement>("pitch-stage");
let mounted = mountMatchRenderer(pitchStage, preferredRendererMode());
let renderer = mounted.renderer;
let rendererMode: RendererMode = mounted.mode;
let rendererFellBack = mounted.fellBack;
const client = new GameClient();
const replay = new MatchReplayBuffer();
const audio = new MatchAudio();

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
const joinError = byId<HTMLElement>("join-error");
const roomCode = byId<HTMLElement>("room-code");
const copyCodeButton = byId<HTMLButtonElement>("copy-code");
const roomPhase = byId<HTMLElement>("room-phase");
const roomBadge = byId<HTMLElement>("room-badge");
const joinUrl = byId<HTMLElement>("join-url");
const controllerUrl = byId<HTMLElement>("controller-url");
const roomPlayers = byId<HTMLElement>("room-players");
const roomPing = byId<HTMLElement>("room-ping");
const roomQr = byId<HTMLCanvasElement>("room-qr");
const readyButton = byId<HTMLButtonElement>("ready");
const leaveRoomButton = byId<HTMLButtonElement>("leave-room");
const roomHint = byId<HTMLElement>("room-hint");
const openHelpButton = byId<HTMLButtonElement>("open-help");
const helpDialog = byId<HTMLDialogElement>("help-dialog");
const closeHelpButton = byId<HTMLButtonElement>("close-help");
const settingsSoundButton = byId<HTMLButtonElement>("settings-sound");
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
const scoreAdded = byId<HTMLElement>("score-added");
const scorePens = byId<HTMLElement>("score-pens");
const matchCards = byId<HTMLElement>("match-cards");
const statsScreen = byId<HTMLElement>("stats-screen");
const statsTitle = byId<HTMLElement>("stats-title");
const statsScore = byId<HTMLElement>("stats-score");
const statsNote = byId<HTMLElement>("stats-note");
const statsRows = byId<HTMLElement>("stats-rows");
const matchEvent = byId<HTMLElement>("match-event");
const leaveMatchButton = byId<HTMLButtonElement>("leave-match");
const rendererToggleButton =
  byId<HTMLButtonElement>("renderer-toggle");
const replayButton = byId<HTMLButtonElement>("replay-button");
const replayStopButton = byId<HTMLButtonElement>("replay-stop");
const replayBanner = byId<HTMLElement>("replay-banner");
const replayProgress = byId<HTMLElement>("replay-progress");
const audioToggleButton = byId<HTMLButtonElement>("audio-toggle");
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

let currentState: GameClientState | null = null;
let toastTimer: number | null = null;
let lastQrRoomCode: string | null = null;

const substitutionPanel = new SubstitutionPanel({
  onSubstitute: (outId, inId) => client.substitute(outId, inId),
});

const teamEditor = new TeamEditor({
  onSetTeam: (teamId) => client.setTeam(teamId),
  onUpdateSheet: (sheet) => client.updateSheet(sheet),
  onUpdateSettings: (settings) => client.updateSettings(settings),
  onToast: showToast,
  onAvailabilityChange: () => {
    if (currentState !== null) {
      renderLobby(currentState);
    }
  },
});

updateRendererControl();
updateAudioControl();
if (rendererFellBack) {
  showToast("3D view unavailable; using the 2D renderer");
}

const queryCode = readQueryRoomCode();
if (queryCode !== null) {
  roomInput.value = queryCode;
  roomInput.dispatchEvent(new Event("input", { bubbles: true }));
}
installConsoleMenu();

openHelpButton.addEventListener("click", () => {
  helpDialog.showModal();
});

closeHelpButton.addEventListener("click", () => {
  helpDialog.close();
});

helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) {
    helpDialog.close();
  }
});

let lastLobby: ServerLobbyStateMessage | null | undefined;
let lastStatus: GameLinkStatus | null = null;
let lastNotice: string | null = null;
let lastSubstitutionNotice: string | null = null;
let lastSetupId: string | null = null;
let lastSetupRef: MatchSetupWire | null | undefined;
let builder: WireViewBuilder | null = null;
let latestView: MatchView | null = null;
let autoJoinAttempted = false;
let lastHudAt = 0;
let lastMatchEventSeq = 0;
let matchEventTimer: number | null = null;
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
    joinError.textContent = "Enter the four-letter code shown in the host room.";
    joinError.hidden = false;
    roomInput.setAttribute("aria-invalid", "true");
    roomInput.focus();
    showToast("Enter the four-letter room code");
    return;
  }
  joinError.hidden = true;
  joinError.textContent = "";
  roomInput.removeAttribute("aria-invalid");
  roomInput.value = code;
  autoJoinAttempted = true;
  client.joinRoom(code);
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);
  joinError.hidden = true;
  joinError.textContent = "";
  roomInput.removeAttribute("aria-invalid");
});

readyButton.addEventListener("click", () => {
  const you = currentState?.lobby?.you ?? null;
  if (you === null) {
    return;
  }
  if (!you.ready && !teamEditor.canReady()) {
    showToast("Fix the team sheet before readying up");
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

rendererToggleButton.addEventListener("click", () => {
  const next: RendererMode = rendererMode === "3d" ? "2d" : "3d";
  switchRenderer(next);
});

replayButton.addEventListener("click", () => {
  toggleReplay();
});

replayStopButton.addEventListener("click", () => {
  stopReplay();
});

audioToggleButton.addEventListener("click", () => {
  void audio.toggle().then(updateAudioControl);
});

settingsSoundButton.addEventListener("click", () => {
  void audio.toggle().then(updateAudioControl);
});

window.addEventListener("pointerdown", () => {
  void audio.unlock();
});
window.addEventListener("keydown", (event) => {
  void audio.unlock();
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT");
  if (
    !typing &&
    !event.repeat &&
    event.code === "KeyR" &&
    !matchView.hidden &&
    !controlsDialog.open
  ) {
    toggleReplay();
  }
});
window.addEventListener("pagehide", () => {
  audio.destroy();
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
  const newMatch = setupId !== lastSetupId;
  const setupChanged = state.setup !== lastSetupRef;
  lastSetupId = setupId;
  lastSetupRef = state.setup;
  if (newMatch || setupChanged) {
    if (newMatch) {
      stopReplay();
      replay.clear();
      setReplayAvailable(false);
      audio.reset();
      lastMatchEventSeq = 0;
      if (matchEventTimer !== null) {
        window.clearTimeout(matchEventTimer);
        matchEventTimer = null;
      }
      matchEvent.hidden = true;
    }
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
      if (newMatch && controls === null && !controlsDialog.open) {
        controls = new DesktopControls(bindings);
        lastLoopAt = performance.now();
        controlAccumulator = 0;
      }
      if (newMatch) {
        showMatch();
      }
      renderMatchIdentity(state);
    }
  }
  if (state.setup !== null) {
    renderMatchIdentity(state);
  }
  const framePhase = client.latestSnapshot()?.match.phase ?? "deadBall";
  substitutionPanel.render(
    state.setup,
    selfTeam,
    framePhase !== "fullTime" && framePhase !== "shootout",
  );
  substitutionPanel.updateNotice(state.substitutionNotice);

  if (state.notice !== null && state.notice !== lastNotice) {
    const noticeText = state.notice.replace(/^[a-z_]+: /, "");
    const joinFailure =
      state.notice.startsWith("room_not_found: ") ||
      state.notice.startsWith("room_unavailable: ") ||
      state.notice.startsWith("room_full: ");
    if (joinFailure) {
      joinError.textContent = noticeText;
      joinError.hidden = false;
      roomInput.setAttribute("aria-invalid", "true");
      document
        .querySelector<HTMLButtonElement>('[data-menu-key="lan"]')
        ?.click();
      roomInput.focus();
    } else {
      showToast(noticeText);
    }
    lastNotice = state.notice;
  } else if (state.notice === null) {
    lastNotice = null;
  }

  if (state.substitutionNotice !== lastSubstitutionNotice) {
    lastSubstitutionNotice = state.substitutionNotice;
    if (state.substitutionNotice !== null) {
      showToast(state.substitutionNotice);
    }
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

  if (replay.active) {
    const sample = replay.sample(now);
    if (sample === null) {
      stopReplay();
    } else {
      renderer.render(sample.view);
      replayBanner.hidden = false;
      replayProgress.textContent = `${(sample.elapsedMs / 1_000).toFixed(
        1,
      )}s / ${(sample.durationMs / 1_000).toFixed(1)}s`;
    }
  } else if (builder !== null) {
    const frame = client.sampleSnapshot(now);
    if (frame !== null) {
      audio.handleSnapshot(frame);
      const view = builder.build(frame);
      if (view !== null) {
        latestView = view;
        renderer.render(view);
        if (
          replay.record(
            view,
            frame.match.scoreHome,
            frame.match.scoreAway,
            now,
          )
        ) {
          setReplayAvailable(true);
          showToast("Goal — replay available");
        }
      }
    } else if (latestView !== null) {
      renderer.render(latestView);
    }
  }

  if (!replay.active) {
    updateControlLoop(now, loopDt);
  }

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
  roomPing.textContent =
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
  const focusWasInRoom = roomView.contains(document.activeElement);
  const focusWasInEntry = entryView.contains(document.activeElement);
  if (room === null) {
    entryView.hidden = false;
    roomView.hidden = true;
    lastQrRoomCode = null;
    teamEditor.render(null, null);
    if (focusWasInRoom) {
      document
        .querySelector<HTMLButtonElement>('[data-menu-key="lan"]')
        ?.focus();
    }
    return;
  }

  entryView.hidden = true;
  roomView.hidden = false;
  joinError.hidden = true;
  joinError.textContent = "";
  roomInput.removeAttribute("aria-invalid");
  if (focusWasInEntry) {
    copyCodeButton.focus();
  }
  roomCode.textContent = room.code;
  roomPing.textContent =
    state.pingMs === null ? "— ms" : `${Math.round(state.pingMs)} ms`;
  joinUrl.textContent = `Player: ${window.location.origin}/?room=${room.code}`;
  joinUrl.title = joinUrl.textContent;
  controllerUrl.textContent = `Phone: ${window.location.origin}/controller.html?room=${room.code}`;
  controllerUrl.title = controllerUrl.textContent;
  if (lastQrRoomCode !== room.code) {
    lastQrRoomCode = room.code;
    void renderRoomQr(room.code);
  }
  roomPhase.textContent = phaseDescription(room);
  roomBadge.textContent = phaseLabel(room.phase);
  roomBadge.dataset.state =
    room.phase === "paused"
      ? "paused"
      : room.phase === "live"
        ? "live"
        : "idle";

  const you = state.lobby?.you ?? null;
  roomView.dataset.host = String(you?.host ?? false);
  const selfSeat = you?.seat ?? null;
  teamEditor.render(room, selfSeat);
  renderRoomPlayers(room, selfSeat);
  const matchRunning = room.phase === "live" || room.phase === "paused";
  readyButton.disabled =
    state.status !== "online" ||
    matchRunning ||
    (!you?.ready && !teamEditor.canReady());
  readyButton.textContent = matchRunning
    ? "Match live"
    : you?.ready
      ? "Cancel ready"
      : "Ready";
  roomHint.textContent = roomHintText(room);
}

async function renderRoomQr(code: string): Promise<void> {
  const joinLink = new URL("/", window.location.origin);
  joinLink.searchParams.set("room", code);
  try {
    await QRCode.toCanvas(roomQr, joinLink.toString(), {
      width: 240,
      margin: 1,
      color: { dark: QR_DARK, light: QR_LIGHT },
    });
    roomQr.setAttribute("aria-label", `QR code to join room ${code}`);
  } catch {
    lastQrRoomCode = null;
    roomQr.setAttribute(
      "aria-label",
      "QR code unavailable; enter the room code instead",
    );
  }
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
    empty.textContent = "Open seat / waiting for the second device";
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
  card.dataset.ready = String(player.ready);

  const nameRow = document.createElement("div");
  nameRow.className = "room-player-name";
  const name = document.createElement("span");
  name.textContent = player.name;
  const tag = document.createElement("span");
  tag.className = "room-player-tag";
  tag.textContent =
    player.seat === selfSeat
      ? "You"
      : `Seat ${String(player.seat + 1).padStart(2, "0")}`;
  nameRow.append(name, tag);

  const meta = document.createElement("div");
  meta.className = "room-player-meta";
  const readiness = chip(player.ready ? "Ready" : "Not ready");
  readiness.dataset.ready = String(player.ready);
  const connection = chip(player.connected ? "Connected" : "Reconnecting");
  connection.dataset.connected = String(player.connected);
  meta.append(
    chip(`${player.team === "home" ? "Home" : "Away"} XI`),
    readiness,
    connection,
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
    matchCards.textContent = "YC 0–0 · RC 0–0";
    matchEvent.hidden = true;
    return;
  }
  const match = frame.match;
  scoreHome.textContent = String(match.scoreHome);
  scoreAway.textContent = String(match.scoreAway);
  scoreClock.textContent = formatMatchClock(match.clockSeconds);
  matchCards.textContent = formatCardCounts(frame);
  scoreAdded.hidden =
    match.addedTimeSeconds <= 0 || match.phase === "shootout";
  if (match.addedTimeSeconds > 0) {
    scoreAdded.textContent = `+${Math.ceil(match.addedTimeSeconds / 60)}`;
  }
  const shootout = currentState?.shootout ?? null;
  scorePens.hidden = shootout === null;
  if (shootout !== null) {
    scorePens.textContent = `PENS ${shootout.homeScore}–${shootout.awayScore}`;
  }
  scorePhase.textContent =
    match.phase === "shootout"
      ? "Shootout"
      : match.phase === "live"
        ? match.half === 1
          ? "1st half"
          : match.half === 2
            ? "2nd half"
            : match.half === 3
              ? "ET 1"
              : "ET 2"
        : match.phase === "halfTime"
          ? "Half time"
          : match.phase === "fullTime"
            ? "Full time"
            : "Dead ball";
  updateMatchEvent(match);
}

function updateMatchEvent(match: SnapshotFrame["match"]): void {
  const event = match.lastEvent;
  if (event === null || event.seq === lastMatchEventSeq) {
    return;
  }
  lastMatchEventSeq = event.seq;
  const setup = currentState?.setup;
  matchEvent.textContent = describeMatchEvent(
    event,
    setup?.home.name ?? "Home",
    setup?.away.name ?? "Away",
  );
  matchEvent.hidden = false;
  if (matchEventTimer !== null) {
    window.clearTimeout(matchEventTimer);
  }
  matchEventTimer = window.setTimeout(() => {
    matchEvent.hidden = true;
    matchEventTimer = null;
  }, 3_500);
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
  updateStatsScreen(state);

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

function updateStatsScreen(state: GameClientState): void {
  const stats = state.matchStats;
  if (stats === null) {
    statsScreen.hidden = true;
    statsRows.replaceChildren();
    return;
  }
  const setup = state.setup;
  const title = setup === null
    ? "Match statistics"
    : `${setup.home.name} v ${setup.away.name}`;
  const score = setup === null
    ? ""
    : `${setup.home.name} ${latestScore("home")} – ${latestScore(
        "away",
      )} ${setup.away.name}`;
  const notes: string[] = [];
  if (stats.shootout !== null) {
    notes.push(
      `Penalties ${stats.shootout.homeScore}–${stats.shootout.awayScore}`,
    );
  }
  if (stats.forfeitSide !== null) {
    const side = stats.forfeitSide === "home" ? setup?.home.name : setup?.away.name;
    notes.push(`${side ?? stats.forfeitSide} forfeited`);
  } else if (stats.winner !== null) {
    const side = stats.winner === "home" ? setup?.home.name : setup?.away.name;
    notes.push(`${side ?? stats.winner} won`);
  } else {
    notes.push("Draw");
  }
  const note = notes.join(" · ");
  const homeTicks = stats.home.possessionTicks;
  const awayTicks = stats.away.possessionTicks;
  const totalTicks = homeTicks + awayTicks;
  const homePossession =
    totalTicks === 0 ? 50 : Math.round((homeTicks / totalTicks) * 100);
  const rows: readonly MatchStatsViewRow[] = [
    {
      label: "Possession",
      home: `${homePossession}%`,
      away: `${100 - homePossession}%`,
    },
    { label: "Shots", home: String(stats.home.shots), away: String(stats.away.shots) },
    {
      label: "On target",
      home: String(stats.home.shotsOnTarget),
      away: String(stats.away.shotsOnTarget),
    },
    { label: "Saves", home: String(stats.home.saves), away: String(stats.away.saves) },
    {
      label: "Passes",
      home: `${stats.home.passesCompleted}/${stats.home.passes}`,
      away: `${stats.away.passesCompleted}/${stats.away.passes}`,
    },
    { label: "Fouls", home: String(stats.home.fouls), away: String(stats.away.fouls) },
    {
      label: "Offsides",
      home: String(stats.home.offsides),
      away: String(stats.away.offsides),
    },
    {
      label: "Yellow",
      home: String(stats.home.yellowCards),
      away: String(stats.away.yellowCards),
    },
    {
      label: "Red",
      home: String(stats.home.redCards),
      away: String(stats.away.redCards),
    },
  ];
  renderMatchStatsScreen(
    statsScreen,
    statsRows,
    statsTitle,
    statsScore,
    statsNote,
    { title, score, note, rows },
  );
}

function latestScore(side: "home" | "away"): number {
  const frame = client.latestSnapshot();
  if (frame === null) {
    return 0;
  }
  return side === "home" ? frame.match.scoreHome : frame.match.scoreAway;
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
  if (replay.active) {
    matchOverlay.hidden = true;
    return;
  }
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

  if (state.matchStats !== null) {
    matchOverlay.hidden = true;
    return;
  }

  if (state.varReview !== null) {
    const review = state.varReview;
    const subject =
      review.kind === "goal"
        ? "goal"
        : review.kind === "penalty"
          ? "penalty"
          : "red card";
    const title =
      review.decision === "checking"
        ? "VAR check"
        : review.decision === "confirmed"
          ? "Decision confirmed"
          : "Decision overturned";
    showOverlay(
      title,
      review.decision === "checking"
        ? `Reviewing the ${subject} for ${review.side}.`
        : `The ${subject} decision was ${review.decision}.`,
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
  if (match.phase === "shootout") {
    const shootout = state.shootout;
    const pens =
      shootout === null
        ? "Penalties are starting."
        : `Penalties ${shootout.homeScore}–${shootout.awayScore}.`;
    showOverlay("Penalty shootout", `${pens} ${score} after extra time.`);
    return;
  }
  if (match.phase === "fullTime") {
    showOverlay("Full time", `${score}. The match is complete.`);
    return;
  }
  if (match.phase === "halfTime") {
    showOverlay(
      match.half >= 3 ? "Extra-time break" : "Half time",
      `${score}. The next period starts shortly.`,
    );
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
            : restart === "corner"
              ? "Corner"
              : restart === "penalty"
                ? "Penalty"
                : restart === "indirectFreeKick"
                  ? "Indirect free kick"
                  : restart === "dropBall"
                    ? "Drop ball"
                    : "Free kick";
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

function toggleReplay(): void {
  if (replay.active) {
    stopReplay();
    return;
  }
  if (!replay.start(performance.now())) {
    return;
  }
  replayBanner.hidden = false;
  replayButton.textContent = "Stop replay";
  matchOverlay.hidden = true;
}

function stopReplay(): void {
  replay.stop();
  replayBanner.hidden = true;
  replayButton.textContent = "Replay goal";
}

function setReplayAvailable(available: boolean): void {
  replayButton.disabled = !available;
  if (!available && !replay.active) {
    replayButton.textContent = "Replay goal";
  }
}

function switchRenderer(next: RendererMode): void {
  if (next === rendererMode) {
    return;
  }
  renderer.destroy();
  mounted = mountMatchRenderer(pitchStage, next);
  renderer = mounted.renderer;
  rendererMode = mounted.mode;
  rendererFellBack = mounted.fellBack;
  saveRendererMode(rendererMode);
  updateRendererControl();
  if (latestView !== null) {
    renderer.render(latestView);
  }
  renderer.resize();
  if (rendererFellBack) {
    showToast("3D view unavailable; using the 2D renderer");
  }
}

function updateAudioControl(): void {
  audioToggleButton.textContent = audio.isEnabled ? "Sound on" : "Sound off";
  audioToggleButton.setAttribute("aria-pressed", String(audio.isEnabled));
  settingsSoundButton.setAttribute("aria-checked", String(audio.isEnabled));
}

function updateRendererControl(): void {
  rendererToggleButton.textContent =
    rendererMode === "3d" ? "2D view" : "3D view";
  rendererToggleButton.setAttribute(
    "aria-pressed",
    String(rendererMode === "3d"),
  );
  rendererToggleButton.title =
    rendererFellBack
      ? "WebGL unavailable; using 2D"
      : rendererMode === "3d"
        ? "Switch to the top-down renderer"
        : "Switch to the 3D renderer";
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
      return "Both players ready. Starting.";
    case "live":
      return "Match in progress";
    case "paused":
      return `Paused. Reconnect window ${room.reconnectSeconds ?? 0}s`;
  }
}

function roomHintText(room: LobbyRoomWire): string {
  if (room.phase === "live") {
    return "The match is live.";
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
