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
  readonly context: {
    readonly kickoffDurationSeconds: number;
    readonly kickoffBlendSeconds: number;
    readonly kickoffHeightM: number;
    readonly kickoffSetbackM: number;
    readonly kickoffFovDegrees: number;
    readonly restartBlendSeconds: number;
    readonly throwInDurationSeconds: number;
    readonly goalKickDurationSeconds: number;
    readonly cornerDurationSeconds: number;
    readonly freeKickDurationSeconds: number;
    readonly penaltyDurationSeconds: number;
    readonly restartHeightM: number;
    readonly restartSetbackM: number;
    readonly restartFovDegrees: number;
    readonly restartLookAheadM: number;
    readonly restartTargetHeightM: number;
    readonly goalKickHeightM: number;
    readonly goalKickSetbackM: number;
    readonly goalKickFovDegrees: number;
    readonly celebrationDurationSeconds: number;
    readonly celebrationBlendSeconds: number;
    readonly celebrationRadiusM: number;
    readonly celebrationHeightM: number;
    readonly celebrationTargetHeightM: number;
    readonly celebrationOrbits: number;
    readonly celebrationFovDegrees: number;
    readonly incidentDurationSeconds: number;
    readonly incidentBlendSeconds: number;
    readonly incidentHeightM: number;
    readonly incidentSetbackM: number;
    readonly incidentFovDegrees: number;
    readonly incidentTargetHeightM: number;
    readonly substitutionDurationSeconds: number;
    readonly substitutionBlendSeconds: number;
    readonly substitutionFovDegrees: number;
    readonly halfTimeDurationSeconds: number;
    readonly halfTimeBlendSeconds: number;
    readonly calmHeightM: number;
    readonly calmSetbackM: number;
    readonly calmFovDegrees: number;
    readonly fullTimeDurationSeconds: number;
    readonly fullTimeBlendSeconds: number;
    readonly fullTimeRadiusM: number;
    readonly fullTimeHeightM: number;
    readonly fullTimeTargetHeightM: number;
    readonly fullTimeOrbits: number;
    readonly fullTimeFovDegrees: number;
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
  context: {
    kickoffDurationSeconds: 2.2,
    kickoffBlendSeconds: 0.7,
    kickoffHeightM: 30,
    kickoffSetbackM: 38,
    kickoffFovDegrees: 42,
    restartBlendSeconds: 0.55,
    throwInDurationSeconds: 2.2,
    goalKickDurationSeconds: 2.4,
    cornerDurationSeconds: 3.2,
    freeKickDurationSeconds: 3,
    penaltyDurationSeconds: 4,
    restartHeightM: 5,
    restartSetbackM: 7,
    restartFovDegrees: 36,
    restartLookAheadM: 12,
    restartTargetHeightM: 1.2,
    goalKickHeightM: 11,
    goalKickSetbackM: 22,
    goalKickFovDegrees: 42,
    celebrationDurationSeconds: 3.8,
    celebrationBlendSeconds: 0.5,
    celebrationRadiusM: 8,
    celebrationHeightM: 3.2,
    celebrationTargetHeightM: 1.4,
    celebrationOrbits: 0.9,
    celebrationFovDegrees: 38,
    incidentDurationSeconds: 2.6,
    incidentBlendSeconds: 0.4,
    incidentHeightM: 4.5,
    incidentSetbackM: 5.5,
    incidentFovDegrees: 34,
    incidentTargetHeightM: 1.1,
    substitutionDurationSeconds: 2.2,
    substitutionBlendSeconds: 0.6,
    substitutionFovDegrees: 40,
    halfTimeDurationSeconds: 3.5,
    halfTimeBlendSeconds: 0.8,
    calmHeightM: 30,
    calmSetbackM: 42,
    calmFovDegrees: 42,
    fullTimeDurationSeconds: 6,
    fullTimeBlendSeconds: 1.1,
    fullTimeRadiusM: 55,
    fullTimeHeightM: 24,
    fullTimeTargetHeightM: 1,
    fullTimeOrbits: 0.25,
    fullTimeFovDegrees: 40,
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
  "context.kickoffDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.kickoffBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.kickoffHeightM": { min: 8, max: 60, step: 0.5 },
  "context.kickoffSetbackM": { min: 8, max: 60, step: 0.5 },
  "context.kickoffFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.restartBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.throwInDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.goalKickDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.cornerDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.freeKickDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.penaltyDurationSeconds": { min: 0.5, max: 8, step: 0.1 },
  "context.restartHeightM": { min: 1, max: 25, step: 0.1 },
  "context.restartSetbackM": { min: 1, max: 30, step: 0.1 },
  "context.restartFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.restartLookAheadM": { min: 0, max: 30, step: 0.5 },
  "context.restartTargetHeightM": { min: 0.5, max: 3, step: 0.05 },
  "context.goalKickHeightM": { min: 3, max: 35, step: 0.5 },
  "context.goalKickSetbackM": { min: 3, max: 45, step: 0.5 },
  "context.goalKickFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.celebrationDurationSeconds": { min: 1, max: 8, step: 0.1 },
  "context.celebrationBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.celebrationRadiusM": { min: 2, max: 20, step: 0.1 },
  "context.celebrationHeightM": { min: 1, max: 12, step: 0.1 },
  "context.celebrationTargetHeightM": { min: 0.5, max: 3, step: 0.05 },
  "context.celebrationOrbits": { min: 0.1, max: 1.5, step: 0.01 },
  "context.celebrationFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.incidentDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.incidentBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.incidentHeightM": { min: 1, max: 15, step: 0.1 },
  "context.incidentSetbackM": { min: 1, max: 20, step: 0.1 },
  "context.incidentFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.incidentTargetHeightM": { min: 0.5, max: 3, step: 0.05 },
  "context.substitutionDurationSeconds": { min: 0.5, max: 6, step: 0.1 },
  "context.substitutionBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.substitutionFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.halfTimeDurationSeconds": { min: 1, max: 10, step: 0.1 },
  "context.halfTimeBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.calmHeightM": { min: 8, max: 60, step: 0.5 },
  "context.calmSetbackM": { min: 8, max: 60, step: 0.5 },
  "context.calmFovDegrees": { min: 20, max: 55, step: 0.5 },
  "context.fullTimeDurationSeconds": { min: 1, max: 12, step: 0.1 },
  "context.fullTimeBlendSeconds": { min: 0.2, max: 1.2, step: 0.01 },
  "context.fullTimeRadiusM": { min: 10, max: 90, step: 0.5 },
  "context.fullTimeHeightM": { min: 5, max: 50, step: 0.5 },
  "context.fullTimeTargetHeightM": { min: 0.5, max: 3, step: 0.05 },
  "context.fullTimeOrbits": { min: 0.05, max: 1.5, step: 0.01 },
  "context.fullTimeFovDegrees": { min: 20, max: 55, step: 0.5 },
};
