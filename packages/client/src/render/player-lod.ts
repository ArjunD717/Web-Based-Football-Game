// packages/client/src/render/player-lod.ts

export type PlayerDetail = "full" | "reduced" | "minimal";

export interface PlayerLodTuning {
  /** Full shirt numbers and markers inside this camera distance. */
  readonly fullDetailDistanceM: number;
  /** Minimal overlays beyond this camera distance. */
  readonly reducedDetailDistanceM: number;
  /** Only players inside this distance may cast a real shadow. */
  readonly shadowDistanceM: number;
  /** Hard budget for simultaneous skinned shadow casters. */
  readonly maxShadowCasters: number;
}

export interface PlayerDistanceEntry {
  readonly id: string;
  readonly distanceM: number;
}

/** Higher camera distances drop non-essential overlays first. */
export function playerDetailFor(
  distanceM: number,
  tuning: PlayerLodTuning,
): PlayerDetail {
  if (!Number.isFinite(distanceM)) {
    return "minimal";
  }
  if (distanceM <= tuning.fullDetailDistanceM) {
    return "full";
  }
  if (distanceM <= tuning.reducedDetailDistanceM) {
    return "reduced";
  }
  return "minimal";
}

/**
 * Real skinned shadows are expensive. Return the nearest players inside the
 * shadow distance, capped by the fixed budget.
 */
export function shadowCasterIds(
  entries: readonly PlayerDistanceEntry[],
  tuning: PlayerLodTuning,
): ReadonlySet<string> {
  const eligible = entries
    .filter(
      (entry) =>
        Number.isFinite(entry.distanceM) &&
        entry.distanceM <= tuning.shadowDistanceM,
    )
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(0, Math.floor(tuning.maxShadowCasters)));
  return new Set(eligible.map((entry) => entry.id));
}
