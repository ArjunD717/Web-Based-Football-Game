// packages/server/src/replays/replay-store.ts
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  TUNING,
  type MatchSetupWire,
  type SnapshotFrame,
  type WireReplayClip,
  type WireReplayRoom,
} from "@fb/shared";
import type { Logger } from "../create-server";

const INDEX_VERSION = 1;
const ROOM_CODE = /^[A-Z]{4}$/;
const CLIP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface StoredReplayClip {
  readonly id: string;
  readonly kind: "goal";
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly clockSeconds: number;
  readonly half: 1 | 2 | 3 | 4;
  readonly createdAtMs: number;
  readonly setup: MatchSetupWire;
  readonly frames: readonly SnapshotFrame[];
}

interface IndexedRoom {
  updatedAtMs: number;
  clips: WireReplayClip[];
}

interface IndexFile {
  version: typeof INDEX_VERSION;
  rooms: Record<string, IndexedRoom>;
}

interface ReplayStoreOptions {
  readonly dir: string;
  readonly logger: Logger;
  /** Test seam; defaults to the tuning limit. */
  readonly roomLimit?: number;
}

/**
 * Disk-backed goal-clip library. Metadata is kept in memory for the HTTP
 * library index; frames are only loaded when a clip is downloaded.
 */
export class ReplayStore {
  private readonly indexPath: string;
  private readonly roomLimit: number;
  private readonly rooms = new Map<string, IndexedRoom>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ReplayStoreOptions) {
    this.indexPath = path.join(options.dir, "index.json");
    this.roomLimit =
      options.roomLimit ?? TUNING.network.replayLibraryRoomLimit;
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    let text: string;
    try {
      text = readFileSync(this.indexPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return;
      }
      throw error;
    }

    try {
      const parsed = parseIndex(text);
      if (parsed === null) {
        throw new Error("invalid replay index shape");
      }
      for (const [code, room] of Object.entries(parsed.rooms)) {
        this.rooms.set(code, room);
      }
    } catch (error) {
      const backup = `${this.indexPath}.corrupt-${Date.now()}`;
      this.options.logger.warn(
        `Replay index is invalid; moved to ${backup}`,
        error,
      );
      await rename(this.indexPath, backup).catch(() => undefined);
    }
  }

  /** Updates memory immediately and queues an atomic disk write. */
  saveClip(code: string, clip: StoredReplayClip): void {
    const normalized = code.toUpperCase();
    if (!ROOM_CODE.test(normalized) || !CLIP_ID.test(clip.id)) {
      this.options.logger.warn(
        `Refusing to persist replay ${code}/${clip.id}: invalid identifier`,
      );
      return;
    }

    const room = this.rooms.get(normalized) ?? {
      updatedAtMs: Date.now(),
      clips: [],
    };
    const meta: WireReplayClip = {
      id: clip.id,
      kind: "goal",
      scoreHome: clip.scoreHome,
      scoreAway: clip.scoreAway,
      clockSeconds: clip.clockSeconds,
      half: clip.half,
      createdAtMs: clip.createdAtMs,
      frameCount: clip.frames.length,
    };
    room.updatedAtMs = Date.now();
    room.clips = [
      ...room.clips.filter((item) => item.id !== meta.id),
      meta,
    ].slice(-TUNING.network.goalReplayClipLimit);
    this.rooms.set(normalized, room);
    const removed = this.pruneRooms(normalized);

    this.enqueue(async () => {
      const roomDir = path.join(this.options.dir, normalized);
      await mkdir(roomDir, { recursive: true });
      await writeJsonAtomic(
        path.join(roomDir, `${clip.id}.json`),
        {
          code: normalized,
          generatedAtMs: clip.createdAtMs,
          setup: clip.setup,
          frames: clip.frames,
          ...meta,
        },
      );
      await writeJsonAtomic(this.indexPath, this.serializeIndex());
      for (const code of removed) {
        await rm(path.join(this.options.dir, code), {
          recursive: true,
          force: true,
        });
      }
    });
  }

  getClip(code: string, clipId: string): StoredReplayClip | null {
    const normalized = code.toUpperCase();
    if (!ROOM_CODE.test(normalized) || !CLIP_ID.test(clipId)) {
      return null;
    }
    const meta = this.rooms
      .get(normalized)
      ?.clips.find((clip) => clip.id === clipId);
    if (meta === undefined) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(
          path.join(this.options.dir, normalized, `${clipId}.json`),
          "utf8",
        ),
      );
      if (
        !isRecord(parsed) ||
        parsed.code !== normalized ||
        parsed.id !== clipId ||
        parsed.kind !== "goal" ||
        !isRecord(parsed.setup) ||
        !Array.isArray(parsed.frames)
      ) {
        return null;
      }
      // The file was written by this store after validating the clip shape.
      const setup = parsed.setup as unknown as MatchSetupWire;
      const frames = parsed.frames as unknown as SnapshotFrame[];
      return {
        id: meta.id,
        kind: "goal",
        scoreHome: meta.scoreHome,
        scoreAway: meta.scoreAway,
        clockSeconds: meta.clockSeconds,
        half: meta.half,
        createdAtMs: meta.createdAtMs,
        setup,
        frames,
      };
    } catch (error) {
      this.options.logger.warn(
        `Failed to read saved replay ${normalized}/${clipId}`,
        error,
      );
      return null;
    }
  }

  /** HTTP library index, most recently updated room first. */
  listRooms(): WireReplayRoom[] {
    return [...this.rooms.entries()]
      .map(([code, room]) => ({
        code,
        updatedAtMs: room.updatedAtMs,
        clips: [...room.clips],
      }))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  /** Test and shutdown barrier for queued writes. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  private pruneRooms(protectedCode: string): string[] {
    if (this.rooms.size <= this.roomLimit) {
      return [];
    }
    const candidates = [...this.rooms.entries()]
      .filter(([code]) => code !== protectedCode)
      .sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
    const removed: string[] = [];
    while (
      this.rooms.size > this.roomLimit &&
      candidates.length > 0
    ) {
      const entry = candidates.shift();
      if (entry === undefined) {
        break;
      }
      this.rooms.delete(entry[0]);
      removed.push(entry[0]);
    }
    return removed;
  }

  private enqueue(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(task)
      .catch((error: unknown) => {
        this.options.logger.error(
          "Failed to persist replay library",
          error,
        );
      });
  }

  private serializeIndex(): IndexFile {
    return {
      version: INDEX_VERSION,
      rooms: Object.fromEntries(this.rooms),
    };
  }
}

function parseIndex(text: string): IndexFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== INDEX_VERSION ||
    !isRecord(parsed.rooms)
  ) {
    return null;
  }

  const rooms: Record<string, IndexedRoom> = {};
  for (const [code, rawRoom] of Object.entries(parsed.rooms)) {
    if (!ROOM_CODE.test(code) || !isRecord(rawRoom)) {
      continue;
    }
    const { updatedAtMs, clips: rawClips } = rawRoom;
    if (
      typeof updatedAtMs !== "number" ||
      !Number.isFinite(updatedAtMs) ||
      !Array.isArray(rawClips)
    ) {
      continue;
    }
    const clips: WireReplayClip[] = [];
    for (const clip of rawClips) {
      const meta = parseClipMeta(clip);
      if (meta !== null) {
        clips.push(meta);
      }
    }
    rooms[code] = { updatedAtMs, clips };
  }
  return { version: INDEX_VERSION, rooms };
}

function parseClipMeta(value: unknown): WireReplayClip | null {
  if (!isRecord(value)) {
    return null;
  }
  const clip = value;
  if (
    typeof clip.id !== "string" ||
    !CLIP_ID.test(clip.id) ||
    clip.kind !== "goal" ||
    !isNonNegativeInteger(clip.scoreHome) ||
    !isNonNegativeInteger(clip.scoreAway) ||
    !isNonNegativeInteger(clip.clockSeconds) ||
    !isHalf(clip.half) ||
    typeof clip.createdAtMs !== "number" ||
    !Number.isFinite(clip.createdAtMs) ||
    !isNonNegativeInteger(clip.frameCount)
  ) {
    return null;
  }
  return {
    id: clip.id,
    kind: "goal",
    scoreHome: clip.scoreHome,
    scoreAway: clip.scoreAway,
    clockSeconds: clip.clockSeconds,
    half: clip.half,
    createdAtMs: clip.createdAtMs,
    frameCount: clip.frameCount,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isHalf(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, filePath);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
