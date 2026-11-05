// packages/client/src/presentation/replay-chapters.ts
import type { SnapshotFrame } from "@fb/shared";

export type ReplayChapterKind = "goal" | "yellowCard" | "redCard" | "fullTime";

export interface ReplayChapter {
  readonly frameIndex: number;
  readonly timeMs: number;
  readonly progress: number;
  readonly kind: ReplayChapterKind;
  readonly label: string;
}

/** Index of the last chapter at or before `timeMs`; -1 before the first. */
export function chapterIndexAt(
  chapters: readonly ReplayChapter[],
  timeMs: number,
): number {
  let index = -1;
  for (let next = 0; next < chapters.length; next += 1) {
    const chapter = chapters[next];
    if (chapter !== undefined && chapter.timeMs <= timeMs + 1) {
      index = next;
    }
  }
  return index;
}

/**
 * Finds user-navigable moments in a saved clip. Cards persist in
 * `lastEvent`, so compare sequence numbers rather than event presence.
 */
export function buildReplayChapters(
  frames: readonly SnapshotFrame[],
  intervalMs: number,
): ReplayChapter[] {
  const first = frames[0];
  if (first === undefined || frames.length < 2) {
    return [];
  }
  const durationMs = (frames.length - 1) * intervalMs;
  const chapters: ReplayChapter[] = [];
  let scoreHome = first.match.scoreHome;
  let scoreAway = first.match.scoreAway;
  let lastEventSeq = first.match.lastEvent?.seq ?? null;
  let phase = first.match.phase;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) {
      continue;
    }
    const scored =
      frame.match.scoreHome > scoreHome ||
      frame.match.scoreAway > scoreAway;
    scoreHome = frame.match.scoreHome;
    scoreAway = frame.match.scoreAway;
    if (scored) {
      chapters.push(
        chapter(
          index,
          intervalMs,
          durationMs,
          "goal",
          `Goal ${frame.match.scoreHome}–${frame.match.scoreAway}`,
        ),
      );
    }

    const event = frame.match.lastEvent;
    if (event !== null && event.seq !== lastEventSeq) {
      lastEventSeq = event.seq;
      if (event.type === "yellowCard" || event.type === "redCard") {
        chapters.push(
          chapter(
            index,
            intervalMs,
            durationMs,
            event.type,
            `${event.type === "yellowCard" ? "Yellow" : "Red"} · ${
              event.side
            }${event.playerNumber === null ? "" : ` #${event.playerNumber}`}`,
          ),
        );
      }
    }

    if (frame.match.phase === "fullTime" && phase !== "fullTime") {
      chapters.push(
        chapter(index, intervalMs, durationMs, "fullTime", "Full time"),
      );
    }
    phase = frame.match.phase;
  }
  return chapters;
}

function chapter(
  frameIndex: number,
  intervalMs: number,
  durationMs: number,
  kind: ReplayChapterKind,
  label: string,
): ReplayChapter {
  return {
    frameIndex,
    timeMs: frameIndex * intervalMs,
    progress:
      durationMs <= 0 ? 0 : Math.min(1, (frameIndex * intervalMs) / durationMs),
    kind,
    label,
  };
}
