// packages/client/src/presentation/replay-export-fixture.ts

import {
  TUNING,
  type MatchSetupWire,
  type SnapshotFrame,
  type SnapshotPlayer,
  type WireReplayExport,
  type WireRosterPlayer,
  type WireTeam,
} from "@fb/shared";

const FORMATION: readonly (readonly [number, number])[] = [
  [4, 34],
  [18, 12],
  [18, 28],
  [18, 40],
  [18, 56],
  [36, 18],
  [36, 34],
  [36, 50],
  [58, 14],
  [58, 34],
  [58, 54],
];

const FRAME_COUNT = 21;
const TICK_STEP = 1;

function roster(side: "home" | "away"): readonly WireRosterPlayer[] {
  return Array.from({ length: 11 }, (_, index) => ({
    id: `${side}-${index}`,
    name: `${side === "home" ? "Home" : "Away"} ${index + 1}`,
    number: index + 1,
    goalkeeper: index === 0,
    sprintSpeed: 60 + index,
  }));
}

function team(side: "home" | "away"): WireTeam {
  return {
    side,
    name: side === "home" ? "Fixture Home" : "Fixture Away",
    colors:
      side === "home"
        ? { primary: "#e7e1cf", secondary: "#111815", keeper: "#f1c75b" }
        : { primary: "#4b6bff", secondary: "#e7e1cf", keeper: "#f1c75b" },
    players: roster(side),
    bench: [],
  };
}

function setup(): MatchSetupWire {
  return {
    matchId: "fixture-export",
    seed: 7,
    tickHz: 60,
    snapshotHz: 10,
    pitch: { ...TUNING.pitch },
    home: team("home"),
    away: team("away"),
  };
}

function players(tick: number): readonly SnapshotPlayer[] {
  const phase = tick / 60;
  return FORMATION.flatMap(([x, y], index) => {
    const result: SnapshotPlayer[] = [];
    for (const side of ["home", "away"] as const) {
      const mirroredX = side === "home" ? x : 105 - x;
      const mirroredY = side === "home" ? y : 68 - y;
      const drift = Math.sin(phase + index * 0.2) * 0.4;
      result.push({
        x: mirroredX + drift,
        y: mirroredY + Math.cos(phase + index * 0.15) * 0.3,
        vx: side === "home" ? 0.4 : -0.4,
        vy: 0,
        facing: side === "home" ? Math.PI / 2 : -Math.PI / 2,
        state: index === 0 ? "idle" : "jog",
        stamina: 1,
        sentOff: false,
        unavailable: false,
        yellowCards: 0,
      });
    }
    return result;
  });
}

function frame(index: number): SnapshotFrame {
  const tick = index * TICK_STEP;
  const ballX = 52.5 + Math.sin(index * 0.2) * 2;
  return {
    seq: index + 1,
    tick,
    baseSeq: 0,
    controlledHome: -1,
    controlledAway: -1,
    match: {
      phase: "live",
      half: 1,
      clockSeconds: 60 + tick / 60,
      addedTimeSeconds: 0,
      scoreHome: 1,
      scoreAway: 0,
      restartType: null,
      restartSide: null,
      lastEvent: null,
    },
    ball: {
      x: ballX,
      y: 34,
      z: TUNING.ball.radiusM,
      vx: 0,
      vy: 0,
      vz: 0,
    },
    players: players(tick),
  };
}

/**
 * Export-shaped fixture used by the browser acceptance page and CI tests.
 * It is synthetic, but passes the same parser and view builder as a downloaded
 * `/api/replay/<room>/<clip>.json` payload.
 */
export function buildReplayExportFixture(): WireReplayExport {
  const matchSetup = setup();
  const frames = Array.from({ length: FRAME_COUNT }, (_, index) =>
    frame(index),
  );
  return {
    id: "fixture-goal",
    kind: "goal",
    scoreHome: 1,
    scoreAway: 0,
    clockSeconds: 60,
    half: 1,
    createdAtMs: 0,
    frameCount: frames.length,
    code: "ABCD",
    generatedAtMs: 0,
    setup: matchSetup,
    frames,
  };
}
