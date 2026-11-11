// packages/client/src/main.ts
import {
  CONTROL_BUTTONS,
  TUNING,
  isRoomCode,
  normalizeRoomCode,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type MatchSetupWire,
  type ServerLobbyStateMessage,
  type SnapshotFrame,
  type WireReplayClip,
  type WireReplayExport,
  type WireReplayLibrary,
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
  applyBinding,
  cloneBindings,
  sanitizeBindings,
} from "./input/bindings";
import {
  DEFAULT_GAMEPAD_BINDINGS,
  GAMEPAD_ACTIONS,
  applyGamepadBinding,
  cloneGamepadBindings,
  formatGamepadButton,
  loadGamepadBindings,
  sanitizeGamepadBindings,
  saveGamepadBindings,
  type GamepadAction,
  type GamepadBindings,
} from "./input/gamepad-bindings";
import {
  GameClient,
  type GameClientState,
  type GameLinkStatus,
} from "./net/game-client";
import { LocalPlayerPrediction } from "./net/local-prediction";
import { TeamEditor } from "./lobby/team-editor";
import { preloadAuthoredPlayer } from "./render/authored-asset";
import {
  mountMatchRenderer,
  preferredRendererMode,
  saveRendererMode,
  type RendererMode,
} from "./render/factory";
import type { MatchView, RenderPlayer } from "./render/view";
import {
  loadTemporalAa,
  loadVisualQuality,
  parseVisualQuality,
  saveTemporalAa,
  saveVisualQuality,
  type VisualQuality,
} from "./render/visualTuning";
import type { ScreenIndicator } from "./render/renderer";
import { movementToWorld } from "./camera/cameraMath";
import {
  CAMERA_MODES,
  loadCameraMode,
  parseCameraMode,
  saveCameraMode,
  type CameraMode,
} from "./camera/modes";
import { describeMatchEvent, formatCardCounts } from "./match/event-label";
import { SubstitutionPanel } from "./match/substitution-panel";
import {
  buildReplayGalleryItems,
  formatGoalMinute,
  formatLibraryTime,
  parseReplayExport,
  parseReplayLibrary,
} from "./match/replay-gallery";
import { MatchAudio } from "./audio/match-audio";
import { MatchHaptics } from "./input/haptics";
import {
  MatchReplayBuffer,
  type ReplaySample,
} from "./presentation/replay";
import {
  buildReplayChapters,
  chapterIndexAt,
  type ReplayChapter,
} from "./presentation/replay-chapters";
import { drawReplayThumbnail } from "./presentation/replay-thumbnail";
import {
  loadReviewQueue,
  saveReviewQueue,
  type StoredReviewClip,
} from "./presentation/review-queue-storage";
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
import "./ui/match.css";
import { installConsoleMenu } from "./ui/menu";

const LOCAL_PREDICTION_KEY = "fb.localPrediction.v1";
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
const cameraIndicatorLayer = byId<HTMLElement>("camera-indicators");
const cameraIndicatorElements: Readonly<
  Record<ScreenIndicator["id"], HTMLElement | null>
> = {
  ball: pitchStage.querySelector<HTMLElement>('[data-indicator="ball"]'),
  controlled: pitchStage.querySelector<HTMLElement>(
    '[data-indicator="controlled"]',
  ),
};
let mounted = mountMatchRenderer(pitchStage, preferredRendererMode());
let renderer = mounted.renderer;
let rendererMode: RendererMode = mounted.mode;
let rendererFellBack = mounted.fellBack;
const client = new GameClient();
const replay = new MatchReplayBuffer();
const audio = new MatchAudio();
const haptics = new MatchHaptics();

/**
 * Renderer contact events are presentation-only. Replays drive their own
 * audio timeline, so live footsteps are muted while a replay is active.
 */
function connectFootstepAudio(): void {
  renderer.setFootstepSink?.((event) => {
    if (!replay.active) {
      audio.handleFootstep(event);
    }
  });
}

connectFootstepAudio();

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
const settingsHapticsButton =
  byId<HTMLButtonElement>("settings-haptics");
const settingsPredictionButton =
  byId<HTMLButtonElement>("settings-prediction");
const settingsTaaButton = byId<HTMLButtonElement>("settings-taa");
const settingsQualitySelect =
  byId<HTMLSelectElement>("settings-quality");
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
const statsNextLegButton =
  byId<HTMLButtonElement>("stats-next-leg");
const statsNextLegWait = byId<HTMLElement>("stats-next-leg-wait");
const matchEvent = byId<HTMLElement>("match-event");
const leaveMatchButton = byId<HTMLButtonElement>("leave-match");
const exportReplayLink = byId<HTMLAnchorElement>("export-replay");
const openReplaysButton = byId<HTMLButtonElement>("open-replays");
const statsReplaysButton = byId<HTMLButtonElement>("stats-replays");
const replayGallery = byId<HTMLElement>("replay-gallery");
const replayGalleryList = byId<HTMLElement>("replay-gallery-list");
const closeReplaysButton = byId<HTMLButtonElement>("close-replays");
const pauseMatchButton = byId<HTMLButtonElement>("pause-match");
const rendererToggleButton =
  byId<HTMLButtonElement>("renderer-toggle");
const cameraModeSelect =
  byId<HTMLSelectElement>("camera-mode");
const replayButton = byId<HTMLButtonElement>("replay-button");
const replayLastButton =
  byId<HTMLButtonElement>("replay-last-button");
const replayStopButton = byId<HTMLButtonElement>("replay-stop");
const replayBanner = byId<HTMLElement>("replay-banner");
const replayProgress = byId<HTMLElement>("replay-progress");
const replaySeek = byId<HTMLInputElement>("replay-seek");
const replayLoopRange = byId<HTMLElement>("replay-loop-range");
const replayTimelineMarkers = byId<HTMLElement>(
  "replay-timeline-markers",
);
const replayPauseButton = byId<HTMLButtonElement>("replay-pause");
const replayStepBackButton =
  byId<HTMLButtonElement>("replay-step-back");
const replayStepForwardButton =
  byId<HTMLButtonElement>("replay-step-forward");
const replaySpeedSelect =
  byId<HTMLSelectElement>("replay-speed");
const replayChapters = byId<HTMLElement>("replay-chapters");
const replayLoopButton = byId<HTMLButtonElement>("replay-loop");
const replayPrevClipButton =
  byId<HTMLButtonElement>("replay-prev-clip");
const replayNextClipButton =
  byId<HTMLButtonElement>("replay-next-clip");
const replayShareButton = byId<HTMLButtonElement>("replay-share");
const replayAngles = byId<HTMLElement>("replay-angles");
const replayCameraButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-replay-camera]"),
];
const audioToggleButton = byId<HTMLButtonElement>("audio-toggle");
const bufferChip = byId<HTMLElement>("buffer-chip");
const matchRulesChip = byId<HTMLElement>("match-rules");
const controlPlayerChip = byId<HTMLElement>("control-player");
const controlCard = byId<HTMLElement>("control-card");
const controlNumber = byId<HTMLElement>("control-number");
const controlName = byId<HTMLElement>("control-name");
const controlMeta = byId<HTMLElement>("control-meta");
const controlState = byId<HTMLElement>("control-state");
const controlStamina = byId<HTMLElement>("control-stamina");
const controlStaminaFill = byId<HTMLElement>("control-stamina-fill");
const controlStaminaValue = byId<HTMLElement>("control-stamina-value");
const controlBall = byId<HTMLElement>("control-ball");
const controlSprint = byId<HTMLElement>("control-sprint");
const controlNext = byId<HTMLElement>("control-next");
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
const powerLabel = byId<HTMLElement>("power-label");
const openBindingsButton = byId<HTMLButtonElement>("open-bindings");
const matchBindingsButton = byId<HTMLButtonElement>("match-bindings");
const controlsDialog = byId<HTMLDialogElement>("controls-dialog");
const closeBindingsButton = byId<HTMLButtonElement>("close-bindings");
const resetBindingsButton = byId<HTMLButtonElement>("reset-bindings");
const bindingsGrid = byId<HTMLElement>("bindings-grid");
const bindingsCopy = byId<HTMLElement>("bindings-copy");
const bindingsKeyboardTab =
  byId<HTMLButtonElement>("bindings-tab-keyboard");
const bindingsGamepadTab =
  byId<HTMLButtonElement>("bindings-tab-gamepad");
const openReplayLibraryButton =
  byId<HTMLButtonElement>("open-replays-library");
const replayLibraryDialog =
  byId<HTMLDialogElement>("replay-library-dialog");
const replayLibraryList = byId<HTMLElement>("replay-library-list");
const reviewQueueBar = byId<HTMLElement>("review-queue-bar");
const reviewQueueCount = byId<HTMLElement>("review-queue-count");
const clearReviewQueueButton = byId<HTMLButtonElement>(
  "clear-review-queue",
);
const startReviewQueueButton = byId<HTMLButtonElement>(
  "start-review-queue",
);
const savedReplayHead = byId<HTMLElement>("saved-replay-head");
const savedReplayTitle = byId<HTMLElement>("saved-replay-title");
const closeSavedReplayButton =
  byId<HTMLButtonElement>("close-saved-replay");
const refreshReplayLibraryButton =
  byId<HTMLButtonElement>("refresh-replay-library");
const closeReplayLibraryButton =
  byId<HTMLButtonElement>("close-replay-library");
const toast = byId<HTMLElement>("toast");

let currentState: GameClientState | null = null;
let replayGalleryKey = "";
let replaySpeed: number = TUNING.presentation.replayDefaultSpeed;
let toastTimer: number | null = null;
let lastQrRoomCode: string | null = null;
let cameraMode: CameraMode = loadCameraMode();
let replayCamera: CameraMode = "broadcast";
let visualQuality: VisualQuality = loadVisualQuality();
let temporalAaEnabled: boolean = loadTemporalAa();
let temporalAaAutoDisabled = false;

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

for (const option of CAMERA_MODES) {
  const element = document.createElement("option");
  element.value = option.id;
  element.textContent = option.label;
  element.title = option.description;
  cameraModeSelect.append(element);
}

for (const speed of TUNING.presentation.replaySpeeds) {
  const element = document.createElement("option");
  element.value = String(speed);
  element.textContent = `${speed}×`;
  replaySpeedSelect.append(element);
}
replaySpeedSelect.value = String(replaySpeed);
cameraModeSelect.addEventListener("change", () => {
  if (replay.active) {
    cameraModeSelect.value = cameraMode;
    return;
  }
  cameraMode = parseCameraMode(cameraModeSelect.value);
  saveCameraMode(cameraMode);
  renderer.setCameraMode?.(cameraMode);
  updateCameraControl();
});
updateCameraControl();
renderer.setCameraMode?.(cameraMode);

settingsQualitySelect.value = visualQuality;
settingsQualitySelect.addEventListener("change", () => {
  visualQuality = parseVisualQuality(settingsQualitySelect.value);
  saveVisualQuality(visualQuality);
  renderer.setQuality?.(visualQuality);
  updateQualityControl();
});
renderer.setQuality?.(visualQuality);
renderer.setTemporalAa?.(temporalAaEnabled);
bindTemporalAaHandler();
updateQualityControl();
updateTemporalAaControl();

updateRendererControl();
updateAudioControl();
updateHapticsControl();
if (rendererFellBack) {
  showToast("3D view unavailable; using the 2D renderer");
}

const queryCode = readQueryRoomCode();
const replayDeepLink = readReplayDeepLink();
if (queryCode !== null && replayDeepLink === null) {
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
let lastSentControlFrame: ControlFrame | null = null;
let localPredictionEnabled = loadLocalPrediction();
const localPrediction = new LocalPlayerPrediction();
updatePredictionControl();
let lastControlledPlayerId: string | null = null;
let lastControlledMatchId: string | null = null;
let bindings: KeyBindings = sanitizeBindings(loadKeyBindings());
preloadAuthoredPlayer();
let gamepadBindings: GamepadBindings = sanitizeGamepadBindings(
  loadGamepadBindings(),
);
let bindingMode: "keyboard" | "gamepad" = "keyboard";
let capturingAction: ControlAction | null = null;
let capturingGamepadAction: GamepadAction | null = null;
let gamepadCaptureFrame: number | null = null;
let gamepadCaptureBaseline = new Set<number>();

client.subscribe((state) => {
  currentState = state;
  applyState(state);
});

client.start();
requestAnimationFrame(renderLoop);
if (replayDeepLink !== null) {
  void openSharedReplay(replayDeepLink);
}

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

pauseMatchButton.addEventListener("click", () => {
  if (currentState?.pausedManual === true) {
    client.resumeMatch();
  } else {
    client.pauseMatch();
  }
});

let replayGalleryOpener: HTMLButtonElement | null = null;

function openReplayGallery(opener: HTMLButtonElement): void {
  if (
    currentState === null ||
    currentState.replayClips.length === 0 ||
    replayGalleryList.childElementCount === 0
  ) {
    return;
  }
  replayGalleryOpener = opener;
  replayGallery.hidden = false;
  closeReplaysButton.focus();
}

function closeReplayGallery(): void {
  if (replayGallery.hidden) {
    return;
  }
  replayGallery.hidden = true;
  const target =
    replayGalleryOpener?.hidden === false
      ? replayGalleryOpener
      : openReplaysButton;
  target.focus();
}

openReplaysButton.addEventListener("click", () => {
  openReplayGallery(openReplaysButton);
});
statsReplaysButton.addEventListener("click", () => {
  openReplayGallery(statsReplaysButton);
});
closeReplaysButton.addEventListener("click", closeReplayGallery);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  if (!replayGallery.hidden) {
    event.preventDefault();
    closeReplayGallery();
  } else if (savedReplayActive) {
    event.preventDefault();
    stopReplay();
  }
});

statsNextLegButton.addEventListener("click", () => {
  statsNextLegButton.disabled = true;
  statsNextLegButton.textContent = "Preparing room…";
  client.prepareNextLeg();
});

rendererToggleButton.addEventListener("click", () => {
  const next: RendererMode = rendererMode === "3d" ? "2d" : "3d";
  switchRenderer(next);
});

replayButton.addEventListener("click", () => {
  toggleReplay("goal");
});

replayLastButton.addEventListener("click", () => {
  toggleReplay("capture");
});

let replayScrubbing = false;

replayPauseButton.addEventListener("click", () => {
  if (!replay.active) {
    return;
  }
  replay.togglePaused(performance.now());
  updateReplayTransport();
});

replayStepBackButton.addEventListener("click", () => {
  if (replay.stepFrame(-1, performance.now())) {
    savedAudioJumpPending = true;
    updateReplayTransport();
  }
});

replayStepForwardButton.addEventListener("click", () => {
  if (replay.stepFrame(1, performance.now())) {
    savedAudioJumpPending = true;
    updateReplayTransport();
  }
});

replaySeek.addEventListener("input", () => {
  if (!replay.active) {
    return;
  }
  replayScrubbing = true;
  replayLoopChapterIndex = null;
  if (reviewQueueActive) {
    reviewChapterPreference = null;
  }
  replay.seek(Number(replaySeek.value) / 1_000, performance.now());
  savedAudioJumpPending = true;
  updateReplayTransport();
});

replaySeek.addEventListener("change", () => {
  replayScrubbing = false;
  updateReplayUrl(null);
  updateReplayTransport();
});

replaySpeedSelect.addEventListener("change", () => {
  const next = Number(replaySpeedSelect.value);
  if (!Number.isFinite(next) || next <= 0) {
    return;
  }
  replaySpeed = next;
  replay.setSpeed(replaySpeed, performance.now());
  updateReplayTransport();
});

replayChapters.addEventListener("click", (event) => {
  const target = event.target;
  if (
    !(target instanceof HTMLButtonElement) ||
    !replay.active
  ) {
    return;
  }
  const progress = Number(target.dataset.replayProgress);
  const index = Number(target.dataset.replayChapter);
  if (!Number.isFinite(progress)) {
    return;
  }
  replay.seek(progress, performance.now());
  replay.pause(performance.now());
  replayLoopChapterIndex = Number.isInteger(index) ? index : null;
  if (reviewQueueActive && Number.isInteger(index)) {
    reviewChapterPreference = index;
  }
  lastLoopElapsedMs = savedChapters[index]?.timeMs ?? 0;
  lastReplayElapsedMs = lastLoopElapsedMs;
  replayScrubbing = false;
  savedAudioJumpPending = true;
  updateReplayUrl(Number.isInteger(index) ? index : null);
  updateReplayTransport();
});

replayLoopButton.addEventListener("click", () => {
  if (replayLoopMode === "off") {
    replayLoopMode = savedChapters.length >= 2 ? "chapter" : "clip";
  } else if (replayLoopMode === "chapter") {
    replayLoopMode = "clip";
  } else {
    replayLoopMode = "off";
  }
  if (replayLoopMode === "clip") {
    replayLoopChapterIndex = null;
    updateReplayUrl(null);
  }
  updateReplayTransport();
});

replayShareButton.addEventListener("click", () => {
  void shareSavedReplayLink();
});

replayPrevClipButton.addEventListener("click", () => {
  if (
    !reviewQueueActive ||
    reviewAdvancing ||
    reviewQueueIndex <= 0
  ) {
    return;
  }
  void loadReviewQueueClip(reviewQueueIndex - 1);
});

replayNextClipButton.addEventListener("click", () => {
  if (
    !reviewQueueActive ||
    reviewAdvancing ||
    reviewQueueIndex + 1 >= reviewQueue.length
  ) {
    return;
  }
  void loadReviewQueueClip(reviewQueueIndex + 1);
});

document.addEventListener("keydown", (event) => {
  if (!replay.active) {
    return;
  }
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLButtonElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    replay.togglePaused(performance.now());
    updateReplayTransport();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    replay.stepFrame(-1, performance.now());
    savedAudioJumpPending = true;
    updateReplayTransport();
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    replay.stepFrame(1, performance.now());
    savedAudioJumpPending = true;
    updateReplayTransport();
  }
});

for (const button of replayCameraButtons) {
  button.addEventListener("click", () => {
    const mode = parseCameraMode(button.dataset.replayCamera);
    setReplayCamera(mode);
  });
}

replayStopButton.addEventListener("click", () => {
  stopReplay();
});

audioToggleButton.addEventListener("click", () => {
  void audio.toggle().then(updateAudioControl);
});

settingsSoundButton.addEventListener("click", () => {
  void audio.toggle().then(updateAudioControl);
});

settingsHapticsButton.addEventListener("click", () => {
  haptics.toggle();
  updateHapticsControl();
  haptics.preview();
});

settingsPredictionButton.addEventListener("click", () => {
  localPredictionEnabled = !localPredictionEnabled;
  saveLocalPrediction(localPredictionEnabled);
  localPrediction.reset();
  updatePredictionControl();
});

settingsTaaButton.addEventListener("click", () => {
  if (renderer.temporalAaCapability?.().supported === false) {
    updateTemporalAaControl();
    return;
  }
  if (temporalAaAutoDisabled) {
    temporalAaAutoDisabled = false;
    temporalAaEnabled = true;
    renderer.setTemporalAa?.(true);
    saveTemporalAa(true);
    updateTemporalAaControl();
    return;
  }
  temporalAaEnabled = !temporalAaEnabled;
  temporalAaAutoDisabled = false;
  saveTemporalAa(temporalAaEnabled);
  renderer.setTemporalAa?.(temporalAaEnabled);
  updateTemporalAaControl();
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
    toggleReplay("goal");
  }
});
window.addEventListener("pagehide", () => {
  audio.destroy();
});

function openBindingsDialog(): void {
  controls?.destroy();
  controls = null;
  lastControlFrame = null;
  controlAccumulator = 0;
  hidePowerMeter();
  renderBindings();
  controlsDialog.showModal();
}

openBindingsButton.addEventListener("click", openBindingsDialog);
matchBindingsButton.addEventListener("click", openBindingsDialog);

closeBindingsButton.addEventListener("click", () => {
  controlsDialog.close();
});

resetBindingsButton.addEventListener("click", () => {
  capturingAction = null;
  cancelGamepadCapture();
  if (bindingMode === "gamepad") {
    gamepadBindings = cloneGamepadBindings(DEFAULT_GAMEPAD_BINDINGS);
    saveGamepadBindings(gamepadBindings);
  } else {
    bindings = cloneBindings(DEFAULT_KEY_BINDINGS);
    saveKeyBindings(bindings);
  }
  renderBindings();
});

bindingsKeyboardTab.addEventListener("click", () => {
  selectBindingMode("keyboard");
});

bindingsGamepadTab.addEventListener("click", () => {
  selectBindingMode("gamepad");
});

controlsDialog.addEventListener("close", () => {
  capturingAction = null;
  cancelGamepadCapture();
  if (
    currentState?.setup != null &&
    controls === null &&
    !controlsDialog.open
  ) {
    controls = new DesktopControls(bindings, gamepadBindings);
    lastLoopAt = performance.now();
    controlAccumulator = 0;
  }
});

window.addEventListener(
  "keydown",
  (event) => {
    if (capturingGamepadAction !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        cancelGamepadCapture();
        renderBindings();
      }
      return;
    }
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
    bindings = applyBinding(bindings, action, event.code);
    saveKeyBindings(bindings);
    capturingAction = null;
    renderBindings();
  },
  true,
);

function selectBindingMode(mode: "keyboard" | "gamepad"): void {
  if (bindingMode === mode) {
    return;
  }
  bindingMode = mode;
  capturingAction = null;
  cancelGamepadCapture();
  renderBindings();
}

function beginGamepadCapture(action: GamepadAction): void {
  cancelGamepadCapture();
  capturingAction = null;
  capturingGamepadAction = action;
  gamepadCaptureBaseline = new Set(pressedButtons(connectedGamepad()));
  renderBindings();
  const poll = (): void => {
    if (capturingGamepadAction === null) {
      return;
    }
    const pad = connectedGamepad();
    if (pad !== null) {
      for (let index = 0; index < pad.buttons.length; index += 1) {
        if (
          pad.buttons[index]?.pressed === true &&
          !gamepadCaptureBaseline.has(index)
        ) {
          gamepadBindings = applyGamepadBinding(
            gamepadBindings,
            capturingGamepadAction,
            index,
          );
          saveGamepadBindings(gamepadBindings);
          cancelGamepadCapture();
          renderBindings();
          return;
        }
      }
    }
    gamepadCaptureFrame = requestAnimationFrame(poll);
  };
  gamepadCaptureFrame = requestAnimationFrame(poll);
}

function cancelGamepadCapture(): void {
  if (gamepadCaptureFrame !== null) {
    cancelAnimationFrame(gamepadCaptureFrame);
    gamepadCaptureFrame = null;
  }
  capturingGamepadAction = null;
  gamepadCaptureBaseline.clear();
}

function connectedGamepad(): Gamepad | null {
  if (typeof navigator.getGamepads !== "function") {
    return null;
  }
  try {
    return (
      navigator
        .getGamepads()
        .find((entry) => entry !== null && entry.connected) ?? null
    );
  } catch {
    return null;
  }
}

function pressedButtons(pad: Gamepad | null): number[] {
  if (pad === null) {
    return [];
  }
  const pressed: number[] = [];
  for (let index = 0; index < pad.buttons.length; index += 1) {
    if (pad.buttons[index]?.pressed === true) {
      pressed.push(index);
    }
  }
  return pressed;
}

function renderBindings(): void {
  const keyboardLabels: Record<ControlAction, string> = {
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
    skillUp: "Skill forward",
    skillDown: "Skill back",
    skillLeft: "Skill left",
    skillRight: "Skill right",
    drivenPass: "Driven pass",
  };
  const gamepadLabels: Record<GamepadAction, string> = {
    sprint: "Sprint",
    pass: "Pass",
    through: "Through pass",
    lob: "Lob / cross",
    shoot: "Shoot",
    tackle: "Tackle",
    switch: "Switch player",
    finesse: "Finesse modifier",
    drivenPass: "Driven pass",
  };

  bindingsKeyboardTab.classList.toggle(
    "is-active",
    bindingMode === "keyboard",
  );
  bindingsGamepadTab.classList.toggle(
    "is-active",
    bindingMode === "gamepad",
  );
  bindingsKeyboardTab.setAttribute(
    "aria-selected",
    String(bindingMode === "keyboard"),
  );
  bindingsGamepadTab.setAttribute(
    "aria-selected",
    String(bindingMode === "gamepad"),
  );
  bindingsKeyboardTab.tabIndex = bindingMode === "keyboard" ? 0 : -1;
  bindingsGamepadTab.tabIndex = bindingMode === "gamepad" ? 0 : -1;
  bindingsGrid.setAttribute(
    "aria-labelledby",
    bindingMode === "keyboard"
      ? "bindings-tab-keyboard"
      : "bindings-tab-gamepad",
  );

  const keyboardMode = bindingMode === "keyboard";
  bindingsCopy.textContent = keyboardMode
    ? "Click a binding, then press a key. Keyboard bindings save to this browser."
    : "Connect a gamepad, click a binding and press a button. Stick movement stays fixed; gamepad bindings save to this browser.";
  resetBindingsButton.textContent = keyboardMode
    ? "Reset keyboard defaults"
    : "Reset gamepad defaults";

  bindingsGrid.replaceChildren();
  if (keyboardMode) {
    for (const action of Object.keys(keyboardLabels) as ControlAction[]) {
      const row = document.createElement("div");
      row.className = "binding-row";
      const label = document.createElement("span");
      label.className = "binding-label";
      label.textContent = keyboardLabels[action];
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
        cancelGamepadCapture();
        renderBindings();
      });
      row.append(label, button);
      bindingsGrid.append(row);
    }
    return;
  }

  for (const action of GAMEPAD_ACTIONS) {
    const row = document.createElement("div");
    row.className = "binding-row";
    const label = document.createElement("span");
    label.className = "binding-label";
    label.textContent = gamepadLabels[action];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "binding-key";
    if (capturingGamepadAction === action) {
      button.classList.add("capturing");
      button.textContent =
        connectedGamepad() === null
          ? "Connect a gamepad…"
          : "Press a button…";
    } else {
      button.textContent =
        gamepadBindings[action]
          .map(formatGamepadButton)
          .join(" / ") || "Unbound";
    }
    button.addEventListener("click", () => {
      beginGamepadCapture(action);
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
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
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
      updateReplayButtons();
      audio.reset();
      haptics.reset();
      lastControlledPlayerId = null;
      lastControlledMatchId = null;
      controlCard.hidden = true;
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
    localPrediction.reset();
    if (state.setup === null) {
      controls?.destroy();
      controls = null;
      lastControlFrame = null;
      lastSentControlFrame = null;
      controlAccumulator = 0;
      hidePowerMeter();
      showLobby();
    } else {
      if (newMatch && controls === null && !controlsDialog.open) {
        controls = new DesktopControls(bindings, gamepadBindings);
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
    const sample = replay.sample(now, replayLoopMode === "clip");
    if (sample === null) {
      if (savedReplayActive && reviewQueueActive) {
        advanceReviewQueue();
      } else {
        stopReplay();
      }
    } else {
      if (sample.wrapped) {
        savedAudioJumpPending = true;
      }
      renderer.render(sample.view);
      hideCameraIndicators();
      replayBanner.hidden = false;
      updateReplayTransport(sample);
      driveSavedReplayAudio(sample);
      driveChapterLoop(sample);
    }
  } else if (builder !== null) {
    const frame = client.sampleSnapshot(now);
    if (frame !== null) {
      audio.handleSnapshot(frame);
      haptics.handleSnapshot(frame, lastSelfTeam);
      const authView = builder.build(frame);
      if (authView !== null) {
        latestView = authView;
        const renderView =
          localPredictionEnabled &&
          currentState?.pausedReason === null
            ? localPrediction.apply(
                authView,
                frame,
                lastSentControlFrame,
                loopDt,
              )
            : authView;
        renderer.render(renderView);
        updateCameraIndicators();
        if (
          replay.record(
            authView,
            frame.match.scoreHome,
            frame.match.scoreAway,
            now,
          )
        ) {
          updateReplayButtons();
          showToast("Goal — replay available");
        }
      }
    } else if (latestView !== null) {
      renderer.render(latestView);
      updateCameraIndicators();
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
    updateReplayButtons();
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
    lastSentControlFrame = null;
    controlAccumulator = 0;
    localPrediction.reset();
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
    const sentFrame = cameraRelativeFrame(frame);
    lastSentControlFrame = sentFrame;
    client.sendInput(sentFrame);
    controlAccumulator -= tickSeconds;
    steps += 1;
  }
  if (steps === TUNING.sim.maxCatchUpTicks) {
    controlAccumulator = 0;
  }

  updatePowerMeter(
    lastControlFrame?.chargePower ?? 0,
    lastControlFrame?.chargeKind ?? "none",
    lastControlFrame !== null &&
      (lastControlFrame.buttons & CONTROL_BUTTONS.DRIVEN_PASS) !== 0,
  );
}

/**
 * Keyboard and gamepad sticks are screen-relative. Rotate them into pitch
 * coordinates with the rendered camera so "up" is always away from the view.
 */
function cameraRelativeFrame(frame: ControlFrame): ControlFrame {
  const basis = renderer.inputBasis?.();
  if (basis === null || basis === undefined) {
    return frame;
  }
  const world = movementToWorld(frame.moveX, frame.moveY, basis);
  return { ...frame, moveX: world.x, moveY: world.y };
}

function updateCameraIndicators(): void {
  const states = renderer.indicatorStates?.() ?? [];
  const byId = new Map(states.map((state) => [state.id, state]));
  cameraIndicatorLayer.hidden = states.length === 0;
  for (const [id, element] of Object.entries(cameraIndicatorElements)) {
    if (element === null) {
      continue;
    }
    const state = byId.get(id as ScreenIndicator["id"]);
    if (state === undefined) {
      element.hidden = true;
      continue;
    }
    element.hidden = false;
    element.style.left = `${(state.x * 100).toFixed(2)}%`;
    element.style.top = `${(state.y * 100).toFixed(2)}%`;
    element.style.setProperty("--indicator-angle", `${state.angle}rad`);
  }
}

function hideCameraIndicators(): void {
  cameraIndicatorLayer.hidden = true;
  for (const element of Object.values(cameraIndicatorElements)) {
    element?.setAttribute("hidden", "");
  }
}

function updatePowerMeter(
  charge: number,
  kind: "shot" | "pass" | "none",
  driven = false,
): void {
  if (charge <= 0.005 || kind === "none") {
    hidePowerMeter();
    return;
  }
  const percent = Math.round(charge * 100);
  powerMeter.hidden = false;
  powerMeter.dataset.kind = kind;
  powerMeter.dataset.level =
    percent >= 85 ? "max" : percent >= 55 ? "high" : "normal";
  powerLabel.textContent =
    kind === "pass"
      ? driven
        ? "Driven pass"
        : "Pass power"
      : "Shot power";
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
  const replayCode =
    state.setup !== null ? state.lobby?.room?.code ?? null : null;
  exportReplayLink.hidden = replayCode === null;
  if (replayCode !== null) {
    exportReplayLink.href = `/api/replay/${replayCode}.json`;
    exportReplayLink.download = `replay-${replayCode}.json`;
  }
  renderReplayGallery(state, replayCode);
}

function renderReplayGallery(
  state: GameClientState,
  replayCode: string | null,
): void {
  const clips = state.replayClips;
  const available = replayCode !== null && clips.length > 0;
  openReplaysButton.hidden = !available;
  openReplaysButton.textContent =
    clips.length > 0 ? `Replays (${clips.length})` : "Replays";
  statsReplaysButton.hidden = !available;
  if (!available) {
    if (!replayGallery.hidden) {
      replayGallery.hidden = true;
    }
    replayGalleryList.replaceChildren();
    replayGalleryKey = "";
    return;
  }

  const key = `${replayCode}:${clips.map((clip) => clip.id).join(",")}`;
  if (key === replayGalleryKey) {
    return;
  }
  replayGalleryKey = key;
  replayGalleryList.replaceChildren(
    ...buildReplayGalleryItems(replayCode, clips).map(
      (item) => {
        const link = document.createElement("a");
        link.className = "replay-gallery__item";
        link.href = item.href;
        link.download = item.download;
        link.title = item.title;
        const score = document.createElement("strong");
        score.textContent = item.score;
        const meta = document.createElement("span");
        meta.textContent = item.meta;
        link.append(score, meta);
        return link;
      },
    ),
  );
}

let replayLibraryRequest = 0;
let savedReplayActive = false;
let savedReplayFrames: readonly SnapshotFrame[] = [];
let savedReplayIntervalMs = 1_000 / 30;
let savedAudioIndex = -1;
let savedAudioJumpPending = false;
let savedChapters: readonly ReplayChapter[] = [];
let savedChapterViews: readonly (MatchView | null)[] = [];
type ReplayLoopMode = "off" | "chapter" | "clip";
let replayLoopMode: ReplayLoopMode = "off";
let replayLoopChapterIndex: number | null = null;
let lastLoopElapsedMs = 0;
let lastReplayElapsedMs = 0;
let savedReplayRef: {
  readonly roomCode: string;
  readonly clipId: string;
} | null = null;
function initialReviewQueue(): StoredReviewClip[] {
  try {
    return loadReviewQueue(window.localStorage);
  } catch {
    return [];
  }
}

function persistReviewQueue(): void {
  try {
    saveReviewQueue(window.localStorage, reviewQueue);
  } catch {
    // Storage is optional; the queue still works for this session.
  }
}

let reviewQueue: StoredReviewClip[] = initialReviewQueue();
let reviewQueueActive = false;
let reviewQueueIndex = -1;
let reviewQueueRequest = 0;
let reviewAdvancing = false;
let reviewChapterPreference: number | null = null;

function openReplayLibrary(): void {
  if (!replayLibraryDialog.open) {
    replayLibraryDialog.showModal();
  }
  void loadReplayLibrary();
}

async function loadReplayLibrary(): Promise<void> {
  const request = ++replayLibraryRequest;
  refreshReplayLibraryButton.disabled = true;
  replayLibraryList.replaceChildren(createLibraryNotice("Loading saved clips…"));
  try {
    const response = await fetch("/api/replays.json", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Replay library returned ${response.status}`);
    }
    const library = parseReplayLibrary(await response.json());
    if (library === null) {
      throw new Error("Replay library payload is invalid");
    }
    if (request === replayLibraryRequest) {
      renderReplayLibrary(library);
    }
  } catch {
    if (request === replayLibraryRequest) {
      replayLibraryList.replaceChildren(
        createLibraryNotice(
          "Saved replays are unavailable. Check that the host is online.",
        ),
      );
    }
  } finally {
    if (request === replayLibraryRequest) {
      refreshReplayLibraryButton.disabled = false;
    }
  }
}

function renderReplayLibrary(library: WireReplayLibrary): void {
  pruneReviewQueue(library);
  if (library.rooms.length === 0) {
    replayLibraryList.replaceChildren(
      createLibraryNotice(
        "No saved goal clips yet. Goals persist here after the room closes.",
      ),
    );
    return;
  }
  replayLibraryList.replaceChildren(
    ...library.rooms.map((room) => {
      const section = document.createElement("section");
      section.className = "replay-library__room";
      const head = document.createElement("header");
      const title = document.createElement("h3");
      title.textContent = `Room ${room.code}`;
      const stamp = document.createElement("span");
      stamp.textContent = formatLibraryTime(room.updatedAtMs);
      head.append(title, stamp);
      const list = document.createElement("div");
      list.className = "replay-library__clips";
      list.append(
        ...[...room.clips]
          .reverse()
          .map((clip) => createLibraryClipRow(room.code, clip)),
      );
      section.append(head, list);
      return section;
    }),
  );
}

function createLibraryClipRow(
  roomCode: string,
  clip: WireReplayClip,
): HTMLElement {
  const item = buildReplayGalleryItems(roomCode, [clip])[0];
  if (item === undefined) {
    return document.createElement("span");
  }
  const row = document.createElement("div");
  row.className = "replay-library__clip";
  const watch = document.createElement("button");
  watch.className = "ui-button ui-button--small replay-library__watch";
  watch.type = "button";
  watch.textContent = "Watch";
  watch.addEventListener("click", () => {
    void watchSavedReplay(roomCode, clip, watch);
  });
  const queue = document.createElement("button");
  queue.className = "ui-button ui-button--small replay-library__queue";
  queue.type = "button";
  queue.dataset.reviewRoom = roomCode;
  queue.dataset.reviewClip = clip.id;
  queue.textContent = isReviewQueued(roomCode, clip.id)
    ? "Queued"
    : "Queue";
  queue.setAttribute(
    "aria-pressed",
    String(isReviewQueued(roomCode, clip.id)),
  );
  queue.setAttribute(
    "aria-label",
    `Add goal replay ${clip.scoreHome}–${clip.scoreAway} to review queue`,
  );
  queue.addEventListener("click", () => {
    toggleReviewQueueItem(roomCode, clip);
    const queued = isReviewQueued(roomCode, clip.id);
    queue.textContent = queued ? "Queued" : "Queue";
    queue.setAttribute("aria-pressed", String(queued));
  });
  const link = document.createElement("a");
  link.className = "replay-library__download";
  link.href = item.href;
  link.download = item.download;
  link.title = item.title;
  const score = document.createElement("strong");
  score.textContent = item.score;
  const meta = document.createElement("span");
  meta.textContent = item.meta;
  link.append(score, meta);
  row.append(watch, queue, link);
  return row;
}

function isReviewQueued(roomCode: string, clipId: string): boolean {
  return reviewQueue.some(
    (item) => item.roomCode === roomCode && item.clip.id === clipId,
  );
}

function toggleReviewQueueItem(
  roomCode: string,
  clip: WireReplayClip,
): void {
  const index = reviewQueue.findIndex(
    (item) => item.roomCode === roomCode && item.clip.id === clip.id,
  );
  if (index >= 0) {
    reviewQueue = [
      ...reviewQueue.slice(0, index),
      ...reviewQueue.slice(index + 1),
    ];
  } else {
    reviewQueue = [...reviewQueue, { roomCode, clip }];
  }
  persistReviewQueue();
  updateReviewQueueBar();
}

function updateReviewQueueButtons(): void {
  for (const button of replayLibraryList.querySelectorAll<HTMLButtonElement>(
    ".replay-library__queue",
  )) {
    const queued = isReviewQueued(
      button.dataset.reviewRoom ?? "",
      button.dataset.reviewClip ?? "",
    );
    button.textContent = queued ? "Queued" : "Queue";
    button.setAttribute("aria-pressed", String(queued));
  }
}

function pruneReviewQueue(library: WireReplayLibrary): void {
  const available = new Set(
    library.rooms.flatMap((room) =>
      room.clips.map((clip) => `${room.code}/${clip.id}`),
    ),
  );
  const next = reviewQueue.filter((item) =>
    available.has(`${item.roomCode}/${item.clip.id}`),
  );
  if (next.length === reviewQueue.length) {
    return;
  }
  reviewQueue = next;
  persistReviewQueue();
  updateReviewQueueBar();
}

function updateReviewQueueBar(): void {
  updateReviewQueueButtons();
  reviewQueueBar.hidden = reviewQueue.length === 0;
  reviewQueueCount.textContent =
    reviewQueue.length === 1
      ? "1 clip queued"
      : `${reviewQueue.length} clips queued`;
  startReviewQueueButton.textContent =
    reviewQueue.length === 0
      ? "Start review"
      : `Start review (${reviewQueue.length})`;
  startReviewQueueButton.disabled =
    reviewQueue.length === 0 || reviewQueueActive;
}

async function watchSavedReplay(
  roomCode: string,
  clip: WireReplayClip,
  button: HTMLButtonElement,
): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading…";
  void audio.unlock();
  try {
    const response = await fetch(
      `/api/replay/${roomCode}/${clip.id}.json`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Replay download returned ${response.status}`);
    }
    const replayExport = parseReplayExport(await response.json());
    if (replayExport === null) {
      throw new Error("Replay payload is invalid");
    }
    playSavedReplay(replayExport);
  } catch (error) {
    console.error(
      "Saved replay failed",
      error instanceof Error ? error.message : String(error),
    );
    showToast("Saved replay could not be loaded");
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadReviewQueueClip(index: number): Promise<void> {
  if (!reviewQueueActive) {
    return;
  }
  const item = reviewQueue[index];
  if (item === undefined) {
    finishReviewQueue();
    return;
  }
  const request = ++reviewQueueRequest;
  reviewAdvancing = true;
  try {
    const response = await fetch(
      `/api/replay/${item.roomCode}/${item.clip.id}.json`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Replay download returned ${response.status}`);
    }
    const replayExport = parseReplayExport(await response.json());
    if (replayExport === null) {
      throw new Error("Replay payload is invalid");
    }
    if (request !== reviewQueueRequest || !reviewQueueActive) {
      return;
    }
    reviewQueueIndex = index;
    if (
      !playSavedReplay(
        replayExport,
        reviewChapterPreference,
        true,
      )
    ) {
      throw new Error("Queued replay could not start");
    }
  } catch (error) {
    if (request !== reviewQueueRequest) {
      return;
    }
    console.error(
      "Review queue clip failed",
      error instanceof Error ? error.message : String(error),
    );
    reviewQueueActive = false;
    stopReplay();
    showToast("Review queue could not load its next clip");
  } finally {
    if (request === reviewQueueRequest) {
      reviewAdvancing = false;
    }
  }
}

function startReviewQueue(): void {
  if (reviewQueue.length === 0 || reviewQueueActive) {
    return;
  }
  reviewQueueActive = true;
  reviewQueueIndex = 0;
  reviewChapterPreference = null;
  reviewAdvancing = false;
  void loadReviewQueueClip(0);
}

function finishReviewQueue(): void {
  reviewQueueActive = false;
  reviewQueueIndex = -1;
  reviewChapterPreference = null;
  stopReplay();
  showToast("Review complete");
}

function advanceReviewQueue(): void {
  if (!reviewQueueActive || reviewAdvancing) {
    return;
  }
  const next = reviewQueueIndex + 1;
  if (next >= reviewQueue.length) {
    finishReviewQueue();
    return;
  }
  void loadReviewQueueClip(next);
}

function currentSharedChapterIndex(): number | null {
  if (savedChapters.length === 0) {
    return null;
  }
  const index =
    replayLoopChapterIndex ??
    chapterIndexAt(savedChapters, lastReplayElapsedMs);
  return index >= 0 && index < savedChapters.length ? index : null;
}

function replayShareUrl(chapterIndex: number | null): string | null {
  if (savedReplayRef === null) {
    return null;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.searchParams.set(
    "replay",
    `${savedReplayRef.roomCode}/${savedReplayRef.clipId}`,
  );
  if (chapterIndex === null) {
    url.searchParams.delete("chapter");
  } else {
    url.searchParams.set("chapter", String(chapterIndex));
  }
  return url.href;
}

function updateReplayUrl(chapterIndex: number | null): void {
  const url = replayShareUrl(chapterIndex);
  if (url !== null) {
    window.history.replaceState(null, "", url);
  }
}

function clearReplayUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("replay");
  url.searchParams.delete("chapter");
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

async function shareSavedReplayLink(): Promise<void> {
  const chapterIndex =
    replayLoopMode === "clip" ? null : currentSharedChapterIndex();
  const url = replayShareUrl(chapterIndex);
  if (url === null) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Replay link copied");
  } catch {
    showToast(url);
  }
}

function readReplayDeepLink(): {
  readonly roomCode: string;
  readonly clipId: string;
  readonly chapterIndex: number | null;
} | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("replay");
  if (raw === null) {
    return null;
  }
  const match = /^([A-Za-z]{4})\/([a-z0-9][a-z0-9-]{0,63})$/.exec(raw);
  if (match === null) {
    return null;
  }
  const roomCode = match[1]?.toUpperCase();
  const clipId = match[2];
  if (roomCode === undefined || clipId === undefined) {
    return null;
  }
  const chapterRaw = params.get("chapter");
  const chapter = chapterRaw === null ? Number.NaN : Number(chapterRaw);
  return {
    roomCode,
    clipId,
    chapterIndex:
      Number.isInteger(chapter) && chapter >= 0 ? chapter : null,
  };
}

async function openSharedReplay(
  link: NonNullable<ReturnType<typeof readReplayDeepLink>>,
): Promise<void> {
  try {
    const response = await fetch(
      `/api/replay/${link.roomCode}/${link.clipId}.json`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Replay download returned ${response.status}`);
    }
    const replayExport = parseReplayExport(await response.json());
    if (replayExport === null) {
      throw new Error("Replay payload is invalid");
    }
    playSavedReplay(replayExport, link.chapterIndex);
  } catch (error) {
    console.error(
      "Shared replay failed",
      error instanceof Error ? error.message : String(error),
    );
    showToast("Shared replay could not be loaded");
  }
}

function playSavedReplay(
  replayExport: WireReplayExport,
  startChapterIndex: number | null = null,
  fromQueue = false,
): boolean {
  const viewBuilder = new WireViewBuilder(replayExport.setup, null);
  const intervalMs =
    1_000 / Math.max(1, replayExport.setup.snapshotHz);
  const frameViews = replayExport.frames.map((frame) =>
    viewBuilder.build(frame),
  );
  const frames = frameViews.flatMap((view, index) =>
    view === null
      ? []
      : [{ view, recordedAtMs: index * intervalMs }],
  );
  if (frames.length < 2) {
    showToast("Saved replay has too few renderable frames");
    return false;
  }

  if (replay.active) {
    if (fromQueue) {
      replay.stop();
      replay.clear();
    } else {
      stopReplay();
    }
  }
  replay.clear();
  replay.setSpeed(replaySpeed, performance.now());
  if (!replay.loadSaved(frames) || !replay.startSaved(performance.now())) {
    showToast("Saved replay could not start");
    return false;
  }
  savedChapters = buildReplayChapters(replayExport.frames, intervalMs);
  savedChapterViews = frameViews;
  savedReplayActive = true;
  savedReplayRef = {
    roomCode: replayExport.code,
    clipId: replayExport.id,
  };
  savedReplayFrames = replayExport.frames;
  savedReplayIntervalMs = intervalMs;
  if (!fromQueue) {
    replayLoopMode = "off";
  }
  replayLoopChapterIndex = null;
  lastLoopElapsedMs = 0;
  lastReplayElapsedMs = 0;
  let selectedChapter: number | null = null;
  if (startChapterIndex !== null) {
    const chapter = savedChapters[startChapterIndex];
    if (chapter !== undefined) {
      replay.seek(chapter.progress, performance.now());
      if (!fromQueue) {
        replay.pause(performance.now());
      }
      replayLoopChapterIndex = startChapterIndex;
      lastLoopElapsedMs = chapter.timeMs;
      lastReplayElapsedMs = chapter.timeMs;
      selectedChapter = startChapterIndex;
    }
  }
  renderReplayChapters();
  savedAudioIndex = 0;
  savedAudioJumpPending = selectedChapter !== null;
  audio.reset();
  const firstFrame = replayExport.frames[0];
  if (firstFrame !== undefined) {
    audio.prime(firstFrame);
  }
  updateReplayUrl(selectedChapter);
  if (replayLibraryDialog.open) {
    replayLibraryDialog.close();
  }
  showMatch();
  document.body.dataset.savedReplay = "true";
  document.title = "Saved goal replay | Web Football";
  savedReplayHead.hidden = false;
  const queueLabel =
    reviewQueueActive && reviewQueueIndex >= 0
      ? `Clip ${reviewQueueIndex + 1}/${reviewQueue.length} · `
      : "";
  savedReplayTitle.textContent =
    `${queueLabel}Room ${replayExport.code} · ` +
    `${replayExport.scoreHome} – ${replayExport.scoreAway} · ` +
    `${formatGoalMinute(replayExport.clockSeconds)}`;
  replayBanner.hidden = false;
  matchOverlay.hidden = true;
  statsScreen.hidden = true;
  renderer.setReplayActive?.(true);
  renderer.setCameraMode?.(replayCamera);
  updateReplayButtons();
  updateReplayCameraButtons();
  updateCameraControl();
  return true;
}

function createLibraryNotice(text: string): HTMLParagraphElement {
  const notice = document.createElement("p");
  notice.className = "replay-library__notice";
  notice.textContent = text;
  return notice;
}

openReplayLibraryButton.addEventListener("click", openReplayLibrary);
refreshReplayLibraryButton.addEventListener("click", () => {
  void loadReplayLibrary();
});
closeReplayLibraryButton.addEventListener("click", () => {
  replayLibraryDialog.close();
});
clearReviewQueueButton.addEventListener("click", () => {
  reviewQueue = [];
  persistReviewQueue();
  updateReviewQueueBar();
});
startReviewQueueButton.addEventListener("click", startReviewQueue);
updateReviewQueueBar();
closeSavedReplayButton.addEventListener("click", stopReplay);

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
  homeName.title = setup.home.name;
  awayName.title = setup.away.name;
  homeSwatch.style.backgroundColor = setup.home.colors.primary;
  awaySwatch.style.backgroundColor = setup.away.colors.primary;
  matchView.style.setProperty("--home-color", setup.home.colors.primary);
  matchView.style.setProperty("--away-color", setup.away.colors.primary);
  document.title = `${setup.home.name} v ${setup.away.name} | Web Football`;
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
  updateControlCard(state);
  updateStatsScreen(state);
  updateRuleChip(state);

  const paused = state.pausedReason !== null;
  const online = state.status === "online";
  const frame = client.latestSnapshot();
  const phase = frame?.match.phase ?? null;
  updatePauseControl(state, phase);
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

function updateRuleChip(state: GameClientState): void {
  const settings = state.lobby?.room?.settings;
  matchRulesChip.hidden = settings === undefined;
  if (settings === undefined) {
    return;
  }
  const difficulty = settings.aiDifficulty
    .replace("worldClass", "world class")
    .replace(/^./, (letter) => letter.toUpperCase());
  matchRulesChip.textContent = `Ref ${settings.refereeStrictness} · AI ${difficulty}${
    settings.tieLegs === 2 ? " · Two legs" : ""
  }`;
}

function updatePauseControl(
  state: GameClientState,
  phase: SnapshotFrame["match"]["phase"] | null,
): void {
  const room = state.lobby?.room;
  const bothConnected =
    room !== undefined &&
    room !== null &&
    room.players.length === 2 &&
    room.players.every((player) => player.connected);
  const intermission = phase === "halfTime";
  const available =
    state.setup !== null &&
    phase !== null &&
    phase !== "fullTime" &&
    (!intermission || state.pausedManual);
  pauseMatchButton.hidden = !available;
  if (pauseMatchButton.hidden) {
    return;
  }
  pauseMatchButton.textContent = state.pausedManual ? "Resume" : "Pause";
  pauseMatchButton.disabled =
    !bothConnected ||
    state.status !== "online" ||
    (!state.pausedManual &&
      (state.pausedReason !== null || intermission));
  pauseMatchButton.title = state.pausedManual
    ? "Resume play for both seats"
    : "Pause play for both seats";
  pauseMatchButton.setAttribute(
    "aria-label",
    state.pausedManual ? "Resume match" : "Pause match",
  );
}

function updateStatsScreen(state: GameClientState): void {
  const stats = state.matchStats;
  if (stats === null) {
    statsScreen.hidden = true;
    statsRows.replaceChildren();
    statsNextLegButton.hidden = true;
    statsNextLegButton.disabled = false;
    statsNextLegButton.textContent = "Prepare second leg";
    statsNextLegWait.hidden = true;
    return;
  }
  const setup = state.setup;
  const score = setup === null
    ? ""
    : `${latestScore("home")} – ${latestScore("away")}`;
  const notes: string[] = [];
  const series = stats.series;
  const teamName = (side: "home" | "away"): string =>
    (side === "home" ? setup?.home.name : setup?.away.name) ?? side;
  if (series !== null) {
    notes.push(
      `Leg ${series.leg}/${series.legs} · aggregate ${series.homeAggregate}–${series.awayAggregate}`,
    );
  }
  if (stats.shootout !== null) {
    notes.push(
      `Penalties ${stats.shootout.homeScore}–${stats.shootout.awayScore}`,
    );
  }
  if (series?.complete === true) {
    notes.push(
      series.winner === null
        ? "Tie level on aggregate"
        : `${teamName(series.winner)} won the tie`,
    );
  } else if (stats.forfeitSide !== null) {
    notes.push(`${teamName(stats.forfeitSide)} forfeited`);
  } else if (stats.winner !== null) {
    notes.push(`${teamName(stats.winner)} won`);
  } else {
    notes.push("Draw");
  }
  if (series !== null && !series.complete) {
    notes.push("Host prepares the second leg");
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
  const betweenLegs =
    stats.series !== null &&
    stats.series.leg === 1 &&
    !stats.series.complete;
  const host = state.lobby?.you?.host === true;
  statsNextLegButton.hidden = !betweenLegs || !host;
  statsNextLegButton.disabled = false;
  statsNextLegButton.textContent = "Prepare second leg";
  statsNextLegWait.hidden = !betweenLegs || host;

  renderMatchStatsScreen(
    statsScreen,
    statsRows,
    statsTitle,
    statsScore,
    statsNote,
    { title: "Match statistics", score, note, rows },
  );
  statsScreen.hidden = replay.active;
}

function latestScore(side: "home" | "away"): number {
  const frame = client.latestSnapshot();
  if (frame === null) {
    return 0;
  }
  return side === "home" ? frame.match.scoreHome : frame.match.scoreAway;
}

interface ControlledPlayerInfo {
  readonly player: RenderPlayer;
  readonly name: string;
  readonly side: "home" | "away";
  readonly teamName: string;
}

function currentControlledPlayer(
  state: GameClientState,
): ControlledPlayerInfo | null {
  const setup = state.setup;
  const team = state.lobby?.you?.team;
  const view = latestView;
  if (
    setup === null ||
    view === null ||
    (team !== "home" && team !== "away")
  ) {
    return null;
  }
  const renderTeam = team === "home" ? view.home : view.away;
  const player = renderTeam.players.find((entry) => entry.controlled);
  if (player === undefined) {
    return null;
  }
  const roster = team === "home" ? setup.home.players : setup.away.players;
  const entry = roster.find((candidate) => candidate.id === player.id);
  return {
    player,
    name: entry?.name ?? "Player",
    side: team,
    teamName: team === "home" ? setup.home.name : setup.away.name,
  };
}

function updateControlPlayerChip(state: GameClientState): void {
  const info = currentControlledPlayer(state);
  controlPlayerChip.textContent =
    info === null ? "You: —" : `You: #${info.player.number} ${info.name}`;
}

function updateControlCard(state: GameClientState): void {
  const setup = state.setup;
  const matchId = setup?.matchId ?? null;
  if (matchId !== lastControlledMatchId) {
    lastControlledMatchId = matchId;
    lastControlledPlayerId = null;
  }
  const phase = client.latestSnapshot()?.match.phase ?? null;
  const info =
    state.matchStats === null && phase !== "fullTime"
      ? currentControlledPlayer(state)
      : null;
  if (setup === null || info === null) {
    controlCard.hidden = true;
    return;
  }

  controlCard.hidden = false;
  controlCard.style.setProperty(
    "--control-accent",
    setup[info.side].colors.primary,
  );
  controlNumber.textContent = `#${info.player.number}`;
  controlName.textContent = info.name;
  controlMeta.textContent = info.teamName;
  controlState.textContent = info.player.state.toUpperCase();

  const stamina = Math.max(0, Math.min(1, info.player.stamina));
  const staminaPercent = Math.round(stamina * 100);
  controlStaminaFill.style.width = `${staminaPercent}%`;
  controlStaminaValue.textContent = String(staminaPercent);
  controlStamina.dataset.level = stamina <= 0.25 ? "low" : "normal";

  const ball = latestView?.ball;
  const onBall =
    ball !== undefined &&
    Math.hypot(info.player.x - ball.x, info.player.y - ball.y) <=
      TUNING.control.actionBallReachM &&
    ball.z <= TUNING.ai.controlMaxBallHeightM;
  controlBall.hidden = !onBall;

  const sprintHeld =
    lastControlFrame !== null &&
    (lastControlFrame.buttons & CONTROL_BUTTONS.SPRINT) !== 0;
  controlSprint.hidden = !sprintHeld;

  const next = latestView?.[info.side].players.find(
    (player) => player.switchTarget,
  );
  if (next === undefined) {
    controlNext.textContent = "NEXT —";
    controlNext.title = "No switch target";
  } else {
    controlNext.textContent = `NEXT #${next.number}`;
    const roster =
      info.side === "home" ? setup.home.players : setup.away.players;
    const nextEntry = roster.find((candidate) => candidate.id === next.id);
    controlNext.title = nextEntry?.name ?? "Next player";
  }

  if (
    lastControlledPlayerId !== null &&
    lastControlledPlayerId !== info.player.id
  ) {
    showToast(`Now controlling #${info.player.number} ${info.name}`);
  }
  lastControlledPlayerId = info.player.id;
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
    showOverlay("Connection failed", state.detail, "danger");
    return;
  }

  if (state.status !== "online") {
    showOverlay(
      "Connection lost",
      "Reconnecting to the host. Your seat is held for 60 seconds.",
      "warning",
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
      "review",
    );
    return;
  }

  if (state.pausedReason !== null) {
    if (state.pausedManual) {
      showOverlay(
        "Match paused",
        "Paused by a player. Use Resume when both seats are ready.",
        "warning",
      );
      return;
    }
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
      "warning",
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
    showOverlay(
      "Penalty shootout",
      `${pens} ${score} after extra time.`,
      "final",
    );
    return;
  }
  if (match.phase === "fullTime") {
    showOverlay("Full time", `${score}. The match is complete.`, "final");
    return;
  }
  if (match.phase === "halfTime") {
    showOverlay(
      match.half >= 3 ? "Extra-time break" : "Half time",
      `${score}. The next period starts shortly.`,
      "interval",
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

type OverlayTone =
  | "info"
  | "warning"
  | "danger"
  | "review"
  | "interval"
  | "final";

function showOverlay(
  title: string,
  detail: string,
  tone: OverlayTone = "info",
): void {
  matchOverlay.hidden = false;
  matchOverlay.dataset.tone = tone;
  overlayTitle.textContent = title;
  overlayDetail.textContent = detail;
}

type ReplaySource = "goal" | "capture";

function toggleReplay(source: ReplaySource = "goal"): void {
  if (replay.active) {
    stopReplay();
    return;
  }
  const now = performance.now();
  replay.setSpeed(replaySpeed, now);
  const started =
    source === "capture" ? replay.startCapture(now) : replay.start(now);
  if (!started) {
    return;
  }
  localPrediction.reset();
  renderer.setReplayActive?.(true);
  renderer.setCameraMode?.(replayCamera);
  replayBanner.hidden = false;
  matchOverlay.hidden = true;
  statsScreen.hidden = true;
  updateReplayButtons();
  updateReplayCameraButtons();
  updateCameraControl();
}

function driveChapterLoop(sample: ReplaySample): void {
  if (
    !savedReplayActive ||
    replayLoopMode !== "chapter" ||
    savedChapters.length < 2 ||
    sample.paused
  ) {
    return;
  }
  const previousIndex = chapterIndexAt(savedChapters, lastLoopElapsedMs);
  const sampleIndex = chapterIndexAt(savedChapters, sample.elapsedMs);
  const currentIndex =
    replayLoopChapterIndex ??
    (sampleIndex > previousIndex && previousIndex >= 0
      ? previousIndex
      : sampleIndex);
  lastLoopElapsedMs = sample.elapsedMs;
  if (currentIndex < 0) {
    return;
  }
  const current = savedChapters[currentIndex];
  const next = savedChapters[currentIndex + 1];
  if (
    current === undefined ||
    next === undefined ||
    sample.elapsedMs < next.timeMs - 1
  ) {
    return;
  }
  replay.seek(current.progress, performance.now());
  lastLoopElapsedMs = current.timeMs;
  savedAudioJumpPending = true;
}

function driveSavedReplayAudio(sample: ReplaySample): void {
  if (!savedReplayActive || savedReplayFrames.length === 0) {
    return;
  }
  const index = Math.min(
    savedReplayFrames.length - 1,
    Math.max(0, Math.floor(sample.elapsedMs / savedReplayIntervalMs)),
  );
  if (savedAudioJumpPending || index < savedAudioIndex) {
    const frame = savedReplayFrames[index];
    audio.reset();
    if (frame !== undefined) {
      audio.prime(frame);
    }
    savedAudioIndex = index;
    savedAudioJumpPending = false;
    return;
  }
  if (sample.paused || index <= savedAudioIndex) {
    return;
  }
  for (let next = savedAudioIndex + 1; next <= index; next += 1) {
    const frame = savedReplayFrames[next];
    if (frame !== undefined) {
      audio.handleSnapshot(frame);
    }
  }
  savedAudioIndex = index;
}

function stopReplay(): void {
  const wasSaved = savedReplayActive;
  savedReplayActive = false;
  replay.stop();
  localPrediction.reset();
  renderer.setReplayActive?.(false);
  renderer.setCameraMode?.(cameraMode);
  replayBanner.hidden = true;
  savedReplayHead.hidden = true;
  delete document.body.dataset.savedReplay;
  savedReplayFrames = [];
  savedAudioIndex = -1;
  savedAudioJumpPending = false;
  savedChapters = [];
  savedChapterViews = [];
  replayLoopChapterIndex = null;
  lastLoopElapsedMs = 0;
  lastReplayElapsedMs = 0;
  replayLoopMode = "off";
  reviewQueueRequest += 1;
  reviewQueueActive = false;
  reviewQueueIndex = -1;
  reviewAdvancing = false;
  reviewChapterPreference = null;
  if (wasSaved) {
    savedReplayRef = null;
    clearReplayUrl();
  }
  renderReplayChapters();
  audio.reset();
  if (wasSaved) {
    showLobby();
    openReplayLibrary();
  } else if (currentState !== null) {
    updateStatsScreen(currentState);
  }
  updateReplayButtons();
  updateReplayCameraButtons();
  updateCameraControl();
}

function renderReplayTimelineMarkers(): void {
  replayTimelineMarkers.replaceChildren(
    ...savedChapters.map((chapter) => {
      const marker = document.createElement("span");
      marker.className =
        `replay-timeline-marker replay-timeline-marker--${chapter.kind}`;
      marker.style.left = `${chapter.progress * 100}%`;
      marker.title = chapter.label;
      return marker;
    }),
  );
}

function updateReplayLoopRange(sample?: ReplaySample | null): void {
  let range: { readonly start: number; readonly end: number } | null =
    null;
  if (replay.active && replayLoopMode === "clip") {
    range = { start: 0, end: 1 };
  } else if (
    replay.active &&
    replayLoopMode === "chapter" &&
    sample !== undefined &&
    sample !== null
  ) {
    const index =
      replayLoopChapterIndex ??
      chapterIndexAt(savedChapters, sample.elapsedMs);
    const chapter = savedChapters[index];
    if (chapter !== undefined) {
      const next = savedChapters[index + 1];
      range = {
        start: chapter.progress,
        end: next?.progress ?? 1,
      };
    }
  }
  if (range === null || range.end <= range.start) {
    replayLoopRange.hidden = true;
    return;
  }
  replayLoopRange.hidden = false;
  replayLoopRange.style.left = `${range.start * 100}%`;
  replayLoopRange.style.width = `${(range.end - range.start) * 100}%`;
}

function renderReplayChapters(): void {
  replayChapters.replaceChildren(
    ...savedChapters.map((chapter, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "replay-chapter";
      button.dataset.replayProgress = String(chapter.progress);
      button.dataset.replayChapter = String(index);
      button.title = `Jump to ${chapter.label}`;
      const canvas = document.createElement("canvas");
      canvas.className = "replay-chapter__thumb";
      canvas.setAttribute("aria-hidden", "true");
      const view = savedChapterViews[chapter.frameIndex];
      if (view !== null && view !== undefined) {
        drawReplayThumbnail(canvas, view);
      }
      const label = document.createElement("span");
      label.textContent = chapter.label;
      button.append(canvas, label);
      return button;
    }),
  );
  replayChapters.hidden = savedChapters.length === 0;
  renderReplayTimelineMarkers();
  updateReplayTransport();
}

function updateReplayButtons(): void {
  const active = replay.active;
  replayButton.textContent = active ? "Stop replay" : "Replay goal";
  replayButton.disabled = !active && !replay.hasClip;
  replayLastButton.disabled =
    active || !replay.hasCapture || replay.captureDurationMs < 2_000;
  updateReplayTransport();
}

function updateReplayTransport(sample?: ReplaySample | null): void {
  const active = replay.active;
  replayPauseButton.disabled = !active;
  replayStepBackButton.disabled = !active;
  replayStepForwardButton.disabled = !active;
  replaySeek.disabled = !active;
  replaySpeedSelect.disabled = !active;
  replayLoopButton.disabled = !active;
  replayLoopButton.setAttribute(
    "aria-pressed",
    String(replayLoopMode !== "off"),
  );
  replayLoopButton.textContent =
    replayLoopMode === "chapter"
      ? "Loop chapter"
      : replayLoopMode === "clip"
        ? "Loop clip"
        : "Loop";
  replayLoopButton.title =
    "Cycle loop: off, chapter range, whole clip";
  const queueTransport = savedReplayActive && reviewQueueActive;
  replayPrevClipButton.hidden = !queueTransport;
  replayNextClipButton.hidden = !queueTransport;
  replayPrevClipButton.disabled =
    !queueTransport ||
    reviewAdvancing ||
    reviewQueueIndex <= 0;
  replayNextClipButton.disabled =
    !queueTransport ||
    reviewAdvancing ||
    reviewQueueIndex + 1 >= reviewQueue.length;
  replayShareButton.hidden = !savedReplayActive;
  replayShareButton.disabled = !savedReplayActive;
  replayShareButton.title = "Copy a link to this clip at the current chapter";
  const chapterButtons = replayChapters.querySelectorAll("button");
  chapterButtons.forEach((button, index) => {
    button.disabled = !active;
    const current =
      sample !== undefined &&
      sample !== null &&
      chapterIndexAt(savedChapters, sample.elapsedMs) === index;
    button.toggleAttribute("data-current", current);
    if (current) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  replayPauseButton.textContent = replay.paused ? "Resume" : "Pause";
  if (sample !== undefined && sample !== null) {
    lastReplayElapsedMs = sample.elapsedMs;
  }
  updateReplayLoopRange(sample);
  if (!active) {
    replaySeek.value = "0";
    replaySeek.setAttribute("aria-valuetext", "0:00");
    replayProgress.textContent = "0.0s";
    return;
  }
  if (sample === undefined || sample === null) {
    return;
  }
  if (!replayScrubbing) {
    replaySeek.value = String(Math.round(sample.progress * 1_000));
  }
  replaySeek.setAttribute(
    "aria-valuetext",
    `${(sample.elapsedMs / 1_000).toFixed(1)} seconds`,
  );
  replayProgress.textContent = `${(sample.elapsedMs / 1_000).toFixed(
    1,
  )}s / ${(sample.durationMs / 1_000).toFixed(1)}s`;
}

function setReplayCamera(mode: CameraMode): void {
  if (!replay.active) {
    return;
  }
  replayCamera = mode;
  renderer.setCameraMode?.(mode);
  updateReplayCameraButtons();
}

function updateReplayCameraButtons(): void {
  replayAngles.hidden = rendererMode !== "3d";
  for (const button of replayCameraButtons) {
    const mode = parseCameraMode(button.dataset.replayCamera);
    button.setAttribute("aria-pressed", String(mode === replayCamera));
    button.disabled = !replay.active || rendererMode !== "3d";
  }
}

function switchRenderer(next: RendererMode): void {
  if (next === rendererMode) {
    return;
  }
  if (replay.active) {
    stopReplay();
  }
  renderer.destroy();
  mounted = mountMatchRenderer(pitchStage, next);
  renderer = mounted.renderer;
  rendererMode = mounted.mode;
  connectFootstepAudio();
  rendererFellBack = mounted.fellBack;
  renderer.setCameraMode?.(cameraMode);
  renderer.setQuality?.(visualQuality);
  renderer.setTemporalAa?.(temporalAaEnabled);
  bindTemporalAaHandler();
  saveRendererMode(rendererMode);
  if (rendererMode !== "3d") {
    delete pitchStage.dataset.quality;
  }
  updateRendererControl();
  updateCameraControl();
  updateQualityControl();
  updateTemporalAaControl();
  updateReplayCameraButtons();
  if (latestView !== null) {
    renderer.render(latestView);
    updateCameraIndicators();
  }
  renderer.resize();
  if (rendererFellBack) {
    showToast("3D view unavailable; using the 2D renderer");
  }
}

function loadLocalPrediction(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_PREDICTION_KEY) === "1";
  } catch {
    return false;
  }
}

function saveLocalPrediction(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      LOCAL_PREDICTION_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    // Storage can be unavailable; keep the session-only choice.
  }
}

function updatePredictionControl(): void {
  settingsPredictionButton.setAttribute(
    "aria-checked",
    String(localPredictionEnabled),
  );
  settingsPredictionButton.title = localPredictionEnabled
    ? "Visual prediction is on; the server remains authoritative"
    : "Enable local movement prediction for this browser";
}

function updateAudioControl(): void {
  audioToggleButton.textContent = audio.isEnabled ? "Sound on" : "Sound off";
  audioToggleButton.setAttribute("aria-pressed", String(audio.isEnabled));
  settingsSoundButton.setAttribute("aria-checked", String(audio.isEnabled));
}

function updateHapticsControl(): void {
  settingsHapticsButton.setAttribute(
    "aria-checked",
    String(haptics.isEnabled),
  );
  settingsHapticsButton.title = haptics.isSupported
    ? "Rumble is supported by the connected gamepad"
    : "Connect a compatible gamepad; Chromium supports dual-rumble";
}

function updateCameraControl(): void {
  const option = CAMERA_MODES.find((entry) => entry.id === cameraMode);
  cameraModeSelect.value = cameraMode;
  cameraModeSelect.disabled = rendererMode !== "3d" || replay.active;
  cameraModeSelect.title = replay.active
    ? "Pick a replay angle in the replay bar"
    : rendererMode === "3d"
      ? (option?.description ?? "Gameplay camera")
      : "Switch to the 3D view to change the camera";
}

function updateQualityControl(): void {
  settingsQualitySelect.value = visualQuality;
  settingsQualitySelect.disabled = rendererMode !== "3d";
  settingsQualitySelect.title =
    rendererMode === "3d"
      ? "3D shadows, crowd and effects quality"
      : "Switch to the 3D view to change quality";
}

function bindTemporalAaHandler(): void {
  temporalAaAutoDisabled = false;
  renderer.setTemporalAaAutoStateHandler?.((state) => {
    temporalAaAutoDisabled = state !== "retried";
    updateTemporalAaControl();
    showToast(
      state === "retried"
        ? "Temporal AA resumed after frame time recovered"
        : state === "exhausted"
          ? "Temporal AA stays off for this session"
          : "Temporal AA disabled to protect frame rate",
    );
  });
}

function updateTemporalAaControl(): void {
  const capability = renderer.temporalAaCapability?.();
  const supported = capability?.supported ?? true;
  const active =
    temporalAaEnabled && supported && !temporalAaAutoDisabled;
  settingsTaaButton.setAttribute("aria-checked", String(active));
  settingsTaaButton.disabled = rendererMode !== "3d" || !supported;
  settingsTaaButton.title =
    rendererMode !== "3d"
      ? "Switch to the 3D view to change temporal antialiasing"
      : temporalAaAutoDisabled
        ? "Temporal AA was disabled automatically to protect frame rate; enable to retry"
        : supported
          ? "Temporal resolve; disable if the GPU shows ghosting"
          : (capability?.reason ?? "This GPU cannot host temporal antialiasing");
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
  document.body.dataset.view = "match";
  lobbyView.hidden = true;
  matchView.hidden = false;
  window.requestAnimationFrame(() => {
    renderer.resize();
  });
}

function showLobby(): void {
  delete document.body.dataset.view;
  document.title = "Web Football | LAN Lobby";
  matchView.hidden = true;
  lobbyView.hidden = false;
}

function maybeAutoJoin(state: GameClientState): void {
  if (
    autoJoinAttempted ||
    replayDeepLink !== null ||
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

if (import.meta.env.DEV) {
  Object.defineProperty(window, "__FB_DEBUG__", {
    configurable: true,
    value: () => ({
      state: currentState,
      view: latestView,
      control: lastControlFrame,
      snapshot: client.latestSnapshot(),
    }),
  });
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}
