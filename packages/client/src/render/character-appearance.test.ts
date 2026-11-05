// packages/client/src/render/character-appearance.test.ts

import { describe, expect, it } from "vitest";
import { appearanceFor } from "./character-appearance";
import { VISUAL_TUNING } from "./visualTuning";

describe("authored player appearance", () => {
  it("is stable for the same identity", () => {
    expect(appearanceFor("home:player-07:7")).toEqual(
      appearanceFor("home:player-07:7"),
    );
  });

  it("only picks colours from the configured palettes", () => {
    const palette = VISUAL_TUNING.authoredPlayer.appearance;
    for (const seed of ["home:1", "home:2", "away:1", "away:2"]) {
      const appearance = appearanceFor(seed);
      expect(palette.skinTones).toContain(appearance.skin);
      expect(palette.bootColors).toContain(appearance.boots);
    }
  });

  it("changes at least one visible trait for different identities", () => {
    const first = appearanceFor("home:player-01:1");
    const second = appearanceFor("away:player-18:18");
    expect([
      first.skin !== second.skin,
      first.boots !== second.boots,
    ]).toContain(true);
  });
});
