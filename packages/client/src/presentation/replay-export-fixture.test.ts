// packages/client/src/presentation/replay-export-fixture.test.ts

import { describe, expect, it } from "vitest";
import { parseReplayExport } from "../match/replay-gallery";
import { WireViewBuilder } from "../match/view-from-wire";
import { buildReplayExportFixture } from "./replay-export-fixture";

describe("exported replay fixture", () => {
  it("passes the downloaded-replay parser and builds every frame", () => {
    const exported = buildReplayExportFixture();
    const parsed = parseReplayExport(exported);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(parsed.code).toBe("ABCD");
    expect(parsed.frames).toHaveLength(21);

    const builder = new WireViewBuilder(parsed.setup, null);
    const views = parsed.frames.map((frame) => builder.build(frame));
    expect(views.every((view) => view !== null)).toBe(true);
    expect(views[0]?.matchId).toBe("fixture-export");
    expect(views[20]?.tick).toBe(20);
    expect(views[20]?.home.players).toHaveLength(11);
    expect(views[20]?.away.players).toHaveLength(11);
  });
});
