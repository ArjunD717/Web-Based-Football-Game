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
