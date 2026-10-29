// packages/shared/src/tuning.ts

/**
 * Single source of truth for tunable values.
 *
 * Rules:
 * - No gameplay or network-feel constants belong in feature modules.
 * - Units are explicit in the name or comment.
 * - Values are read-only; derive runtime values from them.
 *
 * Pitch orientation used by the simulation and renderer:
 * x runs along the touchline (0..length), y across the pitch (0..width),
 * z is up. Home defends x = 0; away defends x = length.
 */
export const TUNING = {
  network: {
    /** State broadcasts per second. */
    snapshotHz: 30,
    /** Browser application-level ping cadence, milliseconds. */
    clientPingIntervalMs: 2_000,
    /** WebSocket protocol ping cadence used to detect silent peers, milliseconds. */
    serverHeartbeatIntervalMs: 15_000,
    /** Time allowed for the client to send its hello, milliseconds. */
    helloTimeoutMs: 5_000,
    /** Maximum accepted WebSocket message size, bytes. */
    maxMessageBytes: 64 * 1024,
    /** First reconnect delay after an unexpected disconnect, milliseconds. */
    reconnectBaseDelayMs: 1_000,
    /** Reconnect delay ceiling, milliseconds. */
    reconnectMaxDelayMs: 8_000,
    /** Server holds a disconnected seat for this long, milliseconds. */
    reconnectGraceMs: 60_000,
    /** Client render delay behind the latest snapshot, milliseconds. */
    snapshotInterpolationDelayMs: 100,
    /** Snapshots retained for delta baselines, count. */
    snapshotHistorySize: 180,
  },
  http: {
    /** Browser cache lifetime for non-HTML static assets, seconds. */
    staticMaxAgeSeconds: 300,
  },
  sim: {
    /** Authoritative simulation frequency. */
    tickHz: 60,
    /** Maximum fixed ticks the renderer may catch up in one animation frame. */
    maxCatchUpTicks: 8,
  },
  match: {
    /** Game minutes per half; the HUD clock still runs to 45 and 90. */
    gameMinutesPerHalf: 45,
    /** Default real-time half length; 4/6/8/10 are the intended UI choices. */
    halfRealMinutes: 6,
    /** Real seconds of half-time before the second-half kick-off. */
    halfTimeSeconds: 5,
    /** Freeze time while an out-of-play restart is being set up. */
    restartDelaySeconds: 1.2,
    /** Longer freeze after a goal before the conceding side kicks off. */
    goalRestartDelaySeconds: 2,
    /** Freeze before the opening and second-half kick-offs. */
    kickoffDelaySeconds: 1,
    /** Centre circle radius used for the kick-off law, metres. */
    centreCircleRadiusM: 9.15,
    /** Kick-off taker stands this far behind the ball, metres. */
    kickoffTakerOffsetM: 0.6,
    /** Extra clearance beyond the centre circle for all other players, metres. */
    kickoffClearanceM: 0.5,
    /** Opponents must stand at least this far from a throw-in, metres. */
    throwInOpponentDistanceM: 2,
    /** Thrower stands this far inside the touchline, metres. */
    throwInTakerInsetM: 0.6,
    /** Opponents must stand at least this far from a corner, metres. */
    cornerOpponentDistanceM: 9.15,
    /** Corner taker stands this far inside the goal line, metres. */
    cornerTakerInsetM: 0.6,
    /** Goal-kick ball spot measured from the goal line, metres. */
    goalKickSpotFromLineM: 5.5,
    /** Opponents must clear the penalty area by this much, metres. */
    goalKickOpponentClearanceM: 0.4,
    /** Goal-kick taker stands this far behind the ball, metres. */
    goalKickTakerBehindBallM: 0.4,
  },
  pitch: {
    lengthM: 105,
    widthM: 68,
    goalWidthM: 7.32,
    goalHeightM: 2.44,
    goalPostRadiusM: 0.06,
    goalNetDepthM: 1.8,
    penaltyAreaLengthM: 16.5,
    penaltyAreaWidthM: 40.32,
    goalAreaLengthM: 5.5,
    goalAreaWidthM: 18.32,
    penaltySpotDistanceM: 11,
    penaltyArcRadiusM: 9.15,
    cornerArcRadiusM: 1,
  },
  ball: {
    radiusM: 0.11,
    massKg: 0.43,
    gravityMps2: 9.81,
    airDensityKgPerM3: 1.225,
    /** Quadratic drag coefficient, dimensionless. */
    dragCoefficient: 0.25,
    /** Aerodynamic lift slope feeding the Magnus term, dimensionless. */
    magnusLiftSlope: 0.2,
    groundRestitution: 0.68,
    /** Fraction of horizontal speed kept after a bounce, dimensionless. */
    groundTangentialRetention: 0.82,
    /** Constant rolling deceleration on grass, m/s². */
    rollingResistanceMps2: 0.45,
    minBounceSpeedMps: 0.4,
    /** Exponential spin decay while airborne, per second. */
    spinDecayPerSecond: 0.2,
    maxSpinRadPerS: 140,
    maxSpeedMps: 42,
    maxSubstepTravelM: 0.08,
    maxSubsteps: 8,
    netRestitution: 0.15,
    netDampingPerSecond: 7,
    /** Tangential velocity kept after hitting the net. */
    netTangentialRetention: 0.7,
    postRestitution: 0.62,
    playerRestitution: 0.4,
    /** Fraction of a player's velocity imparted by a body collision. */
    playerVelocityTransfer: 0.25,
    /** Fraction of a player's velocity added to a kicked ball by default. */
    kickPlayerVelocityTransfer: 0.2,
    kickClearanceM: 0.03,
    settleSpeedMps: 0.03,
  },
  player: {
    radiusM: 0.35,
    heightM: 1.8,
    minTopSpeedMps: 6.8,
    maxTopSpeedMps: 10.6,
    /** Seconds to 90% top speed for the slowest acceleration rating. */
    maxTimeTo90Seconds: 3.1,
    /** Seconds to 90% top speed for the fastest acceleration rating. */
    minTimeTo90Seconds: 1.4,
    timeTo90Fraction: 0.9,
    brakeAccelerationMultiplier: 1.6,
    minTurnRateRadPerS: 6,
    maxTurnRateRadPerS: 13,
    pitchMarginM: 0.6,
    jogThresholdMps: 1,
    sprintThresholdMps: 6,
    staminaDrainPerSecond: 0.008,
    staminaRecoveryPerSecond: 0.005,
    staminaDrainScaleAtRating1: 1.4,
    staminaDrainScaleAtRating99: 0.7,
    staminaRecoveryScaleAtRating1: 0.7,
    staminaRecoveryScaleAtRating99: 1.3,
    minStaminaSpeedFactor: 0.72,
    /** Speed below which facing turns toward the movement target, m/s. */
    facingSpeedThresholdMps: 0.15,
    /** Ignore tiny target offsets when choosing idle facing, metres. */
    facingTargetDeadzoneM: 0.05,
    actionStateSeconds: 0.4,
    kickCooldownSeconds: 0.65,
  },
  ai: {
    /** Reach at which the nearest player may kick the ball. */
    controlRadiusM: 1.2,
    controlMaxBallHeightM: 1.3,
    /** M1 demo kickoff: home striker starts this far behind the centre ball. */
    kickoffStrikerOffsetM: 0.8,
    chaseLeadSeconds: 0.25,
    shapeShiftXFactor: 0.22,
    shapeShiftYFactor: 0.16,
    anchorGoalMarginM: 4,
    supportSpeedFactor: 0.55,
    chaserSpeedFactor: 1,
    keeperSpeedFactor: 0.75,
    keeperLineOffsetM: 0.5,
    keeperMaxAdvanceM: 14,
    keeperTrackInsetM: 0.8,
    shootRangeM: 25,
    shootChance: 0.72,
    shootPowerMps: 26,
    shootLiftMps: 3.2,
    shootAimSpreadM: 2.6,
    /** Aim this far beyond the goal line so the ball crosses it. */
    shootAimDepthM: 0.4,
    shootVelocityTransfer: 0.1,
    shotBackspinRadPerS: 28,
    shotCurveSpinRadPerS: 30,
    passCurveSpinRadPerS: 7.5,
    dribbleTouchSpeedMps: 4.5,
    dribbleVelocityTransfer: 0.6,
    dribbleCooldownSeconds: 0.35,
    /** Nearest opponent this close to the ball triggers an evasive touch. */
    dribbleEvadeDistanceM: 2.2,
    dribbleEvadeTurnRad: Math.PI / 2,
    dribbleEvadeTargetM: 8,
    passRangeM: 35,
    minPassDistanceM: 4,
    passChance: 0.55,
    passPowerMps: 16,
    passLiftMps: 0.5,
    passVelocityTransfer: 0.2,
    passLeadSeconds: 0.25,
    pressDistanceM: 3,
    keeperClearPowerMps: 24,
    keeperClearLiftMps: 6,
    keeperClearSpreadM: 18,
  },
  control: {
    /** No fresh input for this long means neutral controls, milliseconds. */
    inputStaleMs: 250,
    /** Stick deadzone for gamepad/keyboard aggregation. */
    gamepadDeadzone: 0.18,
    /** Hold time for a full-power shot, seconds. */
    shotChargeSeconds: 0.9,
    minShotPower: 0.2,
    minShotSpeedMps: 14,
    maxShotSpeedMps: 27,
    minShotLiftMps: 1.2,
    maxShotLiftMps: 3.6,
    shotAimSpreadFactor: 0.85,
    finesseSpeedFactor: 0.82,
    finesseCurveSpinRadPerS: 55,
    shotBackspinRadPerS: 22,
    passSpeedMps: 17,
    passLiftMps: 0.4,
    passCooldownSeconds: 0.28,
    passLeadSeconds: 0.2,
    throughSpeedMps: 19,
    throughLiftMps: 0.8,
    throughLeadM: 7,
    lobSpeedMps: 19,
    lobLiftMps: 5.5,
    passSearchRangeM: 35,
    passConeCos: 0.1,
    aimDeadzone: 0.2,
    actionBallReachM: 1.35,
    jogSpeedFactor: 0.62,
    inputMoveTargetDistanceM: 12,
    switchCooldownSeconds: 0.6,
    autoSwitchCooldownSeconds: 0.5,
    autoSwitchDistanceM: 9,
    autoSwitchAdvantageM: 2.5,
    possessionRadiusM: 1.2,
    tackleRangeM: 1.9,
    tackleBallSpeedMps: 7,
    tackleLiftMps: 0.4,
    tackleCooldownSeconds: 0.8,
  },
  presentation: {
    /** Largest animation-frame delta consumed by the client, seconds. */
    maxFrameDeltaSeconds: 0.25,
    /** HUD refresh cadence, Hz. */
    hudUpdateHz: 10,
  },
} as const;

export type Tuning = typeof TUNING;
