// packages/shared/src/net/input.ts

export const INPUT_MESSAGE_TYPE = 17;

/** Bit indices for the controls sent in an input frame. */
export const CONTROL_BUTTONS = {
  SPRINT: 1 << 0,
  PASS: 1 << 1,
  THROUGH: 1 << 2,
  LOB: 1 << 3,
  SHOOT: 1 << 4,
  TACKLE: 1 << 5,
  SWITCH: 1 << 6,
  FINESSE: 1 << 7,
} as const;

export interface InputFrame {
  readonly seq: number;
  /** Right/left stick, normalized to [-1, 1]. */
  readonly moveX: number;
  /** Down/up stick, normalized to [-1, 1]. */
  readonly moveY: number;
  /** Bitmask of CONTROL_BUTTONS. */
  readonly buttons: number;
  /** Local charge display for shot/cross, 0..1. */
  readonly chargePower: number;
}

const INPUT_FRAME_BYTES = 12;
const AXIS_SCALE = 32_767;

export function encodeInputFrame(frame: InputFrame): Uint8Array {
  if (
    !Number.isInteger(frame.seq) ||
    frame.seq < 0 ||
    frame.seq > 0xffffffff
  ) {
    throw new RangeError(`input seq must be a uint32, received ${frame.seq}`);
  }
  if (
    !Number.isInteger(frame.buttons) ||
    frame.buttons < 0 ||
    frame.buttons > 0xffff
  ) {
    throw new RangeError(`buttons must be a uint16 bitmask`);
  }

  const bytes = new Uint8Array(INPUT_FRAME_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = INPUT_MESSAGE_TYPE;
  view.setUint32(1, frame.seq, true);
  view.setUint16(5, frame.buttons, true);
  view.setInt16(7, quantizeAxis(frame.moveX), true);
  view.setInt16(9, quantizeAxis(frame.moveY), true);
  view.setUint8(11, Math.round(clamp01(frame.chargePower) * 255));
  return bytes;
}

export function decodeInputFrame(bytes: Uint8Array): InputFrame | null {
  if (
    bytes.byteLength !== INPUT_FRAME_BYTES ||
    bytes[0] !== INPUT_MESSAGE_TYPE
  ) {
    return null;
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  return {
    seq: view.getUint32(1, true),
    buttons: view.getUint16(5, true),
    moveX: view.getInt16(7, true) / AXIS_SCALE,
    moveY: view.getInt16(9, true) / AXIS_SCALE,
    chargePower: view.getUint8(11) / 255,
  };
}

function quantizeAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-AXIS_SCALE, Math.min(AXIS_SCALE, Math.round(value * AXIS_SCALE)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
