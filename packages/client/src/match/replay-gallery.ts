// packages/client/src/match/replay-gallery.ts
import type { WireReplayClip } from "@fb/shared";

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
