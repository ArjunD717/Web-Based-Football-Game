// packages/client/src/render/player-lod.ts

export type PlayerDetail = "full" | "reduced" | "minimal";

export interface PlayerLodTuning {
  /** Reference standing height used to estimate projected size. */
  readonly referenceHeightM: number;
  /** Full overlays above this vertical projected height. */
  readonly fullDetailScreenPx: number;
  /** Reduced overlays above this vertical projected height. */
  readonly reducedDetailScreenPx: number;
  /** Players shorter than this do not cast real shadows. */
  readonly shadowMinScreenPx: number;
  /** Only players inside this camera distance may cast a real shadow. */
  readonly shadowDistanceM: number;
  /** Hard budget for simultaneous skinned shadow casters. */
  readonly maxShadowCasters: number;
}

export interface PlayerLodEntry {
  readonly id: string;
  readonly distanceM: number;
  /** Estimated vertical screen size; zero means off-screen or behind camera. */
  readonly screenHeightPx: number;
}

/**
 * Pinhole-camera estimate of how many vertical pixels a player of
 * `referenceHeightM` covers. The renderer supplies zero for players behind the
 * camera; this function only validates the projection inputs.
 */
export function projectedHeightPx(
  referenceHeightM: number,
  distanceM: number,
  viewportHeightPx: number,
  verticalFovRadians: number,
): number {
  if (
    !Number.isFinite(referenceHeightM) ||
    !Number.isFinite(distanceM) ||
    !Number.isFinite(viewportHeightPx) ||
    !Number.isFinite(verticalFovRadians) ||
    referenceHeightM <= 0 ||
    distanceM <= 0 ||
    viewportHeightPx <= 0 ||
    verticalFovRadians <= 0 ||
    verticalFovRadians >= Math.PI
  ) {
    return 0;
  }
  const visibleHeightM =
    2 * distanceM * Math.tan(verticalFovRadians / 2);
  if (visibleHeightM <= 0) {
    return 0;
  }
  return (referenceHeightM * viewportHeightPx) / visibleHeightM;
}

/** Screen-space detail is stable across field-of-view and aspect changes. */
export function playerDetailForScreenHeight(
  screenHeightPx: number,
  tuning: PlayerLodTuning,
): PlayerDetail {
  if (!Number.isFinite(screenHeightPx) || screenHeightPx <= 0) {
    return "minimal";
  }
  if (screenHeightPx >= tuning.fullDetailScreenPx) {
    return "full";
  }
  if (screenHeightPx >= tuning.reducedDetailScreenPx) {
    return "reduced";
  }
  return "minimal";
}

/**
 * Real skinned shadows are expensive. Return the nearest players inside the
 * distance and screen-size budgets, capped by the fixed caster count.
 */
export function shadowCasterIds(
  entries: readonly PlayerLodEntry[],
  tuning: PlayerLodTuning,
): ReadonlySet<string> {
  const eligible = entries
    .filter(
      (entry) =>
        Number.isFinite(entry.distanceM) &&
        Number.isFinite(entry.screenHeightPx) &&
        entry.distanceM <= tuning.shadowDistanceM &&
        entry.screenHeightPx >= tuning.shadowMinScreenPx,
    )
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(0, Math.floor(tuning.maxShadowCasters)));
  return new Set(eligible.map((entry) => entry.id));
}
