// packages/server/src/rooms/match-stream.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_SETTINGS } from "@fb/shared";
import { rulesFromSettings } from "./match-stream";

describe("lobby match rules", () => {
  it("maps every host-owned setting onto the simulation rules", () => {
    expect(
      rulesFromSettings({
        halfRealMinutes: 8,
        extraTime: true,
        shootout: true,
        varEnabled: true,
        refereeStrictness: "strict",
        aiDifficulty: "legendary",
      }),
    ).toEqual({
      realHalfSeconds: 480,
      extraTimeEnabled: true,
      shootoutEnabled: true,
      varEnabled: true,
      strictness: "strict",
      aiDifficulty: "legendary",
    });
  });

  it("uses standard discipline and professional AI by default", () => {
    expect(rulesFromSettings(DEFAULT_MATCH_SETTINGS)).toMatchObject({
      realHalfSeconds: 360,
      strictness: "standard",
      aiDifficulty: "professional",
    });
  });
});
