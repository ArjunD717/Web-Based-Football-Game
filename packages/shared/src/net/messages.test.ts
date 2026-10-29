// packages/shared/src/net/messages.test.ts
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../version";
import {
  CLOSE_CODES,
  WS_PATH,
  encodeClientMessage,
  encodeServerMessage,
  isCompatibleProtocol,
  parseClientMessage,
  parseServerMessage,
} from "./messages";

describe("protocol constants", () => {
  it("uses a single websocket path and private close codes", () => {
    expect(WS_PATH).toBe("/ws");
    expect(CLOSE_CODES.PROTOCOL_MISMATCH).toBeGreaterThanOrEqual(4000);
    expect(CLOSE_CODES.PROTOCOL_MISMATCH).toBeLessThan(5000);
    expect(new Set(Object.values(CLOSE_CODES)).size).toBe(
      Object.values(CLOSE_CODES).length,
    );
  });

  it("only accepts the current protocol version", () => {
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol(PROTOCOL_VERSION + 1)).toBe(false);
  });
});

describe("client message parsing", () => {
  it("round-trips a hello", () => {
    const encoded = encodeClientMessage({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(parseClientMessage(encoded)).toEqual({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it("round-trips a ping", () => {
    const encoded = encodeClientMessage({ t: "ping", clientTimeMs: 1234 });
    expect(parseClientMessage(encoded)).toEqual({
      t: "ping",
      clientTimeMs: 1234,
    });
  });

  it("ignores unknown fields", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ t: "hello", protocolVersion: 1, extra: true }),
      ),
    ).toEqual({ t: "hello", protocolVersion: 1 });
  });

  it.each([
    ["not json", "{"],
    ["json array", "[]"],
    ["json null", "null"],
    ["missing tag", JSON.stringify({ protocolVersion: 1 })],
    ["unknown tag", JSON.stringify({ t: "kick" })],
    ["string version", JSON.stringify({ t: "hello", protocolVersion: "1" })],
    ["negative version", JSON.stringify({ t: "hello", protocolVersion: -1 })],
    ["fractional version", JSON.stringify({ t: "hello", protocolVersion: 1.5 })],
    ["negative timestamp", JSON.stringify({ t: "ping", clientTimeMs: -1 })],
    ["infinite timestamp", '{"t":"ping","clientTimeMs":1e999}'],
  ])("rejects %s", (_label, text) => {
    expect(parseClientMessage(text)).toBeNull();
  });
});

describe("server message parsing", () => {
  it("round-trips welcome, presence, pong and error", () => {
    const welcome = {
      t: "welcome" as const,
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: "0.1.0",
      sessionId: "session-1",
      serverTimeMs: 1_000,
    };
    expect(parseServerMessage(encodeServerMessage(welcome))).toEqual(welcome);

    const presence = { t: "presence" as const, connectedClients: 2 };
    expect(parseServerMessage(encodeServerMessage(presence))).toEqual(presence);

    const pong = {
      t: "pong" as const,
      clientTimeMs: 10,
      serverTimeMs: 15,
    };
    expect(parseServerMessage(encodeServerMessage(pong))).toEqual(pong);

    const error = {
      t: "error" as const,
      code: "protocol_mismatch" as const,
      message: "expected 1",
    };
    expect(parseServerMessage(encodeServerMessage(error))).toEqual(error);
  });

  it.each([
    ["bad JSON", "{"],
    ["unknown tag", JSON.stringify({ t: "goal" })],
    [
      "bad error code",
      JSON.stringify({ t: "error", code: "explode", message: "no" }),
    ],
    [
      "missing session",
      JSON.stringify({
        t: "welcome",
        protocolVersion: 1,
        serverVersion: "1",
        serverTimeMs: 0,
      }),
    ],
    ["negative presence", JSON.stringify({ t: "presence", connectedClients: -1 })],
  ])("rejects %s", (_label, text) => {
    expect(parseServerMessage(text)).toBeNull();
  });
});

describe("M2 lobby messages", () => {
  it("parses a hello carrying a resume token", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "hello",
          protocolVersion: PROTOCOL_VERSION,
          sessionToken: "token-123",
        }),
      ),
    ).toEqual({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: "token-123",
    });
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "hello",
          protocolVersion: PROTOCOL_VERSION,
          sessionToken: "",
        }),
      ),
    ).toBeNull();
  });

  it("parses room commands", () => {
    expect(parseClientMessage('{"t":"createRoom"}')).toEqual({
      t: "createRoom",
    });
    expect(parseClientMessage('{"t":"joinRoom","code":"WXYZ"}')).toEqual({
      t: "joinRoom",
      code: "WXYZ",
    });
    expect(parseClientMessage('{"t":"setReady","ready":true}')).toEqual({
      t: "setReady",
      ready: true,
    });
    expect(parseClientMessage('{"t":"leaveRoom"}')).toEqual({ t: "leaveRoom" });
    expect(parseClientMessage('{"t":"resync"}')).toEqual({ t: "resync" });
    expect(parseClientMessage('{"t":"joinRoom","code":"abc"}')).toBeNull();
  });

  it("round-trips lobby state", () => {
    const message = {
      t: "lobbyState" as const,
      room: {
        code: "ABCD",
        phase: "waiting" as const,
        players: [
          {
            seat: 0,
            name: "Host",
            team: "home" as const,
            ready: false,
            connected: true,
            host: true,
          },
        ],
        reconnectSeconds: null,
      },
      you: {
        seat: 0,
        team: "home" as const,
        host: true,
        ready: false,
      },
    };
    expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "lobbyState",
          room: null,
          you: null,
        }),
      ),
    ).toEqual({ t: "lobbyState", room: null, you: null });
  });

  it("round-trips match lifecycle and setup", () => {
    const matchStart = {
      t: "matchStart" as const,
      setup: makeSetup(),
    };
    expect(parseServerMessage(encodeServerMessage(matchStart))).toEqual(
      matchStart,
    );

    const paused = {
      t: "matchPaused" as const,
      reason: "Opponent disconnected",
      reconnectSeconds: 60,
    };
    expect(parseServerMessage(encodeServerMessage(paused))).toEqual(paused);
    expect(
      parseServerMessage(encodeServerMessage({ t: "matchResumed" })),
    ).toEqual({ t: "matchResumed" });
    expect(
      parseServerMessage(
        encodeServerMessage({ t: "roomClosed", reason: "Host left" }),
      ),
    ).toEqual({ t: "roomClosed", reason: "Host left" });
  });

  it("rejects malformed lobby and setup payloads", () => {
    const valid = makeSetup();
    const badTeam = {
      ...valid,
      home: { ...valid.home, players: valid.home.players.slice(0, 10) },
    };
    expect(
      parseServerMessage(
        JSON.stringify({ t: "matchStart", setup: badTeam }),
      ),
    ).toBeNull();

    expect(
      parseServerMessage(
        JSON.stringify({
          t: "lobbyState",
          room: {
            code: "ABCD",
            phase: "live",
            players: [],
            reconnectSeconds: null,
          },
          you: {
            seat: 0,
            team: "home",
            host: true,
            ready: false,
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseServerMessage(
        JSON.stringify({
          t: "matchPaused",
          reason: "x",
          reconnectSeconds: -1,
        }),
      ),
    ).toBeNull();
  });
});

function makeSetup() {
  const players = (side: "home" | "away") =>
    Array.from({ length: 11 }, (_, index) => ({
      id: `${side}-${index + 1}`,
      number: index + 1,
      goalkeeper: index === 0,
    }));
  return {
    matchId: "match-1",
    seed: 42,
    tickHz: 60,
    snapshotHz: 30,
    pitch: {
      lengthM: 105,
      widthM: 68,
      goalWidthM: 7.32,
      goalHeightM: 2.44,
      goalPostRadiusM: 0.06,
      goalNetDepthM: 1.8,
      penaltyAreaLengthM: 16.5,
      penaltyAreaWidthM: 40.32,
      goalAreaLengthM: 5.5,
      goalAreaWidthM: 18.32,
      penaltySpotDistanceM: 11,
      penaltyArcRadiusM: 9.15,
      cornerArcRadiusM: 1,
    },
    home: {
      side: "home" as const,
      name: "Home XI",
      colors: { primary: "#2f6bff", secondary: "#dce7ff", keeper: "#f2c94c" },
      players: players("home"),
    },
    away: {
      side: "away" as const,
      name: "Away XI",
      colors: { primary: "#e95252", secondary: "#ffe1e1", keeper: "#9be564" },
      players: players("away"),
    },
  };
}

