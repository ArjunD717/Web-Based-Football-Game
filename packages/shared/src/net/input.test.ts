// packages/shared/src/net/input.test.ts
import { describe, expect, it } from "vitest";
import {
  CONTROL_BUTTONS,
  INPUT_MESSAGE_TYPE,
  decodeInputFrame,
  encodeInputFrame,
} from "./input";

describe("input frame codec", () => {
  it("round-trips axes, buttons and charge", () => {
    const encoded = encodeInputFrame({
      seq: 42,
      moveX: -0.5,
      moveY: 0.25,
      buttons:
        CONTROL_BUTTONS.SPRINT |
        CONTROL_BUTTONS.PASS |
        CONTROL_BUTTONS.FINESSE,
      chargePower: 0.6,
    });
    expect(encoded).toHaveLength(12);
    expect(encoded[0]).toBe(INPUT_MESSAGE_TYPE);
    const decoded = decodeInputFrame(encoded);
    expect(decoded?.seq).toBe(42);
    expect(decoded?.moveX).toBeCloseTo(-0.5, 3);
    expect(decoded?.moveY).toBeCloseTo(0.25, 3);
    expect(decoded?.buttons).toBe(
      CONTROL_BUTTONS.SPRINT |
        CONTROL_BUTTONS.PASS |
        CONTROL_BUTTONS.FINESSE,
    );
    expect(decoded?.chargePower).toBeCloseTo(0.6, 2);
  });

  it("clamps out-of-range axes and charge", () => {
    const decoded = decodeInputFrame(
      encodeInputFrame({
        seq: 1,
        moveX: 5,
        moveY: -5,
        buttons: 0,
        chargePower: 2,
      }),
    );
    expect(decoded?.moveX).toBe(1);
    expect(decoded?.moveY).toBe(-1);
    expect(decoded?.chargePower).toBe(1);
  });

  it("rejects malformed frames and invalid fields", () => {
    expect(decodeInputFrame(new Uint8Array([17, 0]))).toBeNull();
    expect(
      decodeInputFrame(new Uint8Array([99, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
    expect(() =>
      encodeInputFrame({
        seq: -1,
        moveX: 0,
        moveY: 0,
        buttons: 0,
        chargePower: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeInputFrame({
        seq: 1,
        moveX: 0,
        moveY: 0,
        buttons: 0x10000,
        chargePower: 0,
      }),
    ).toThrow(RangeError);
  });
});
