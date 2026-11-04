// packages/client/src/camera/cameraTuning.ts

/**
 * Every presentation-facing camera value lives here.
 *
 * Distances are metres, times are seconds, speeds are metres per second and
 * angles are degrees. The simulation never reads this file: the director runs
 * after snapshot interpolation and only moves the Three.js camera.
 */
export interface CameraTuning {
  readonly director: {
    /** Longest frame delta fed to the springs; prevents tab-switch launches. */
    readonly maxFrameDeltaSeconds: number;
    /** Fallback blend when a shot does not declare its own duration. */
    readonly defaultBlendSeconds: number;
  };
  readonly camera: {
    /** Near clipping plane in metres. */
    readonly nearClipM: number;
    /** Far clipping plane in metres. */
    readonly farClipM: number;
  };
  readonly broadcast: {
    /** Blend from the previous shot into the broadcast view. */
    readonly blendSeconds: number;
    /** Vertical field of view in the compact framing. */
    readonly fovDegrees: number;
    /** Extra FOV added as the action spreads across the pitch. */
    readonly wideFovDegrees: number;
    /** Camera height above the pitch in the mid framing. */
    readonly heightM: number;
    /** Height added at maximum spread. */
    readonly wideHeightM: number;
    /** Height removed at minimum spread. */
    readonly tightHeightM: number;
    /** Camera distance beyond the near touchline in the mid framing. */
    readonly sideSetbackM: number;
    /** Setback added at maximum spread. */
    readonly wideSetbackM: number;
    /** Setback removed at minimum spread; negative values push closer. */
    readonly tightSetbackM: number;
    /** Fraction of the target's across-pitch movement followed by the rig. */
    readonly sideFollowZ: number;
    /** Look-at height above the ground plane. */
    readonly targetHeightM: number;
    /** Fraction of the ball's height used in the look-at point. */
    readonly ballHeightFollow: number;
    /** Weight of the ball in the tracked target. */
    readonly ballWeight: number;
    /** Weight of the human-controlled player in the tracked target. */
    readonly controlledWeight: number;
    /** Weight of the centroid of players nearest the ball. */
    readonly nearestWeight: number;
    /** Number of nearest players included in target and spread. */
    readonly nearestPlayerCount: number;
    /** Seconds of ball velocity projected ahead of the ball. */
    readonly lookAheadSeconds: number;
    /** Maximum lookahead distance regardless of ball speed. */
    readonly lookAheadMaxM: number;
    /** Ball movements shorter than this do not move the tracking anchor. */
    readonly deadZoneM: number;
    /** Time constant for along-pitch target damping. */
    readonly panXResponseSeconds: number;
    /** Time constant for across-pitch target damping; intentionally slower. */
    readonly panZResponseSeconds: number;
    /** Time constant for the zoom spring; the slowest response. */
    readonly zoomResponseSeconds: number;
    /** Time constant for the fast-play response envelope. */
    readonly fastResponseSeconds: number;
    /** Extra tracking speed multiplier while the ball is travelling fast. */
    readonly fastTrackingBoost: number;
    /** Fraction of extra zoom applied during fast play. */
    readonly fastZoomBonus: number;
    /** Ball speed at which fast-play response starts. */
    readonly fastBallStartMps: number;
    /** Ball speed at which fast-play response is fully engaged. */
    readonly fastBallFullMps: number;
    /** Action spread at which the rig is fully pushed in. */
    readonly spreadMinM: number;
    /** Action spread at which the rig is fully pulled back. */
    readonly spreadMaxM: number;
    /** Tracking target margin inside the goal lines. */
    readonly edgeMarginXM: number;
    /** Tracking target margin inside the touchlines. */
    readonly edgeMarginZM: number;
    /** Softness of the target clamp near the stadium edge. */
    readonly edgeSoftnessM: number;
    /** Duration of the half-time move to the opposite touchline. */
    readonly sideFlipSeconds: number;
    /** Extra height during the half-time sideline move. */
    readonly sideFlipLiftM: number;
  };
}

export const CAMERA_TUNING: CameraTuning = {
  director: {
    maxFrameDeltaSeconds: 0.1,
    defaultBlendSeconds: 0.8,
  },
  camera: {
    nearClipM: 0.25,
    farClipM: 600,
  },
  broadcast: {
    blendSeconds: 0.8,
    fovDegrees: 39,
    wideFovDegrees: 2,
    heightM: 28,
    wideHeightM: 5,
    tightHeightM: -3,
    sideSetbackM: 38,
    wideSetbackM: 10,
    tightSetbackM: -14,
    sideFollowZ: 0.18,
    targetHeightM: 0.8,
    ballHeightFollow: 0.6,
    ballWeight: 0.65,
    controlledWeight: 0.25,
    nearestWeight: 0.1,
    nearestPlayerCount: 6,
    lookAheadSeconds: 0.45,
    lookAheadMaxM: 14,
    deadZoneM: 1.5,
    panXResponseSeconds: 0.35,
    panZResponseSeconds: 1,
    zoomResponseSeconds: 1.4,
    fastResponseSeconds: 0.4,
    fastTrackingBoost: 0.8,
    fastZoomBonus: 0.25,
    fastBallStartMps: 17,
    fastBallFullMps: 32,
    spreadMinM: 20,
    spreadMaxM: 60,
    edgeMarginXM: 6,
    edgeMarginZM: 5,
    edgeSoftnessM: 4,
    sideFlipSeconds: 1.1,
    sideFlipLiftM: 6,
  },
};

export interface CameraTuningRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Slider metadata for the F2 panel; keys are dotted tuning paths. */
export const CAMERA_TUNING_RANGES: Readonly<
  Record<string, CameraTuningRange>
> = {
  "director.maxFrameDeltaSeconds": { min: 0.016, max: 0.25, step: 0.001 },
  "director.defaultBlendSeconds": { min: 0.1, max: 1.2, step: 0.01 },
  "camera.nearClipM": { min: 0.05, max: 2, step: 0.01 },
  "camera.farClipM": { min: 300, max: 1200, step: 10 },
  "broadcast.blendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "broadcast.fovDegrees": { min: 30, max: 55, step: 0.1 },
  "broadcast.wideFovDegrees": { min: 0, max: 10, step: 0.1 },
  "broadcast.heightM": { min: 12, max: 45, step: 0.1 },
  "broadcast.wideHeightM": { min: 0, max: 15, step: 0.1 },
  "broadcast.tightHeightM": { min: -10, max: 10, step: 0.1 },
  "broadcast.sideSetbackM": { min: 15, max: 60, step: 0.1 },
  "broadcast.wideSetbackM": { min: 0, max: 25, step: 0.1 },
  "broadcast.tightSetbackM": { min: -20, max: 10, step: 0.1 },
  "broadcast.sideFollowZ": { min: 0, max: 0.6, step: 0.01 },
  "broadcast.targetHeightM": { min: 0, max: 3, step: 0.05 },
  "broadcast.ballHeightFollow": { min: 0, max: 1.5, step: 0.01 },
  "broadcast.ballWeight": { min: 0, max: 1, step: 0.01 },
  "broadcast.controlledWeight": { min: 0, max: 1, step: 0.01 },
  "broadcast.nearestWeight": { min: 0, max: 1, step: 0.01 },
  "broadcast.nearestPlayerCount": { min: 1, max: 11, step: 1 },
  "broadcast.lookAheadSeconds": { min: 0, max: 1.5, step: 0.01 },
  "broadcast.lookAheadMaxM": { min: 0, max: 30, step: 0.1 },
  "broadcast.deadZoneM": { min: 0, max: 6, step: 0.1 },
  "broadcast.panXResponseSeconds": { min: 0.05, max: 2, step: 0.01 },
  "broadcast.panZResponseSeconds": { min: 0.1, max: 3, step: 0.01 },
  "broadcast.zoomResponseSeconds": { min: 0.2, max: 4, step: 0.01 },
  "broadcast.fastResponseSeconds": { min: 0.05, max: 2, step: 0.01 },
  "broadcast.fastTrackingBoost": { min: 0, max: 2, step: 0.01 },
  "broadcast.fastZoomBonus": { min: 0, max: 0.8, step: 0.01 },
  "broadcast.fastBallStartMps": { min: 5, max: 30, step: 0.1 },
  "broadcast.fastBallFullMps": { min: 10, max: 45, step: 0.1 },
  "broadcast.spreadMinM": { min: 5, max: 50, step: 0.5 },
  "broadcast.spreadMaxM": { min: 20, max: 100, step: 0.5 },
  "broadcast.edgeMarginXM": { min: 0, max: 20, step: 0.1 },
  "broadcast.edgeMarginZM": { min: 0, max: 15, step: 0.1 },
  "broadcast.edgeSoftnessM": { min: 0.5, max: 10, step: 0.1 },
  "broadcast.sideFlipSeconds": { min: 0.2, max: 2.5, step: 0.01 },
  "broadcast.sideFlipLiftM": { min: 0, max: 15, step: 0.1 },
};
