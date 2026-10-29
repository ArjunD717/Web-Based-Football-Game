// packages/sim/src/rules/offside.test.ts
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  isOffsidePosition,
  offsidePlayersAtKick,
  secondLastDefenderLine,
} from "./offside";

const pitch = createMatch({ seed: 1 }).pitch;

describe("offside geometry", () => {
  it("uses the second-last defender toward the attacking goal", () => {
    const defenders = [
      { id: "gk", x: 2, y: pitch.centreY },
      { id: "cb1", x: 22, y: pitch.centreY },
      { id: "cb2", x: 28, y: pitch.centreY },
    ];
    expect(secondLastDefenderLine(pitch, defenders, 1)).toBe(22);
    expect(secondLastDefenderLine(pitch, defenders, -1)).toBe(22);
  });

  it("uses the goal line when fewer than two defenders are active", () => {
    expect(
      secondLastDefenderLine(
        pitch,
        [{ id: "gk", x: 2, y: pitch.centreY, sentOff: false }],
        1,
      ),
    ).toBe(pitch.lengthM);
    expect(
      secondLastDefenderLine(
        pitch,
        [{ id: "gk", x: 100, y: pitch.centreY, sentOff: true }],
        -1,
      ),
    ).toBe(0);
  });

  it("requires opponent half, ahead of the ball and beyond the line", () => {
    const player = (x: number) => ({
      id: "st",
      y: pitch.centreY,
      x,
      sentOff: false,
    });
    expect(isOffsidePosition(pitch, player(70), 60, 1, 50)).toBe(true);
    expect(isOffsidePosition(pitch, player(40), 30, 1, 20)).toBe(false);
    expect(isOffsidePosition(pitch, player(50), 40, 1, 50)).toBe(false);
    expect(isOffsidePosition(pitch, player(55), 60, 1, 50)).toBe(false);
  });

  it("treats a player level with the second-last defender as onside", () => {
    expect(
      isOffsidePosition(
        pitch,
        { id: "st", x: 50, y: pitch.centreY },
        40,
        1,
        50,
      ),
    ).toBe(false);
  });

  it("never flags the kicker or a sent-off attacker", () => {
    const flagged = offsidePlayersAtKick(
      pitch,
      [
        { id: "st", x: 70, y: pitch.centreY },
        { id: "kicker", x: 60, y: pitch.centreY },
        { id: "red", x: 75, y: pitch.centreY, sentOff: true },
      ],
      [{ id: "gk", x: 5, y: pitch.centreY }, { id: "cb", x: 45, y: pitch.centreY }],
      "kicker",
      60,
      1,
    );
    expect(flagged).toEqual(["st"]);
  });

  it("mirrors the law when the team attacks toward x = 0", () => {
    const defenders = [
      { id: "gk", x: 103, y: pitch.centreY },
      { id: "cb1", x: 80, y: pitch.centreY },
      { id: "cb2", x: 72, y: pitch.centreY },
    ];
    expect(secondLastDefenderLine(pitch, defenders, -1)).toBe(80);
    expect(
      isOffsidePosition(
        pitch,
        { id: "st", x: 20, y: pitch.centreY },
        30,
        -1,
        25,
      ),
    ).toBe(true);
    expect(
      isOffsidePosition(
        pitch,
        { id: "st", x: 35, y: pitch.centreY },
        30,
        -1,
        25,
      ),
    ).toBe(false);
  });
});
