// packages/server/src/replays/replay-store.test.ts
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MatchSetupWire, SnapshotFrame } from "@fb/shared";
import type { Logger } from "../create-server";
import { ReplayStore, type StoredReplayClip } from "./replay-store";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fb-replays-"));
  directories.push(dir);
  return dir;
}

function clip(id: string, scoreHome = 1): StoredReplayClip {
  return {
    id,
    kind: "goal",
    scoreHome,
    scoreAway: 0,
    clockSeconds: 51.5,
    half: 1,
    createdAtMs: 5_000,
    setup: { matchId: "match-1" } as unknown as MatchSetupWire,
    frames: [] as SnapshotFrame[],
  };
}

describe("replay store", () => {
  it("persists clip files and reloads the room index", async () => {
    const dir = await temporaryDir();
    const store = new ReplayStore({ dir, logger: silentLogger });
    await store.initialize();
    store.saveClip("abcd", clip("g1"));
    await store.flush();

    expect(store.listRooms()).toEqual([
      {
        code: "ABCD",
        updatedAtMs: expect.any(Number),
        clips: [
          {
            id: "g1",
            kind: "goal",
            scoreHome: 1,
            scoreAway: 0,
            clockSeconds: 51.5,
            half: 1,
            createdAtMs: 5_000,
            frameCount: 0,
          },
        ],
      },
    ]);
    expect(existsSync(path.join(dir, "ABCD", "g1.json"))).toBe(true);

    const reopened = new ReplayStore({ dir, logger: silentLogger });
    await reopened.initialize();
    expect(reopened.listRooms()[0]?.code).toBe("ABCD");
    expect(reopened.getClip("ABCD", "g1")).toMatchObject({
      id: "g1",
      scoreHome: 1,
      clockSeconds: 51.5,
      half: 1,
    });
    expect(reopened.getClip("ABCD", "missing")).toBeNull();
  });

  it("rejects unsafe identifiers without writing", async () => {
    const dir = await temporaryDir();
    const store = new ReplayStore({ dir, logger: silentLogger });
    await store.initialize();
    store.saveClip("../ABCD", clip("g1"));
    store.saveClip("ABCD", clip("../g1"));
    await store.flush();

    expect(store.listRooms()).toEqual([]);
    expect(existsSync(path.join(dir, "ABCD"))).toBe(false);
  });

  it("evicts the least recently updated room at the limit", async () => {
    const dir = await temporaryDir();
    const store = new ReplayStore({
      dir,
      logger: silentLogger,
      roomLimit: 1,
    });
    await store.initialize();
    store.saveClip("ABCD", clip("g1"));
    await store.flush();
    store.saveClip("EFGH", clip("g2"));
    await store.flush();

    expect(store.listRooms().map((room) => room.code)).toEqual(["EFGH"]);
    expect(existsSync(path.join(dir, "ABCD"))).toBe(false);
  });
});
