// packages/client/src/render/player-geometry.ts

import type { PlayerDetail } from "./player-lod";

export type PlayerGeometry = "high" | "low";

/** Only minimal presentation uses the rebuilt low-poly match template. */
export function geometryForDetail(detail: PlayerDetail): PlayerGeometry {
  return detail === "minimal" ? "low" : "high";
}

export interface PlayerGeometryRequest {
  readonly desired: PlayerGeometry;
  readonly frames: number;
  readonly committed: PlayerGeometry;
}

export function nextGeometryRequest(
  previous: PlayerGeometryRequest | undefined,
  desired: PlayerGeometry,
  switchFrames: number,
): PlayerGeometryRequest {
  const threshold = Number.isFinite(switchFrames)
    ? Math.max(1, Math.floor(switchFrames))
    : 1;
  if (previous === undefined) {
    return {
      desired,
      frames: 1,
      committed: "high",
    };
  }
  if (previous.desired !== desired) {
    return {
      desired,
      frames: 1,
      committed: previous.committed,
    };
  }
  const frames = previous.frames + 1;
  return {
    desired,
    frames,
    committed:
      frames >= threshold && desired !== previous.committed
        ? desired
        : previous.committed,
  };
}

/** Linear dissolve progress; invalid durations resolve immediately. */
export function geometryFadeProgress(
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1;
  }
  if (!Number.isFinite(elapsedSeconds)) {
    return 0;
  }
  return Math.max(0, Math.min(1, elapsedSeconds / durationSeconds));
}

/** A dissolve is either drawing the outgoing or incoming surface at this pixel. */
export function dissolveCutoff(progress: number): number {
  const clamped = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  return 1 - clamped;
}

export function dissolveSourceVisible(
  ditherThreshold: number,
  progress: number,
): boolean {
  return ditherThreshold < dissolveCutoff(progress);
}

export function dissolveTargetVisible(
  ditherThreshold: number,
  progress: number,
): boolean {
  return ditherThreshold >= dissolveCutoff(progress);
}
