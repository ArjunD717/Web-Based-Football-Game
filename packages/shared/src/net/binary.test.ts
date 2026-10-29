// packages/shared/src/net/binary.test.ts
import { describe, expect, it } from "vitest";
import type { PlayerStateName } from "../domain/player-state";
import {
  BinaryProtocolError,
  decodeClientBinaryMessage,
  decodeSnapshot,
  encodeSnapshot,
  encodeSnapshotAck,
  readSnapshotHeader,
  SNAPSHOT_BODY_OFFSET,
  SNAPSHOT_MESSAGE_TYPE,
  type SnapshotFrame,
  type SnapshotPlayer,
} from "./binary";
import { encodeInputFrame } from "./input";
import { MATCH_TOTAL_PLAYERS } from "./messages";

function makeFrame(seq: number, tick = seq): SnapshotFrame {
  const players: SnapshotPlayer[] = Array.from(
    { length: MATCH_TOTAL_PLAYERS },
    (_, index) => ({
      x: 5 + (index % 11),
      y: 10 + index * 0.5,
      vx: index % 3,
      vy: -index % 3,
      facing: index % 4,
      state: "jog",
      stamina: 0.8,
    }),
  );
  return {
    seq,
    tick,
    baseSeq: 0,
    controlledHome: 0,
    controlledAway: 11,
    match: {
      phase: "live",
      half: 1,
      clockSeconds: 754,
      scoreHome: 0,
      scoreAway: 0,
      restartType: null,
      restartSide: null,
    },
    ball: {
      x: 52.5,
      y: 34,
      z: 0.11,
      vx: 3.5,
      vy: -1.25,
      vz: 0,
    },
    players,
  };
}

describe("snapshot encoding", () => {
  it("round-trips a full frame within quantisation", () => {
    const frame = makeFrame(1, 100);
    frame.players[0]!.state = "sprint";
    frame.players[1]!.state = "shoot";
    const encoded = encodeSnapshot(frame);
    expect(encoded[0]).toBe(SNAPSHOT_MESSAGE_TYPE);

    const decoded = decodeSnapshot(encoded);
    expect(decoded.seq).toBe(1);
    expect(decoded.tick).toBe(100);
    expect(decoded.baseSeq).toBe(0);
    expect(decoded.controlledHome).toBe(0);
    expect(decoded.controlledAway).toBe(11);
    expect(decoded.match).toEqual(frame.match);
    expect(decoded.ball).toEqual(frame.ball);
    expect(decoded.players).toHaveLength(MATCH_TOTAL_PLAYERS);
    expect(decoded.players[0]!.state).toBe("sprint");
    expect(decoded.players[1]!.state).toBe("shoot");
    expect(decoded.players[0]!.x).toBeCloseTo(frame.players[0]!.x, 2);
    expect(decoded.players[0]!.facing).toBeCloseTo(
      frame.players[0]!.facing,
      3,
    );
    expect(decoded.players[0]!.stamina).toBeCloseTo(0.8, 2);
  });

  it("encodes only changed players in a delta", () => {
    const baseline = makeFrame(10, 500);
    const previous = makeFrame(11, 502);
    const current: SnapshotFrame = {
      ...previous,
      players: previous.players.map((player) => ({ ...player })),
    };
    current.players[0]!.x += 1;
    current.players[5]!.state = "dribble";

    const full = encodeSnapshot(baseline);
    const delta = encodeSnapshot(current, baseline);
    expect(delta.byteLength).toBeLessThan(full.byteLength);

    const decoded = decodeSnapshot(delta, baseline);
    expect(decoded.baseSeq).toBe(10);
    expect(decoded.players[0]!.x).toBeCloseTo(current.players[0]!.x, 2);
    expect(decoded.players[5]!.state).toBe("dribble");
    expect(decoded.players[1]).toEqual(baseline.players[1]);
  });

  it("sends no player records when nothing changed", () => {
    const baseline = makeFrame(20);
    const encoded = encodeSnapshot(baseline, baseline);
    const decoded = decodeSnapshot(encoded, baseline);
    expect(decoded.baseSeq).toBe(20);
    expect(decoded.players).toEqual(baseline.players);
    expect(encoded.byteLength).toBe(39);
  });

  it("round-trips score, clock and restart state", () => {
    const frame: SnapshotFrame = {
      ...makeFrame(4, 900),
      match: {
        phase: "deadBall",
        half: 2,
        clockSeconds: 3210,
        scoreHome: 2,
        scoreAway: 1,
        restartType: "corner",
        restartSide: "away",
      },
    };
    const decoded = decodeSnapshot(encodeSnapshot(frame));
    expect(decoded.match).toEqual(frame.match);
  });

  it("quantises ball velocities to centimetres per second", () => {
    const frame = makeFrame(2);
    frame.ball.vx = 12.3456;
    const decoded = decodeSnapshot(encodeSnapshot(frame));
    expect(decoded.ball.vx).toBeCloseTo(12.35, 2);
  });

  it("round-trips every player state", () => {
    const states: PlayerStateName[] = [
      "idle",
      "jog",
      "sprint",
      "dribble",
      "pass",
      "shoot",
      "header",
      "volley",
      "tackle",
      "slide",
      "fall",
      "injured",
      "celebrate",
      "idle",
      "jog",
      "sprint",
      "dribble",
      "pass",
      "shoot",
      "header",
      "volley",
      "tackle",
    ];
    const base = makeFrame(3);
    const frame: SnapshotFrame = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        state: states[index]!,
      })),
    };
    const decoded = decodeSnapshot(encodeSnapshot(frame));
    expect(decoded.players.map((player) => player.state)).toEqual(states);
  });
});

describe("snapshot validation", () => {
  it("rejects a delta without its baseline", () => {
    const baseline = makeFrame(1);
    const delta = encodeSnapshot(makeFrame(2), baseline);
    expect(() => decodeSnapshot(delta)).toThrow(BinaryProtocolError);
  });

  it("rejects a mismatched baseline", () => {
    const baseline = makeFrame(1);
    const delta = encodeSnapshot(makeFrame(2), baseline);
    expect(() => decodeSnapshot(delta, makeFrame(9))).toThrow(
      BinaryProtocolError,
    );
  });

  it("rejects truncated and trailing bytes", () => {
    const encoded = encodeSnapshot(makeFrame(1));
    expect(() => decodeSnapshot(encoded.slice(0, 10))).toThrow(
      BinaryProtocolError,
    );
    const padded = new Uint8Array(encoded.byteLength + 1);
    padded.set(encoded);
    expect(() => decodeSnapshot(padded)).toThrow(BinaryProtocolError);
  });

  it("rejects an invalid player state code", () => {
    const encoded = encodeSnapshot(makeFrame(1));
    encoded[SNAPSHOT_BODY_OFFSET + 10] = 250;
    expect(() => decodeSnapshot(encoded)).toThrow(BinaryProtocolError);
  });

  it("rejects the wrong message type", () => {
    const encoded = encodeSnapshot(makeFrame(1));
    encoded[0] = 99;
    expect(() => decodeSnapshot(encoded)).toThrow(BinaryProtocolError);
  });

  it("rejects invalid controlled indices", () => {
    const frame = makeFrame(1);
    expect(() =>
      encodeSnapshot({ ...frame, controlledHome: 22 }),
    ).toThrow(BinaryProtocolError);

    const encoded = encodeSnapshot(frame);
    encoded[14] = 22;
    expect(() => decodeSnapshot(encoded)).toThrow(BinaryProtocolError);
  });

  it("rejects malformed match phase and restart state", () => {
    const badPhase = encodeSnapshot(makeFrame(1));
    badPhase[18] = 9;
    expect(() => decodeSnapshot(badPhase)).toThrow(BinaryProtocolError);

    const badRestart = encodeSnapshot(makeFrame(1));
    badRestart[20] = 3;
    badRestart[21] = 0;
    expect(() => decodeSnapshot(badRestart)).toThrow(BinaryProtocolError);

    const frame = makeFrame(1);
    expect(() =>
      encodeSnapshot({
        ...frame,
        match: { ...frame.match, half: 3 as 1 | 2 },
      }),
    ).toThrow(BinaryProtocolError);
  });

  it("decodes input frames through the client binary union", () => {
    const bytes = encodeInputFrame({
      seq: 7,
      moveX: 0.5,
      moveY: -0.5,
      buttons: 2,
      chargePower: 0.4,
    });
    const decoded = decodeClientBinaryMessage(bytes);
    expect(decoded?.kind).toBe("input");
    if (decoded?.kind !== "input") {
      throw new Error("Expected an input frame");
    }
    expect(decoded.frame.seq).toBe(7);
    expect(decoded.frame.moveX).toBeCloseTo(0.5, 3);
    expect(decoded.frame.moveY).toBeCloseTo(-0.5, 3);
    expect(decoded.frame.buttons).toBe(2);
    expect(decoded.frame.chargePower).toBeCloseTo(0.4, 2);
  });

});

describe("snapshot headers", () => {
  it("exposes seq, tick and delta metadata", () => {
    const baseline = makeFrame(10);
    const delta = encodeSnapshot(makeFrame(11, 900), baseline);
    expect(readSnapshotHeader(delta)).toEqual({
      seq: 11,
      tick: 900,
      baseSeq: 10,
      controlledHome: 0,
      controlledAway: 11,
      match: makeFrame(10).match,
      isDelta: true,
    });
    expect(readSnapshotHeader(new Uint8Array([1]))).toBeNull();
  });
});

describe("snapshot acks", () => {
  it("round-trips an ack", () => {
    const encoded = encodeSnapshotAck(1234);
    expect(encoded).toHaveLength(5);
    expect(decodeClientBinaryMessage(encoded)).toEqual({
      kind: "ack",
      seq: 1234,
    });
  });

  it("rejects invalid ack inputs", () => {
    expect(() => encodeSnapshotAck(-1)).toThrow(RangeError);
    expect(() => encodeSnapshotAck(1.5)).toThrow(RangeError);
    expect(decodeClientBinaryMessage(new Uint8Array([16, 1]))).toBeNull();
    expect(decodeClientBinaryMessage(new Uint8Array([77, 0, 0, 0, 1]))).toBeNull();
    expect(
      decodeClientBinaryMessage(new Uint8Array([16, 0, 0, 0, 0])),
    ).toBeNull();
  });
});
