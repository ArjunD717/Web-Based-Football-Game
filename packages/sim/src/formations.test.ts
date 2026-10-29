// packages/sim/src/formations.test.ts
import { describe, expect, it } from "vitest";
import {
  FORMATION_433,
  baseFormationPosition,
  shapeAnchor,
  validateFormation,
} from "./formations";
import { createPitch } from "./pitch";
import { createPlaceholderTeam } from "./placeholder";
import { mixSeeds, decisionRng } from "./random";

const pitch = createPitch();

describe("formation geometry", () => {
  it("mirrors home and away base positions", () => {
    const slot = FORMATION_433.slots[9]!;
    const home = baseFormationPosition(pitch, "home", slot);
    const away = baseFormationPosition(pitch, "away", slot);
    expect(home.x).toBeCloseTo(slot.x * pitch.lengthM, 10);
    expect(away.x).toBeCloseTo((1 - slot.x) * pitch.lengthM, 10);
    expect(home.y).toBeCloseTo(away.y, 10);
  });

  it("shifts outfield anchors toward the ball", () => {
    const slot = FORMATION_433.slots[1]!;
    const base = shapeAnchor(
      pitch,
      "home",
      slot,
      pitch.centreX,
      pitch.centreY,
    );
    const shifted = shapeAnchor(pitch, "home", slot, 90, 60);
    expect(shifted.x).toBeGreaterThan(base.x);
    expect(shifted.y).toBeGreaterThan(base.y);
  });

  it("leaves the goalkeeper on the goal line", () => {
    const gk = FORMATION_433.slots[0]!;
    expect(shapeAnchor(pitch, "home", gk, 100, 60)).toEqual(
      baseFormationPosition(pitch, "home", gk),
    );
  });

  it("clamps anchors inside the pitch margin", () => {
    const slot = FORMATION_433.slots[4]!;
    const low = shapeAnchor(pitch, "home", slot, -1000, -1000);
    const high = shapeAnchor(pitch, "away", slot, 1000, 1000);
    expect(low.x).toBeGreaterThanOrEqual(0);
    expect(low.y).toBeGreaterThanOrEqual(0);
    expect(high.x).toBeLessThanOrEqual(pitch.lengthM);
    expect(high.y).toBeLessThanOrEqual(pitch.widthM);
  });
});

describe("formation validation", () => {
  it("accepts the placeholder 4-3-3", () => {
    expect(() => validateFormation(FORMATION_433)).not.toThrow();
    expect(FORMATION_433.slots).toHaveLength(11);
    expect(
      FORMATION_433.slots.filter((slot) => slot.role === "GK"),
    ).toHaveLength(1);
  });

  it("rejects bad slot counts, keepers and coordinates", () => {
    expect(() =>
      validateFormation({
        name: "ten",
        slots: FORMATION_433.slots.slice(0, 10),
      }),
    ).toThrow(RangeError);

    expect(() =>
      validateFormation({
        name: "no keeper",
        slots: FORMATION_433.slots.map((slot) => ({
          ...slot,
          role: "CM" as const,
        })),
      }),
    ).toThrow(RangeError);

    expect(() =>
      validateFormation({
        name: "out of range",
        slots: FORMATION_433.slots.map((slot, index) =>
          index === 0 ? { ...slot, x: 1.2 } : slot,
        ),
      }),
    ).toThrow(RangeError);
  });
});

describe("placeholder teams", () => {
  it("creates eleven unique players with one keeper", () => {
    const home = createPlaceholderTeam("home", 99, pitch);
    expect(home.players).toHaveLength(11);
    expect(new Set(home.players.map((player) => player.id)).size).toBe(11);
    expect(
      home.players.filter((player) => player.role === "GK"),
    ).toHaveLength(1);
    expect(home.attackDirection).toBe(1);

    for (const player of home.players) {
      expect(player.stamina).toBe(1);
      for (const [key, rating] of Object.entries(player.attributes)) {
        if (key === "goalkeeper") {
          if (player.role === "GK") {
            expect(rating).not.toBeNull();
          } else {
            expect(rating).toBeNull();
          }
          continue;
        }
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(1);
        expect(rating).toBeLessThanOrEqual(99);
      }
    }
  });

  it("is deterministic for the same seed and side", () => {
    const a = createPlaceholderTeam("home", 7, pitch);
    const b = createPlaceholderTeam("home", 7, pitch);
    expect(a.players.map((player) => player.attributes)).toEqual(
      b.players.map((player) => player.attributes),
    );
    expect(a.players.map((player) => player.x)).toEqual(
      b.players.map((player) => player.x),
    );
  });

  it("accepts name, colours and formation overrides", () => {
    const team = createPlaceholderTeam("away", 7, pitch, {
      name: "Test Away",
      colors: {
        primary: "#123456",
        secondary: "#abcdef",
        keeper: "#fedcba",
      },
    });
    expect(team.name).toBe("Test Away");
    expect(team.colors.primary).toBe("#123456");
    expect(team.attackDirection).toBe(-1);
  });
});

describe("seeded decisions", () => {
  it("mixes deterministically and varies by context", () => {
    expect(mixSeeds(1, 2, 3)).toBe(mixSeeds(1, 2, 3));
    expect(mixSeeds(1, 2, 3)).not.toBe(mixSeeds(1, 2, 4));

    const a = decisionRng(42, 10, "home", 9);
    const b = decisionRng(42, 10, "home", 9);
    const c = decisionRng(42, 11, "home", 9);
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });
});
