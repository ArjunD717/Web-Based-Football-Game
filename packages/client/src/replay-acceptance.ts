// packages/client/src/replay-acceptance.ts

import {
  PROTOCOL_VERSION,
  WS_PATH,
  encodeClientMessage,
  parseServerMessage,
} from "@fb/shared";
import { parseReplayExport } from "./match/replay-gallery";
import { WireViewBuilder } from "./match/view-from-wire";
import { MatchReplayBuffer } from "./presentation/replay";
import {
  findReplayMotionWindow,
  measureReplayMotion,
} from "./presentation/replay-motion";
import { createThreeRenderer } from "./render/three-renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#pitch")!;
const result = document.querySelector<HTMLElement>("#result")!;

interface SocketReport {
  readonly secureContext: boolean;
  readonly connected: boolean;
  readonly welcome: boolean;
  readonly pong: boolean;
  readonly joined: boolean;
  readonly ready: boolean;
  readonly replayNotified: boolean;
  readonly clipId: string | null;
  readonly error: string | null;
}

const ROOM_CODE = "ABCD";

async function joinRoomOverWebSocket(): Promise<SocketReport> {
  const secureContext = window.isSecureContext;
  if (!secureContext) {
    return {
      secureContext,
      connected: false,
      welcome: false,
      pong: false,
      joined: false,
      ready: false,
      replayNotified: false,
      clipId: null,
      error: "page is not a secure context",
    };
  }
  return new Promise((resolve) => {
    let connected = false;
    let welcome = false;
    let pong = false;
    let joined = false;
    let ready = false;
    let replayNotified = false;
    let clipId: string | null = null;
    let settled = false;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${WS_PATH}`,
    );
    const finish = (error: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
      resolve({
        secureContext,
        connected,
        welcome,
        pong,
        joined,
        ready,
        replayNotified,
        clipId,
        error,
      });
    };
    const completeIfReady = (): void => {
      if (pong && joined && replayNotified) {
        finish(null);
      }
    };
    const timeout = setTimeout(() => {
      finish("room socket probe timed out");
    }, 20_000);
    socket.addEventListener("open", () => {
      connected = true;
      socket.send(
        encodeClientMessage({ t: "hello", protocolVersion: PROTOCOL_VERSION }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const message = parseServerMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.t === "welcome") {
        welcome = true;
        socket.send(
          encodeClientMessage({ t: "ping", clientTimeMs: Date.now() }),
        );
        socket.send(encodeClientMessage({ t: "joinRoom", code: ROOM_CODE }));
      } else if (message.t === "pong") {
        pong = true;
        completeIfReady();
      } else if (message.t === "lobbyState") {
        if (message.room?.code !== ROOM_CODE) {
          return;
        }
        joined = true;
        if (!ready) {
          ready = true;
          socket.send(encodeClientMessage({ t: "setReady", ready: true }));
        }
        completeIfReady();
      } else if (message.t === "replayClips") {
        const latest = message.clips.at(-1);
        if (latest !== undefined) {
          replayNotified = true;
          clipId = latest.id;
        }
        completeIfReady();
      } else if (message.t === "error") {
        finish(`${message.code}: ${message.message}`);
      }
    });
    socket.addEventListener("error", () => {
      finish("socket error");
    });
    socket.addEventListener("close", () => {
      if (!settled) {
        finish("socket closed before replay notification");
      }
    });
  });
}

const socketReport = await joinRoomOverWebSocket();
if (socketReport.error !== null) {
  throw new Error(socketReport.error);
}
if (socketReport.clipId === null) {
  throw new Error("Room did not notify a replay clip");
}
const endpoint = `/api/replay/${ROOM_CODE}/${socketReport.clipId}.json`;
const response = await fetch(endpoint);
if (!response.ok) {
  throw new Error(`Could not load replay from ${endpoint} (${response.status})`);
}
const parsed = parseReplayExport(await response.json());
if (parsed === null) {
  throw new Error("HTTP replay payload failed validation");
}
const builder = new WireViewBuilder(parsed.setup, null);
const intervalMs = 1_000 / parsed.setup.snapshotHz;
const frames = parsed.frames.flatMap((frame, index) => {
  const view = builder.build(frame);
  return view === null
    ? []
    : [{ view, recordedAtMs: index * intervalMs }];
});
if (frames.length !== parsed.frames.length) {
  throw new Error("Exported replay fixture has unbuildable frames");
}

const renderer = createThreeRenderer(canvas);
renderer.resize();
renderer.setQuality?.("low");
renderer.setCameraMode?.("broadcast");
renderer.setAutoTemporalAaDowngrade?.(false);

const motionWindow = findReplayMotionWindow(frames);
let motion: {
  readonly frameSpanMs: number;
  readonly fromOffsetMs: number;
  readonly toOffsetMs: number;
  readonly playerDeltaM: number;
  readonly ballDeltaM: number;
  readonly moved: boolean;
} | null = null;
if (motionWindow !== null) {
  const motionReplay = new MatchReplayBuffer({ speed: 1 });
  if (motionReplay.loadSaved(frames) && motionReplay.startSaved(0)) {
    const before = motionReplay.sample(motionWindow.fromOffsetMs);
    const after = motionReplay.sample(motionWindow.toOffsetMs);
    if (before !== null && after !== null) {
      const measured = measureReplayMotion(before.view, after.view);
      motion = {
        frameSpanMs: motionWindow.frameSpanMs,
        fromOffsetMs: motionWindow.fromOffsetMs,
        toOffsetMs: motionWindow.toOffsetMs,
        playerDeltaM: measured.playerDeltaM,
        ballDeltaM: measured.ballDeltaM,
        moved: measured.moved,
      };
    }
  }
}

const replay = new MatchReplayBuffer({ speed: 1 });
if (!replay.loadSaved(frames) || !replay.startSaved(0)) {
  throw new Error("Could not load the exported replay clip");
}

const expectedSteps = [
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["forward", 0],
  ["paused", 0],
  ["reverse", 1],
  ["reverse", 1],
  ["forward", 2],
  ["seek-back", 3],
  ["seek-forward", 4],
  ["loop", 5],
] as const;

const checks: {
  readonly step: string;
  readonly expected: number;
  readonly actual: number;
  readonly tick: number;
}[] = [];
let expectedIndex = 0;

function renderSample(sample: NonNullable<ReturnType<MatchReplayBuffer["sample"]>>, step: string): void {
  renderer.render(sample.view);
  const expected = expectedSteps[expectedIndex]?.[1] ?? -1;
  const diagnostics = renderer.temporalAaDiagnostics?.();
  checks.push({
    step,
    expected,
    actual: diagnostics?.timelineResets ?? -1,
    tick: sample.view.tick,
  });
  expectedIndex += 1;
}

for (const nowMs of [0, 500, 1_000, 1_500, 1_900]) {
  const sample = replay.sample(nowMs);
  if (sample === null) {
    throw new Error("Forward replay sample was null");
  }
  renderSample(sample, "forward");
}

if (!replay.pause(2_000)) {
  throw new Error("Could not pause replay");
}
const paused = replay.sample(2_000);
if (paused === null) {
  throw new Error("Paused sample was null");
}
renderSample(paused, "paused");

for (const [direction, label] of [
  [-1, "reverse"],
  [-1, "reverse"],
  [1, "forward"],
] as const) {
  if (!replay.stepFrame(direction, 2_000)) {
    throw new Error(`${label} step failed`);
  }
  const sample = replay.sample(2_000);
  if (sample === null) {
    throw new Error(`${label} sample was null`);
  }
  renderSample(sample, label);
}

if (!replay.seek(0.1, 2_000)) {
  throw new Error("Backward seek failed");
}
const back = replay.sample(2_000);
if (back === null) {
  throw new Error("Backward seek sample was null");
}
renderSample(back, "seek-back");

if (!replay.resume(2_000) || !replay.seek(0.95, 2_000)) {
  throw new Error("Forward seek setup failed");
}
const forward = replay.sample(2_000);
if (forward === null) {
  throw new Error("Forward seek sample was null");
}
renderSample(forward, "seek-forward");

const looped = replay.sample(7_000, true);
if (looped === null) {
  throw new Error("Loop sample was null");
}
renderSample(looped, "loop");

const failed = checks.filter((check) => check.actual !== check.expected);
const motionPassed = motion !== null && motion.moved;
const socketPassed =
  socketReport.secureContext &&
  socketReport.connected &&
  socketReport.welcome &&
  socketReport.pong &&
  socketReport.joined &&
  socketReport.ready &&
  socketReport.replayNotified;
const report = {
  status:
    failed.length === 0 && motionPassed && socketPassed ? "PASS" : "FAIL",
  source: "http",
  tls: {
    protocol: location.protocol,
    secureContext: window.isSecureContext,
  },
  socket: socketReport,
  endpoint,
  replayCode: parsed.code,
  clipId: parsed.id,
  frameCount: frames.length,
  taaSupported:
    renderer.temporalAaDiagnostics?.().supported ?? false,
  timelineResets: renderer.temporalAaDiagnostics?.().timelineResets ?? -1,
  motion,
  checks,
};
result.textContent = JSON.stringify(report, null, 2);
(window as { __replayAcceptance?: typeof report }).__replayAcceptance = report;
