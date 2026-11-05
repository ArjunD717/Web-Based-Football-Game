// packages/client/src/match/replay-gallery.ts
import type {
  WireReplayClip,
  WireReplayLibrary,
  WireReplayRoom,
} from "@fb/shared";

export interface ReplayGalleryItem {
  readonly id: string;
  readonly href: string;
  readonly download: string;
  readonly score: string;
  readonly meta: string;
  readonly title: string;
}

/** Newest clip first; URLs are scoped to the room's download route. */
export function buildReplayGalleryItems(
  roomCode: string,
  clips: readonly WireReplayClip[],
): ReplayGalleryItem[] {
  return [...clips].reverse().map((clip) => ({
    id: clip.id,
    href: `/api/replay/${roomCode}/${clip.id}.json`,
    download: `replay-${roomCode}-${clip.id}.json`,
    score: `${clip.scoreHome} – ${clip.scoreAway}`,
    meta:
      `${formatGoalMinute(clip.clockSeconds)} · ` +
      `${formatHalf(clip.half)} · ${clip.frameCount} frames`,
    title: `Download goal replay ${clip.id}`,
  }));
}

export function formatGoalMinute(clockSeconds: number): string {
  const minute = Math.max(
    1,
    Math.min(120, Math.round(clockSeconds / 60)),
  );
  return `${minute}'`;
}

export function formatHalf(half: WireReplayClip["half"]): string {
  return half === 1
    ? "1st half"
    : half === 2
      ? "2nd half"
      : "extra time";
}

/** Validates the HTTP library payload before it reaches the DOM. */
export function parseReplayLibrary(
  value: unknown,
): WireReplayLibrary | null {
  if (!isRecord(value) || !Array.isArray(value.rooms)) {
    return null;
  }
  const rooms: WireReplayRoom[] = [];
  for (const rawRoom of value.rooms) {
    if (!isRecord(rawRoom)) {
      return null;
    }
    const { code, updatedAtMs, clips } = rawRoom;
    if (
      typeof code !== "string" ||
      !/^[A-Z]{4}$/.test(code) ||
      typeof updatedAtMs !== "number" ||
      !Number.isFinite(updatedAtMs) ||
      !Array.isArray(clips)
    ) {
      return null;
    }
    const parsedClips: WireReplayClip[] = [];
    for (const rawClip of clips) {
      const clip = parseClip(rawClip);
      if (clip === null) {
        return null;
      }
      parsedClips.push(clip);
    }
    rooms.push({ code, updatedAtMs, clips: parsedClips });
  }
  return { rooms };
}

export function formatLibraryTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

function parseClip(value: unknown): WireReplayClip | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    kind,
    scoreHome,
    scoreAway,
    clockSeconds,
    half,
    createdAtMs,
    frameCount,
  } = value;
  if (
    typeof id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
    kind !== "goal" ||
    !isNonNegativeInteger(scoreHome) ||
    !isNonNegativeInteger(scoreAway) ||
    !isNonNegativeInteger(clockSeconds) ||
    !isHalf(half) ||
    typeof createdAtMs !== "number" ||
    !Number.isFinite(createdAtMs) ||
    !isNonNegativeInteger(frameCount)
  ) {
    return null;
  }
  return {
    id,
    kind: "goal",
    scoreHome,
    scoreAway,
    clockSeconds,
    half,
    createdAtMs,
    frameCount,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isHalf(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}
