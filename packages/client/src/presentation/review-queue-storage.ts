// packages/client/src/presentation/review-queue-storage.ts
import type { WireReplayClip } from "@fb/shared";

export interface StoredReviewClip {
  readonly roomCode: string;
  readonly clip: WireReplayClip;
}

export const REVIEW_QUEUE_STORAGE_KEY = "fb.reviewQueue.v1";

/** Bounds localStorage growth if a user keeps adding clips across sessions. */
const MAX_QUEUE_ITEMS = 50;

export function parseReviewQueue(
  raw: string | null,
): StoredReviewClip[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const items: StoredReviewClip[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const entry = parseEntry(item);
    if (entry === null) {
      continue;
    }
    const key = `${entry.roomCode}/${entry.clip.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(entry);
  }
  return items.slice(0, MAX_QUEUE_ITEMS);
}

export function serializeReviewQueue(
  items: readonly StoredReviewClip[],
): string {
  return JSON.stringify(items.slice(0, MAX_QUEUE_ITEMS));
}

export function loadReviewQueue(
  storage: Pick<Storage, "getItem">,
): StoredReviewClip[] {
  try {
    return parseReviewQueue(storage.getItem(REVIEW_QUEUE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveReviewQueue(
  storage: Pick<Storage, "setItem">,
  items: readonly StoredReviewClip[],
): void {
  try {
    storage.setItem(
      REVIEW_QUEUE_STORAGE_KEY,
      serializeReviewQueue(items),
    );
  } catch {
    // Storage can be unavailable or full; queueing remains session-only.
  }
}

function parseEntry(value: unknown): StoredReviewClip | null {
  if (!isRecord(value) || typeof value.roomCode !== "string") {
    return null;
  }
  const roomCode = value.roomCode.toUpperCase();
  if (!/^[A-Z]{4}$/.test(roomCode)) {
    return null;
  }
  const clip = parseClip(value.clip);
  return clip === null ? null : { roomCode, clip };
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
    !isNonNegativeNumber(clockSeconds) ||
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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isHalf(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
