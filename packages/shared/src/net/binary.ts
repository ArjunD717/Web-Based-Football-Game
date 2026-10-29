// packages/shared/src/net/binary.ts
import {
  PLAYER_STATE_CODES,
  playerStateCode,
  playerStateName,
  type PlayerStateName,
} from "../domain/player-state";
import {
  INPUT_MESSAGE_TYPE,
  decodeInputFrame,
  type InputFrame,
} from "./input";
import { MATCH_TOTAL_PLAYERS } from "./messages";

export const SNAPSHOT_MESSAGE_TYPE = 1;
export const SNAPSHOT_ACK_MESSAGE_TYPE = 16;

const TAU = Math.PI * 2;
const SNAPSHOT_FLAG_DELTA = 1;
const HEADER_BYTES = 29;
const BALL_BYTES = 12;
const MASK_BYTES = Math.ceil(MATCH_TOTAL_PLAYERS / 8);
const PLAYER_RECORD_BYTES = 13;
/** First player-record byte; useful to tests and the resync decoder. */
export const SNAPSHOT_BODY_OFFSET = HEADER_BYTES + BALL_BYTES + MASK_BYTES;
const BODY_OFFSET = SNAPSHOT_BODY_OFFSET;
const CONTROL_NONE = 255;
const POSITION_SCALE = 100;
const VELOCITY_SCALE = 100;
const STAMINA_SCALE = 255;
const FACING_SCALE = 65_535;

export type SnapshotMatchPhase =
  | "deadBall"
  | "live"
  | "halfTime"
  | "fullTime";

export type SnapshotRestartType =
  | "kickoff"
  | "throwIn"
  | "goalKick"
  | "corner"
  | "directFreeKick"
  | "indirectFreeKick"
  | "penalty";

export interface SnapshotMatch {
  readonly phase: SnapshotMatchPhase;
  readonly half: 1 | 2;
  readonly clockSeconds: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly restartType: SnapshotRestartType | null;
  readonly restartSide: "home" | "away" | null;
  /** Latest disciplinary/rule event; clients show it until a newer one lands. */
  readonly lastEvent: SnapshotEvent | null;
}

export type SnapshotEventType =
  | "foul"
  | "advantage"
  | "yellowCard"
  | "redCard"
  | "offside"
  | "handball"
  | "penalty";

export interface SnapshotEvent {
  readonly seq: number;
  readonly type: SnapshotEventType;
  readonly side: "home" | "away";
  readonly playerNumber: number | null;
}

const PHASE_CODES: Readonly<Record<SnapshotMatchPhase, number>> = {
  deadBall: 0,
  live: 1,
  halfTime: 2,
  fullTime: 3,
};
const PHASES_BY_CODE: Record<number, SnapshotMatchPhase> = {
  0: "deadBall",
  1: "live",
  2: "halfTime",
  3: "fullTime",
};
const RESTART_CODES: Readonly<Record<SnapshotRestartType, number>> = {
  kickoff: 1,
  throwIn: 2,
  goalKick: 3,
  corner: 4,
  directFreeKick: 5,
  indirectFreeKick: 6,
  penalty: 7,
};
const RESTARTS_BY_CODE: Record<number, SnapshotRestartType> = {
  1: "kickoff",
  2: "throwIn",
  3: "goalKick",
  4: "corner",
  5: "directFreeKick",
  6: "indirectFreeKick",
  7: "penalty",
};
const EVENT_CODES: Readonly<Record<SnapshotEventType, number>> = {
  foul: 1,
  advantage: 2,
  yellowCard: 3,
  redCard: 4,
  offside: 5,
  handball: 6,
  penalty: 7,
};
const EVENTS_BY_CODE: Record<number, SnapshotEventType> = {
  1: "foul",
  2: "advantage",
  3: "yellowCard",
  4: "redCard",
  5: "offside",
  6: "handball",
  7: "penalty",
};

export class BinaryProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinaryProtocolError";
  }
}

export interface SnapshotBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SnapshotPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: PlayerStateName;
  stamina: number;
  sentOff: boolean;
  yellowCards: number;
}

export interface SnapshotFrame {
  readonly seq: number;
  readonly tick: number;
  readonly baseSeq: number;
  /** Active player index for each side, or -1 when unset. */
  readonly controlledHome: number;
  readonly controlledAway: number;
  readonly match: SnapshotMatch;
  readonly ball: SnapshotBall;
  readonly players: readonly SnapshotPlayer[];
}

export interface SnapshotAck {
  readonly kind: "ack";
  readonly seq: number;
}

export interface InputBinaryMessage {
  readonly kind: "input";
  readonly frame: InputFrame;
}

export type ClientBinaryMessage = SnapshotAck | InputBinaryMessage;

interface QuantizedBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface QuantizedPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: number;
  stamina: number;
  sentOff: boolean;
  yellowCards: number;
}

/**
 * Encode a quantised snapshot. When `baseline` is provided, only players whose
 * quantised fields differ are written; the ball is always included.
 */
export function encodeSnapshot(
  frame: SnapshotFrame,
  baseline: SnapshotFrame | null = null,
): Uint8Array {
  validateFrame(frame);
  const ball = quantizeBall(frame.ball);
  const quantized = frame.players.map((player) => quantizePlayer(player));
  const baselineQuantized =
    baseline === null
      ? null
      : baseline.players.map((player) => quantizePlayer(player));

  const mask = new Uint8Array(MASK_BYTES);
  let changedCount = 0;
  for (let index = 0; index < MATCH_TOTAL_PLAYERS; index += 1) {
    const current = quantized[index];
    if (current === undefined) {
      throw new BinaryProtocolError(`Missing player ${index}`);
    }
    const previous = baselineQuantized?.[index];
    const changed =
      previous === undefined || !sameQuantizedPlayer(current, previous);
    if (changed) {
      mask[index >> 3]! |= 1 << (index & 7);
      changedCount += 1;
    }
  }

  const bytes = new Uint8Array(
    BODY_OFFSET + changedCount * PLAYER_RECORD_BYTES,
  );
  const view = new DataView(bytes.buffer);
  bytes[0] = SNAPSHOT_MESSAGE_TYPE;
  bytes[1] = baseline === null ? 0 : SNAPSHOT_FLAG_DELTA;
  view.setUint32(2, frame.seq, true);
  view.setUint32(6, frame.tick, true);
  view.setUint32(10, baseline?.seq ?? 0, true);
  bytes[14] = encodeControlIndex(frame.controlledHome);
  bytes[15] = encodeControlIndex(frame.controlledAway);
  view.setUint16(
    16,
    Math.min(65_535, Math.max(0, Math.round(frame.match.clockSeconds))),
    true,
  );
  bytes[18] = PHASE_CODES[frame.match.phase];
  bytes[19] = frame.match.half;
  bytes[20] =
    frame.match.restartType === null
      ? 0
      : RESTART_CODES[frame.match.restartType];
  bytes[21] =
    frame.match.restartSide === null
      ? 0
      : frame.match.restartSide === "home"
        ? 1
        : 2;
  bytes[22] = frame.match.scoreHome;
  bytes[23] = frame.match.scoreAway;
  const event = frame.match.lastEvent;
  view.setUint16(24, Math.min(65_535, event?.seq ?? 0), true);
  bytes[26] = event === null ? 0 : EVENT_CODES[event.type];
  bytes[27] =
    event === null ? 0 : event.side === "home" ? 1 : 2;
  bytes[28] = event?.playerNumber ?? 0;

  let offset = HEADER_BYTES;
  writeBall(view, offset, ball);
  offset += BALL_BYTES;
  bytes.set(mask, offset);
  offset += MASK_BYTES;

  for (let index = 0; index < MATCH_TOTAL_PLAYERS; index += 1) {
    if ((mask[index >> 3]! & (1 << (index & 7))) === 0) {
      continue;
    }
    const player = quantized[index]!;
    writePlayer(view, offset, player);
    offset += PLAYER_RECORD_BYTES;
  }

  return bytes;
}

export interface SnapshotHeader {
  readonly seq: number;
  readonly tick: number;
  readonly baseSeq: number;
  readonly controlledHome: number;
  readonly controlledAway: number;
  readonly match: SnapshotMatch;
  readonly isDelta: boolean;
}

export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader | null {
  if (bytes.byteLength < HEADER_BYTES || bytes[0] !== SNAPSHOT_MESSAGE_TYPE) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[1]!;
  if ((flags & ~SNAPSHOT_FLAG_DELTA) !== 0) {
    return null;
  }
  const controlledHome = decodeControlIndex(bytes[14]!);
  const controlledAway = decodeControlIndex(bytes[15]!);
  const match = decodeMatch(bytes);
  if (controlledHome === null || controlledAway === null || match === null) {
    return null;
  }
  return {
    seq: view.getUint32(2, true),
    tick: view.getUint32(6, true),
    baseSeq: view.getUint32(10, true),
    controlledHome,
    controlledAway,
    match,
    isDelta: (flags & SNAPSHOT_FLAG_DELTA) !== 0,
  };
}

export function decodeSnapshot(
  bytes: Uint8Array,
  baseline: SnapshotFrame | null = null,
): SnapshotFrame {
  if (bytes.byteLength < BODY_OFFSET) {
    throw new BinaryProtocolError("Snapshot frame is too short");
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  if (bytes[0] !== SNAPSHOT_MESSAGE_TYPE) {
    throw new BinaryProtocolError("Not a snapshot frame");
  }
  const flags = bytes[1]!;
  if ((flags & ~SNAPSHOT_FLAG_DELTA) !== 0) {
    throw new BinaryProtocolError(`Unknown snapshot flags ${flags}`);
  }
  const seq = view.getUint32(2, true);
  const tick = view.getUint32(6, true);
  const baseSeq = view.getUint32(10, true);
  const isDelta = (flags & SNAPSHOT_FLAG_DELTA) !== 0;
  if (isDelta) {
    if (baseline === null) {
      throw new BinaryProtocolError("Delta snapshot without baseline");
    }
    if (baseline.seq !== baseSeq) {
      throw new BinaryProtocolError(
        `Baseline seq ${baseline.seq} does not match ${baseSeq}`,
      );
    }
  } else if (baseSeq !== 0) {
    throw new BinaryProtocolError("Full snapshot has a non-zero base seq");
  }
  const controlledHome = decodeControlIndex(bytes[14]!);
  const controlledAway = decodeControlIndex(bytes[15]!);
  const match = decodeMatch(bytes);
  if (
    controlledHome === null ||
    controlledAway === null ||
    match === null
  ) {
    throw new BinaryProtocolError("Invalid controlled player or match state");
  }

  let offset = HEADER_BYTES;
  const ball = readBall(view, offset);
  offset += BALL_BYTES;
  const mask = bytes.slice(offset, offset + MASK_BYTES);
  offset += MASK_BYTES;

  const players: SnapshotPlayer[] = [];
  for (let index = 0; index < MATCH_TOTAL_PLAYERS; index += 1) {
    if ((mask[index >> 3]! & (1 << (index & 7))) !== 0) {
      if (offset + PLAYER_RECORD_BYTES > bytes.byteLength) {
        throw new BinaryProtocolError("Truncated player record");
      }
      players.push(readPlayer(view, offset));
      offset += PLAYER_RECORD_BYTES;
      continue;
    }

    const previous = baseline?.players[index];
    if (previous === undefined) {
      throw new BinaryProtocolError(
        `Missing baseline for unchanged player ${index}`,
      );
    }
    players.push(previous);
  }

  if (offset !== bytes.byteLength) {
    throw new BinaryProtocolError("Unexpected trailing snapshot bytes");
  }

  for (
    let bit = MATCH_TOTAL_PLAYERS;
    bit < MASK_BYTES * 8;
    bit += 1
  ) {
    if ((mask[bit >> 3]! & (1 << (bit & 7))) !== 0) {
      throw new BinaryProtocolError("Snapshot mask sets an unused player bit");
    }
  }

  return {
    seq,
    tick,
    baseSeq,
    controlledHome,
    controlledAway,
    match,
    ball,
    players,
  };
}

export function encodeSnapshotAck(seq: number): Uint8Array {
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new RangeError(`ack seq must be a uint32, received ${seq}`);
  }
  const bytes = new Uint8Array(5);
  const view = new DataView(bytes.buffer);
  bytes[0] = SNAPSHOT_ACK_MESSAGE_TYPE;
  view.setUint32(1, seq, true);
  return bytes;
}

export function decodeClientBinaryMessage(
  bytes: Uint8Array,
): ClientBinaryMessage | null {
  if (bytes.byteLength > 0 && bytes[0] === INPUT_MESSAGE_TYPE) {
    const frame = decodeInputFrame(bytes);
    return frame === null ? null : { kind: "input", frame };
  }
  if (bytes.byteLength !== 5 || bytes[0] !== SNAPSHOT_ACK_MESSAGE_TYPE) {
    return null;
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const seq = view.getUint32(1, true);
  return seq === 0 ? null : { kind: "ack", seq };
}

function validateFrame(frame: SnapshotFrame): void {
  if (
    !isUint32(frame.seq) ||
    !isUint32(frame.tick) ||
    frame.players.length !== MATCH_TOTAL_PLAYERS ||
    !isControlIndex(frame.controlledHome) ||
    !isControlIndex(frame.controlledAway)
  ) {
    throw new BinaryProtocolError(
      "Snapshot must have uint32 seq/tick, 22 players and valid controls",
    );
  }
  validateMatch(frame.match);
}

function validateMatch(match: SnapshotMatch): void {
  if (
    PHASE_CODES[match.phase] === undefined ||
    (match.half !== 1 && match.half !== 2) ||
    !Number.isFinite(match.clockSeconds) ||
    match.clockSeconds < 0 ||
    match.clockSeconds > 65_535 ||
    !Number.isInteger(match.scoreHome) ||
    !Number.isInteger(match.scoreAway) ||
    match.scoreHome < 0 ||
    match.scoreHome > 255 ||
    match.scoreAway < 0 ||
    match.scoreAway > 255
  ) {
    throw new BinaryProtocolError("Invalid snapshot match state");
  }
  const hasType = match.restartType !== null;
  const hasSide = match.restartSide !== null;
  if (
    hasType !== hasSide ||
    (match.restartType !== null &&
      RESTART_CODES[match.restartType] === undefined) ||
    (match.restartSide !== null &&
      match.restartSide !== "home" &&
      match.restartSide !== "away")
  ) {
    throw new BinaryProtocolError("Invalid snapshot restart state");
  }
  const event = match.lastEvent;
  if (event !== null) {
    if (
      !Number.isInteger(event.seq) ||
      event.seq < 1 ||
      event.seq > 65_535 ||
      EVENT_CODES[event.type] === undefined ||
      (event.side !== "home" && event.side !== "away") ||
      (event.playerNumber !== null &&
        (!Number.isInteger(event.playerNumber) ||
          event.playerNumber < 1 ||
          event.playerNumber > 99))
    ) {
      throw new BinaryProtocolError("Invalid snapshot event state");
    }
  }
}

function decodeMatch(bytes: Uint8Array): SnapshotMatch | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const phase = PHASES_BY_CODE[bytes[18]!];
  const half = bytes[19]!;
  const restartCode = bytes[20]!;
  const restartSideCode = bytes[21]!;
  const restartType = restartCode === 0 ? null : RESTARTS_BY_CODE[restartCode];
  const restartSide =
    restartSideCode === 0
      ? null
      : restartSideCode === 1
        ? "home"
        : restartSideCode === 2
          ? "away"
          : null;
  const eventSeq = view.getUint16(24, true);
  const eventCode = bytes[26]!;
  const eventSideCode = bytes[27]!;
  const eventType = eventCode === 0 ? null : EVENTS_BY_CODE[eventCode];
  const eventSide =
    eventSideCode === 1
      ? "home"
      : eventSideCode === 2
        ? "away"
        : null;
  const eventNumber = bytes[28]!;
  const hasEvent =
    eventSeq !== 0 ||
    eventCode !== 0 ||
    eventSideCode !== 0 ||
    eventNumber !== 0;
  if (
    phase === undefined ||
    (half !== 1 && half !== 2) ||
    (restartCode !== 0 && restartType === undefined) ||
    (restartSideCode !== 0 && restartSide === null) ||
    (restartType === null) !== (restartSide === null) ||
    (hasEvent &&
      (eventSeq === 0 ||
        eventType === undefined ||
        eventSide === null ||
        (eventNumber !== 0 && eventNumber > 99)))
  ) {
    return null;
  }
  return {
    phase,
    half,
    clockSeconds: view.getUint16(16, true),
    scoreHome: bytes[22]!,
    scoreAway: bytes[23]!,
    restartType: restartType ?? null,
    restartSide,
    lastEvent: hasEvent
      ? {
          seq: eventSeq,
          type: eventType!,
          side: eventSide!,
          playerNumber: eventNumber === 0 ? null : eventNumber,
        }
      : null,
  };
}

function encodeControlIndex(index: number): number {
  if (!isControlIndex(index)) {
    throw new BinaryProtocolError(`Invalid controlled player index ${index}`);
  }
  return index < 0 ? CONTROL_NONE : index;
}

function decodeControlIndex(value: number): number | null {
  if (value === CONTROL_NONE) {
    return -1;
  }
  return value < MATCH_TOTAL_PLAYERS ? value : null;
}

function isControlIndex(index: number): boolean {
  return Number.isInteger(index) && index >= -1 && index < MATCH_TOTAL_PLAYERS;
}

function quantizeBall(ball: SnapshotBall): QuantizedBall {
  return {
    x: quantizeSigned(ball.x, POSITION_SCALE),
    y: quantizeSigned(ball.y, POSITION_SCALE),
    z: quantizeUnsigned(ball.z, POSITION_SCALE),
    vx: quantizeSigned(ball.vx, VELOCITY_SCALE),
    vy: quantizeSigned(ball.vy, VELOCITY_SCALE),
    vz: quantizeSigned(ball.vz, VELOCITY_SCALE),
  };
}

function quantizePlayer(player: SnapshotPlayer): QuantizedPlayer {
  const state = playerStateCode(player.state);
  if (state < 0) {
    throw new BinaryProtocolError(`Unknown player state ${player.state}`);
  }
  return {
    x: quantizeSigned(player.x, POSITION_SCALE),
    y: quantizeSigned(player.y, POSITION_SCALE),
    vx: quantizeSigned(player.vx, VELOCITY_SCALE),
    vy: quantizeSigned(player.vy, VELOCITY_SCALE),
    facing: quantizeFacing(player.facing),
    state,
    stamina: Math.round(clamp01(player.stamina) * STAMINA_SCALE),
    sentOff: player.sentOff,
    yellowCards: Math.min(2, Math.max(0, Math.round(player.yellowCards))),
  };
}

function sameQuantizedPlayer(
  a: QuantizedPlayer,
  b: QuantizedPlayer,
): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.vx === b.vx &&
    a.vy === b.vy &&
    a.facing === b.facing &&
    a.state === b.state &&
    a.stamina === b.stamina &&
    a.sentOff === b.sentOff &&
    a.yellowCards === b.yellowCards
  );
}

function writeBall(
  view: DataView,
  offset: number,
  ball: QuantizedBall,
): void {
  view.setInt16(offset, ball.x, true);
  view.setInt16(offset + 2, ball.y, true);
  view.setUint16(offset + 4, ball.z, true);
  view.setInt16(offset + 6, ball.vx, true);
  view.setInt16(offset + 8, ball.vy, true);
  view.setInt16(offset + 10, ball.vz, true);
}

function readBall(view: DataView, offset: number): SnapshotBall {
  return {
    x: view.getInt16(offset, true) / POSITION_SCALE,
    y: view.getInt16(offset + 2, true) / POSITION_SCALE,
    z: view.getUint16(offset + 4, true) / POSITION_SCALE,
    vx: view.getInt16(offset + 6, true) / VELOCITY_SCALE,
    vy: view.getInt16(offset + 8, true) / VELOCITY_SCALE,
    vz: view.getInt16(offset + 10, true) / VELOCITY_SCALE,
  };
}

function writePlayer(
  view: DataView,
  offset: number,
  player: QuantizedPlayer,
): void {
  view.setInt16(offset, player.x, true);
  view.setInt16(offset + 2, player.y, true);
  view.setInt16(offset + 4, player.vx, true);
  view.setInt16(offset + 6, player.vy, true);
  view.setUint16(offset + 8, player.facing, true);
  view.setUint8(offset + 10, player.state);
  view.setUint8(offset + 11, player.stamina);
  view.setUint8(
    offset + 12,
    (player.sentOff ? 1 : 0) | ((player.yellowCards & 0x03) << 1),
  );
}

function readPlayer(view: DataView, offset: number): SnapshotPlayer {
  const stateCode = view.getUint8(offset + 10);
  if (stateCode >= PLAYER_STATE_CODES.length) {
    throw new BinaryProtocolError(`Unknown player state code ${stateCode}`);
  }
  const flags = view.getUint8(offset + 12);
  const yellowCards = (flags >> 1) & 0x03;
  if (yellowCards > 2 || (flags & ~0x07) !== 0) {
    throw new BinaryProtocolError("Invalid player discipline flags");
  }
  return {
    x: view.getInt16(offset, true) / POSITION_SCALE,
    y: view.getInt16(offset + 2, true) / POSITION_SCALE,
    vx: view.getInt16(offset + 4, true) / VELOCITY_SCALE,
    vy: view.getInt16(offset + 6, true) / VELOCITY_SCALE,
    facing: (view.getUint16(offset + 8, true) / FACING_SCALE) * TAU,
    state: playerStateName(stateCode),
    stamina: view.getUint8(offset + 11) / STAMINA_SCALE,
    sentOff: (flags & 1) !== 0,
    yellowCards,
  };
}

function quantizeSigned(value: number, scale: number): number {
  return Math.max(
    -32_768,
    Math.min(32_767, Math.round(value * scale)),
  );
}

function quantizeUnsigned(value: number, scale: number): number {
  return Math.max(0, Math.min(65_535, Math.round(value * scale)));
}

function quantizeFacing(facing: number): number {
  let angle = facing % TAU;
  if (angle < 0) {
    angle += TAU;
  }
  return Math.round((angle / TAU) * FACING_SCALE) & 0xffff;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
