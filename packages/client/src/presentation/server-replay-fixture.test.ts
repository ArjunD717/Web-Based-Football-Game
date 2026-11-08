// packages/client/src/presentation/server-replay-fixture.test.ts

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplayExport } from "../match/replay-gallery";
import { WireViewBuilder } from "../match/view-from-wire";

const fixtureUrl = new URL(
  "../../public/fixtures/server-goal-replay.json",
  import.meta.url,
);

describe("server-captured replay fixture", () => {
  it("round-trips real room frames through the client replay path", () => {
    const value: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    const parsed = parseReplayExport(value);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(parsed.code).toBe("ABCD");
    expect(parsed.id).toBe("g2");
    expect(parsed.setup.snapshotHz).toBe(30);
    expect(parsed.frames.length).toBeGreaterThan(90);

    const builder = new WireViewBuilder(parsed.setup, null);
    const views = parsed.frames.flatMap((frame) => {
      const view = builder.build(frame);
      return view === null ? [] : [view];
    });
    expect(views).toHaveLength(parsed.frames.length);
    for (let index = 0; index < parsed.frames.length; index += 1) {
      const frame = parsed.frames[index];
      if (frame === undefined) {
        continue;
      }
      expect(frame.players).toHaveLength(22);
      expect(views[index]?.home.players).toHaveLength(11);
      expect(views[index]?.away.players).toHaveLength(11);
      if (index > 0) {
        expect(frame.tick).toBeGreaterThan(
          parsed.frames[index - 1]?.tick ?? -1,
        );
        expect(frame.match.clockSeconds).toBeGreaterThanOrEqual(
          parsed.frames[index - 1]?.match.clockSeconds ?? 0,
        );
      }
    }
  });
});
