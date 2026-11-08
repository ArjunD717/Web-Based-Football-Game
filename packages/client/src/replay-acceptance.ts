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

const endpoint = "/api/replay/ABCD/g1.json";
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

interface SocketReport {
  readonly secureContext: boolean;
  readonly connected: boolean;
  readonly welcome: boolean;
  readonly pong: boolean;
  readonly error: string | null;
}

async function probeWebSocket(): Promise<SocketReport> {
  const secureContext = window.isSecureContext;
  if (!secureContext) {
    return {
      secureContext,
      connected: false,
      welcome: false,
      pong: false,
      error: "page is not a secure context",
    };
  }
  return new Promise((resolve) => {
    let connected = false;
    let welcome = false;
    let pong = false;
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
      resolve({ secureContext, connected, welcome, pong, error });
    };
    const timeout = setTimeout(() => {
      finish("socket probe timed out");
    }, 5_000);
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
      if (message?.t === "welcome") {
        welcome = true;
        socket.send(
          encodeClientMessage({ t: "ping", clientTimeMs: Date.now() }),
        );
      } else if (message?.t === "pong" && welcome) {
        pong = true;
        finish(null);
      }
    });
    socket.addEventListener("error", () => {
      finish("socket error");
    });
    socket.addEventListener("close", () => {
      if (!pong) {
        finish("socket closed before pong");
      }
    });
  });
}

const socketReport = await probeWebSocket();

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
  socketReport.pong;
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
