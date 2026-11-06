// packages/client/src/render/player-lod.ts

export type PlayerDetail = "full" | "reduced" | "minimal";

export interface PlayerAnimationLodTuning {
  /** Update every frame while at full detail. */
  readonly fullStride: number;
  /** Update every second frame at reduced detail. */
  readonly reducedStride: number;
  /** Update every fourth frame at minimal detail. */
  readonly minimalStride: number;
  /** Slowest cadence while the player is outside the camera frustum. */
  readonly hiddenStride: number;
}

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
  /** NDC margin used before culling overlays, shadows and animation. */
  readonly screenMarginNdc: number;
  readonly animation: PlayerAnimationLodTuning;
}

export interface PlayerLodEntry {
  readonly id: string;
  readonly distanceM: number;
  /** Estimated vertical screen size; zero means off-screen or behind camera. */
  readonly screenHeightPx: number;
  /** False for roots outside the camera's NDC box and margin. */
  readonly onScreen: boolean;
}

/** NDC visibility with a margin so players do not pop at the screen edge. */
export function isNdcPointOnScreen(
  xNdc: number,
  yNdc: number,
  zNdc: number,
  margin: number,
): boolean {
  if (
    !Number.isFinite(xNdc) ||
    !Number.isFinite(yNdc) ||
    !Number.isFinite(zNdc) ||
    !Number.isFinite(margin)
  ) {
    return false;
  }
  const edge = 1 + Math.max(0, margin);
  return (
    zNdc >= -1 &&
    zNdc <= 1 &&
    Math.abs(xNdc) <= edge &&
    Math.abs(yNdc) <= edge
  );
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
        entry.onScreen &&
        entry.distanceM <= tuning.shadowDistanceM &&
        entry.screenHeightPx >= tuning.shadowMinScreenPx,
    )
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(0, Math.floor(tuning.maxShadowCasters)));
  return new Set(eligible.map((entry) => entry.id));
}

/**
 * Stagger authored animation updates without changing the 60 Hz root transform.
 * Callers pass the same tick to every rig; the rig supplies a per-player phase
 * so throttled updates do not all land on the same frame.
 */
export function animationStrideFor(
  detail: PlayerDetail,
  tuning: PlayerAnimationLodTuning,
  onScreen = true,
): number {
  const stride = onScreen
    ? detail === "full"
      ? tuning.fullStride
      : detail === "reduced"
        ? tuning.reducedStride
        : tuning.minimalStride
    : tuning.hiddenStride;
  return Number.isFinite(stride)
    ? Math.max(1, Math.floor(stride))
    : 1;
}

/** True when this rig's skeletal animation is due on the supplied tick. */
export function shouldAnimateAtTick(
  tick: number,
  stride: number,
  phase: number,
): boolean {
  if (!Number.isFinite(tick)) {
    return true;
  }
  if (!Number.isFinite(stride) || stride <= 1) {
    return true;
  }
  const divisor = Math.max(1, Math.floor(stride));
  const normalizedPhase =
    ((Math.floor(phase) % divisor) + divisor) % divisor;
  const normalizedTick = ((Math.floor(tick) % divisor) + divisor) % divisor;
  return normalizedTick === normalizedPhase;
}
