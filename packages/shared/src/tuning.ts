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
    /** Game minutes in one extra-time period. */
    extraTimeMinutesPerHalf: 15,
    /** Real seconds of half-time before the second-half kick-off. */
    halfTimeSeconds: 5,
    /** Real seconds of the break before extra time starts, seconds. */
    extraTimeBreakSeconds: 5,
    /** Added time is rounded up to this display increment, seconds. */
    addedTimeRoundingSeconds: 60,
    /** Upper bound on a single period's added time, seconds. */
    addedTimeCapSeconds: 300,
    /** Stoppage allowances added to the board, seconds of game clock. */
    addedTimeGoalSeconds: 30,
    addedTimeCardSeconds: 10,
    addedTimeSubstitutionSeconds: 20,
    addedTimeInjurySeconds: 45,
    addedTimeVarSeconds: 20,
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
    supportSpeedFactor: 0.82,
    chaserSpeedFactor: 1,
    receiverSpeedFactor: 0.98,
    receiverProjectionSeconds: 1,
    receiverMaxDistanceM: 30,
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
    dribbleTouchSpeedMps: 6.2,
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
    /** Per-decision chance to commit to a tackle when an opponent has the ball. */
    tackleChance: 0.75,
    /** Share of AI challenges that commit to a slide rather than a stand tackle. */
    slideTackleChance: 0.02,
    /** Reduced willingness to challenge a carrier from behind (dangerous). */
    behindTackleChance: 0.05,
    /** Retry delay after declining a tackle, seconds. */
    tackleDecisionCooldownSeconds: 0.2,
    /** Above this ball speed a defender intercepts rather than tackles. */
    tackleMaxBallSpeedMps: 8,
    keeperClearPowerMps: 24,
    keeperClearLiftMps: 6,
    keeperClearSpreadM: 18,
    /** A team owns the ball when its nearest player is this close to it. */
    possessionRadiusM: 2.2,
    /** Balls faster than this are loose even when a player is nearby. */
    possessionMaxBallSpeedMps: 9,
    /** Radius in which the closest defender is allowed to press the carrier. */
    pressTriggerRadiusM: 18,
    /** Second presser joins a high press inside this radius. */
    pressSecondTriggerRadiusM: 10,
    /** Loose-ball pursuit radius before a team drops into its block. */
    looseBallPursuitRadiusM: 32,
    /** Extra runners committed to a loose ball in the team's defensive half. */
    looseBallSecondChaserM: 12,
    /** Tactical line-height travel from a 0..100 defensive-depth setting. */
    depthShiftM: 12,
    /** Vertical width multiplier at a 0..100 width setting. */
    widthSpread: 0.28,
    /** Share of the tactical line shift applied to the back line. */
    lineHeightWeight: 0.7,
    /** Distance the defensive line may be dragged from its shape by the ball. */
    lineBallInfluenceM: 18,
    /** Baseline speed multiplier for the first presser. */
    pressAggressionFactor: 1,
    /** Speed multiplier for a runner attacking the last line. */
    runnerSpeedFactor: 1,
    /** Maximum distance a defender may be from its anchor while marking. */
    markingRadiusM: 9,
    /** Defenders sit this far goal-side of the attacker they mark. */
    markGoalSideM: 1.4,
    /** Cover defender depth behind the presser. */
    coverDepthM: 5,
    /** Minimum spacing between teammates' targets to avoid clumping. */
    teammateSeparationM: 2.2,
    /** Width of the central lane used by role anchors, metres. */
    centralWidthM: 18,
    /** Role-template values used by every formation shape. */
    roles: {
      GK: { attackShift: 0.01, defendShift: 0, runInBehind: 0, cover: 0 },
      RB: { attackShift: 0.045, defendShift: -0.01, runInBehind: 0.42, cover: 0.2 },
      CB: { attackShift: -0.015, defendShift: -0.025, runInBehind: 0.02, cover: 0.75 },
      LB: { attackShift: 0.045, defendShift: -0.01, runInBehind: 0.42, cover: 0.2 },
      CDM: { attackShift: -0.005, defendShift: -0.02, runInBehind: 0.12, cover: 0.95 },
      CM: { attackShift: 0.025, defendShift: -0.015, runInBehind: 0.26, cover: 0.5 },
      CAM: { attackShift: 0.06, defendShift: 0.005, runInBehind: 0.5, cover: 0.2 },
      RM: { attackShift: 0.045, defendShift: -0.005, runInBehind: 0.5, cover: 0.25 },
      LM: { attackShift: 0.045, defendShift: -0.005, runInBehind: 0.5, cover: 0.25 },
      RW: { attackShift: 0.055, defendShift: 0, runInBehind: 0.72, cover: 0.15 },
      LW: { attackShift: 0.055, defendShift: 0, runInBehind: 0.72, cover: 0.15 },
      CF: { attackShift: 0.05, defendShift: 0.005, runInBehind: 0.62, cover: 0.1 },
      ST: { attackShift: 0.04, defendShift: 0.01, runInBehind: 0.88, cover: 0.05 },
    },
    /** Attack support and off-ball movement. */
    supportDistanceM: 11,
    supportForwardM: 5,
    supportBackwardM: 7,
    supportLateralM: 8,
    overlapRunM: 7,
    thirdManRunM: 9,
    channelRunM: 5,
    runnerLeadM: 2.5,
    /** Attacking runners may stray this far beyond the offside line. */
    offsideRunToleranceM: 4,
    /** Only deep/central carriers consider clearing. */
    clearZoneDepthM: 30,
    clearPressureM: 3,
    /** Decision scores are normalised to this range before noise. */
    decisionNoiseRange: 1,
    /** Pass geometry. */
    passShortRangeM: 25,
    passLongRangeM: 45,
    passThroughRangeM: 38,
    passSpeedPerMetre: 1.05,
    passMinSpeedMps: 8,
    passMaxSpeedMps: 27,
    throughPassSpeedPerMetre: 1.2,
    crossLiftMps: 6.4,
    crossSpeedPerMetre: 0.9,
    passAimErrorDivisor: 1.6,
    passMinFlightSeconds: 0.08,
    passMaxFlightSeconds: 1.2,
    /** Shots. */
    shootMinRangeM: 7,
    shootMaxRangeM: 34,
    shootSweetRangeM: 16,
    shootRangePenalty: 0.55,
    shootPowerBaseMps: 19,
    shootPowerRangeMps: 8,
    shootLiftBaseMps: 2.6,
    shootLiftRangeMps: 1.4,
    shootAimInsetM: 0.45,
    shotMaxAimOffsetM: 3.1,
    shotSpreadDivisor: 1.8,
    /** Relative weights for the on-ball decision scores. */
    decision: {
      shootBase: 0.2,
      shootAccuracyWeight: 0.72,
      shootDistanceFloor: 0.58,
      shootAngleFloor: 0.55,
      shootPressureWeight: 0.5,
      shootCloseRangeM: 22,
      shootCloseBonus: 0.1,
      shootZoneRangeM: 30,
      shootZoneBonus: 0.56,
      passBase: 0.03,
      passExecutionWeight: 0.14,
      passLaneWeight: 0.06,
      passOpenWeight: 0.06,
      passForwardWeight: 0.36,
      passDangerWeight: 0.24,
      passStyleWeight: 0.06,
      passPressureWeight: 0.04,
      passBackwardPenalty: 0.18,
      passLightBackwardPenalty: 0.07,
      passLightBackwardM: 2,
      passThroughBonus: 0.3,
      passRiskWeight: 0.2,
      dribbleBase: 0.08,
      dribbleWeight: 0.35,
      dribbleControlWeight: 0.15,
      dribbleSpaceFloor: 0.4,
      dribbleGoalWeight: 0.06,
      dribblePressureWeight: 0.3,
    },
    /** Set-piece routines. */
    cornerNearPostYOffsetM: 5.5,
    cornerFarPostYOffsetM: 4,
    cornerDeliveryLiftMps: 7.4,
    cornerDeliverySpeedMps: 20,
    cornerRunnerDepthM: 7,
    freeKickDirectRangeM: 30,
    freeKickWallAimInsetM: 0.4,
    penaltyAimOffsetM: 2.6,
    penaltyPowerMps: 24,
    penaltyLiftMps: 1.2,
    /** Goalkeeper sweeping and angle narrowing. */
    keeperSweepTriggerM: 26,
    keeperSweepMaxM: 22,
    keeperAngleDepthM: 2.4,
    keeperAngleDistanceFactor: 0.08,
    keeperNearPostInsetM: 0.7,
    keeperClaimRadiusM: 2.4,
    keeperSweepSpeedFactor: 0.95,
    keeperShotBlockDepthM: 1.4,
    /** Explicit mistimed through-ball share per on-ball decision. */
    offsideIntentChance: 0.14,
    offsideIntentMaxBeyondM: 6,

    offsideIntentLeadM: 0.5,
    offsideIntentAccuracyFactor: 0.45,
    /** Goalkeeper save window and catch/parry resolution. */
    saveMinBallSpeedMps: 8,
    saveMaxDistanceM: 6.5,
    saveReachBaseM: 1.1,
    saveReachRatingM: 1.6,
    saveReactionSeconds: 0.28,
    saveBaseChance: 0.4,
    saveReflexWeight: 0.46,
    savePositioningWeight: 0.18,
    saveHandlingWeight: 0.1,
    saveReachWeight: 0.25,
    saveSpeedPenalty: 0.18,
    saveReactionPenalty: 0.12,
    saveMaxChance: 0.96,
    saveCatchBase: 0.24,
    saveCatchHandlingWeight: 0.52,
    saveCatchSpeedPenalty: 0.3,
    saveCatchMinChance: 0.08,
    saveCatchMaxChance: 0.86,
    saveCatchHoldSeconds: 0.72,
    saveParrySpeedMps: 10,
    saveParryLateralMps: 7,
    saveParryLiftMps: 3,
    saveParryRecoverSeconds: 0.42,
    /** Difficulty profiles. Reaction is in simulation ticks. */
    difficulty: {
      beginner: {
        reactionTicks: 24,
        decisionNoise: 0.42,
        passErrorM: 5.4,
        shotAimErrorM: 6,
        pressAggression: 0.55,
        tackleBias: -0.12,
        throughBias: 0.35,
        offsideDiscipline: 0.35,
        supportSpeedFactor: 0.86,
      },
      amateur: {
        reactionTicks: 16,
        decisionNoise: 0.3,
        passErrorM: 4,
        shotAimErrorM: 5,
        pressAggression: 0.7,
        tackleBias: -0.05,
        throughBias: 0.65,
        offsideDiscipline: 0.55,
        supportSpeedFactor: 0.92,
      },
      professional: {
        reactionTicks: 10,
        decisionNoise: 0.2,
        passErrorM: 2.8,
        shotAimErrorM: 3.8,
        pressAggression: 0.9,
        tackleBias: 0,
        throughBias: 1,
        offsideDiscipline: 0.75,
        supportSpeedFactor: 0.96,
      },
      worldClass: {
        reactionTicks: 6,
        decisionNoise: 0.12,
        passErrorM: 1.9,
        shotAimErrorM: 2.4,
        pressAggression: 1.05,
        tackleBias: 0.04,
        throughBias: 1.15,
        offsideDiscipline: 0.88,
        supportSpeedFactor: 1,
      },
      legendary: {
        reactionTicks: 3,
        decisionNoise: 0.06,
        passErrorM: 1.2,
        shotAimErrorM: 1.8,
        pressAggression: 1.18,
        tackleBias: 0.08,
        throughBias: 1.25,
        offsideDiscipline: 0.96,
        supportSpeedFactor: 1.03,
      },
    },
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
  referee: {
    /** Relative closing speed mapped to the top of the foul severity curve. */
    foulMaxRelativeSpeedMps: 12,
    /** Baseline severity before speed, angle, contact and ratings are applied. */
    foulBaseSeverity: 0.18,
    foulSpeedWeight: 0.28,
    /** Extra severity when the contact comes from behind the victim. */
    foulBehindWeight: 0.34,
    foulSlideWeight: 0.08,
    foulUpperBodyWeight: 0.18,
    /** Extra severity when the tackle does not win the ball first. */
    foulNoBallWeight: 0.18,
    foulAggressionWeight: 0.14,
    foulTackleWeight: 0.18,
    foulBalanceWeight: 0.1,
    foulAngleWeight: 0.08,
    /** Severity removed when the tackler clearly wins the ball first. */
    foulBallFirstReduction: 0.3,
    foulThreshold: 0.46,
    yellowThreshold: 0.76,
    redThreshold: 0.9,
    /**
     * A standing challenge from behind is usually careless/reckless rather
     * than excessive force; only sliding or DOGSO contacts can exceed this.
     */
    standingBehindSeverityCap: 0.8,
    /** Pressing duels: shoulder charges, pushes and holds. */
    physicalDuelBaseSeverity: 0.2,
    physicalDuelSpeedWeight: 0.2,
    physicalDuelBehindWeight: 0.08,
    physicalDuelForceWeight: 0.32,
    physicalDuelAggressionWeight: 0.08,
    physicalDuelBalanceWeight: 0.06,
    /** Speed/force profile of an AI shoulder challenge, 0..1. */
    physicalDuelForce: 0.42,
    physicalDuelRangeM: 1.35,
    physicalDuelChance: 0.2,
    physicalDuelCooldownSeconds: 2.4,
    lenientOffset: -0.08,
    strictOffset: 0.08,
    /** Tackler-to-victim distance that can generate a contact event, metres. */
    tackleContactRangeM: 1.35,
    /** Victim facing dot threshold below which contact counts as from behind. */
    behindDotThreshold: -0.17,
    /** Straight-red denial of a goalscoring opportunity. */
    dogsoMaxDistanceM: 32,
    dogsoCentralHalfWidthM: 12,
    dogsoMaxDefendersGoalSide: 1,
    /** Advantage window and the forward progress needed to keep play alive. */
    advantageSeconds: 3,
    advantageGainM: 8,
    advantagePossessionRadiusM: 2.5,
    /** Victim fall duration after a foul, seconds. */
    fallSeconds: 1.2,
    /** Active offside involvement: touching or challenging near the ball. */
    offsideInvolvementRadiusM: 2.1,
    offsideChallengeRadiusM: 1.2,
    offsideChallengeBallRadiusM: 5,
    /** Ball heights that can strike the hand/arm rather than the head. */
    handballMinHeightM: 0.72,
    handballMaxHeightM: 1.55,
    handballShoulderHeightM: 1.3,
    /** Deterministic chance that a hand/arm contact is judged deliberate. */
    handballDeliberateChance: 0.35,
    handballMinRelativeSpeedMps: 2,
    /** Free-kick wall geometry. */
    wallMinDefenders: 2,
    wallMaxDefenders: 6,
    wallDistanceM: 9.15,
    wallMaxKickDistanceM: 35,
    wallSpacingM: 0.75,
    wallClearanceM: 0.3,
    freeKickTakerBackM: 0.8,
    /** Penalty placement. */
    penaltyTakerBackM: 1,
    penaltyGoalkeeperLineOffsetM: 0.15,
    penaltyClearanceM: 0.5,
    /** Extra distance beyond the penalty arc for non-participants. */
    penaltyArcClearanceM: 0.5,
    /** Goalkeeper six-second-style possession limit, seconds. */
    goalkeeperHoldSeconds: 8,
    /** Ball speed below which a keeper is judged to be holding it, m/s. */
    goalkeeperHoldMaxBallSpeedMps: 2,
    /** Reach used to attribute possession to the goalkeeper, metres. */
    goalkeeperHoldRadiusM: 1.2,
  },
  management: {
    /** Total substitutions allowed in regulation, excluding extra time. */
    maxSubstitutions: 5,
    /** Additional substitution allowed when extra time starts. */
    extraTimeSubstitutions: 1,
    /** Regulation substitution windows; half-time is free. */
    maxWindows: 3,
    /** Additional window allowed in extra time. */
    extraTimeWindows: 1,
    /** Match is forfeited below this many available players. */
    minimumPlayers: 7,
    /** Substitute enters this far inside the touchline when the ball is dead. */
    benchInsetM: 1,
  },
  injury: {
    /** Added to the injury-prone rating to form the base risk. */
    baseRisk: 0.04,
    /** Risk from a foul with maximum contact severity. */
    severityRisk: 0.18,
    /** Scaling of the victim's injury-proneness (1..99). */
    pronenessRisk: 0.08,
    /** Contact severity at or above which the injury can end the player's match. */
    seriousThreshold: 0.55,
    /** Chance a high-force injury is still playable. */
    playOnChance: 0.35,
    /** Extra risk multiplier for contact from behind. */
    behindRiskFactor: 0.5,
    /** Speed/stamina multipliers while carrying a minor injury. */
    minorSpeedFactor: 0.9,
    minorStaminaFactor: 1.15,
    /** Seconds a seriously injured player needs before play can resume. */
    stretcherSeconds: 4,
    /** Seconds a minor injury keeps the player grounded. */
    minorFallSeconds: 1.4,
  },
  shootout: {
    /** Regulation kicks per side. */
    regulationKicks: 5,
    /** Real seconds between shootout kicks. */
    kickIntervalSeconds: 1.5,
    /** Base conversion chance before skill modifiers. */
    baseConversionChance: 0.74,
    /** Weight of the taker's finishing/composure. */
    takerWeight: 0.22,
    /** Weight of the goalkeeper's save attributes. */
    keeperWeight: 0.2,
    /** Taker skill blend. */
    takerFinishingWeight: 0.55,
    takerComposureWeight: 0.3,
    takerPowerWeight: 0.15,
    /** Keeper skill blend when the goalkeeper attributes are present. */
    keeperDivingWeight: 0.3,
    keeperHandlingWeight: 0.25,
    keeperReflexesWeight: 0.3,
    keeperPositioningWeight: 0.15,
    /** Outfield emergency keeper blend. */
    emergencyReactionsWeight: 0.4,
    emergencyDefenceWeight: 0.35,
    emergencyAgilityWeight: 0.25,
    /** Fallback conversion against a missing keeper. */
    missingKeeperScore: 0.45,
    /** Clamp for the final conversion chance. */
    minChance: 0.35,
    maxChance: 0.94,
    /** Real seconds between the final miss and the full-time board. */
    finishDelaySeconds: 1.5,
  },
  var: {
    /** Real seconds of the review check. */
    reviewSeconds: 3,
    /** Real seconds the confirmed/overturned board stays visible. */
    decisionDisplaySeconds: 1,
    /** Severity band below the foul threshold that VAR can overturn. */
    penaltyOverturnSeverity: 0.5,
    /** Red-card severity band below the red threshold that VAR can overturn. */
    redOverturnSeverity: 0.94,
  },
  presentation: {
    /** Largest animation-frame delta consumed by the client, seconds. */
    maxFrameDeltaSeconds: 0.25,
    /** HUD refresh cadence, Hz. */
    hudUpdateHz: 10,
  },
  data: {
    /**
     * Weights for deriving the six public face ratings from detailed
     * attributes. Each row sums to 1; ratings are rounded and clamped 1..99.
     */
    faceStats: {
      PAC: { sprintSpeed: 0.55, acceleration: 0.35, reactions: 0.1 },
      SHO: {
        finishing: 0.4,
        shotPower: 0.25,
        longShots: 0.2,
        volleys: 0.1,
        penalties: 0.05,
      },
      PAS: {
        shortPassing: 0.3,
        vision: 0.2,
        crossing: 0.2,
        longPassing: 0.15,
        fkAccuracy: 0.1,
        curve: 0.05,
      },
      DRI: {
        dribbling: 0.3,
        ballControl: 0.2,
        agility: 0.15,
        balance: 0.15,
        reactions: 0.1,
        composure: 0.1,
      },
      DEF: {
        interceptions: 0.3,
        headingAccuracy: 0.2,
        defAwareness: 0.25,
        standingTackle: 0.15,
        slidingTackle: 0.1,
      },
      PHY: {
        jumping: 0.3,
        stamina: 0.3,
        strength: 0.25,
        aggression: 0.15,
      },
    },
    /**
     * Detailed attributes are blended into the compact simulation ratings so
     * related skills still move the same physical model. Each row sums to 1.
     */
    simAttributes: {
      acceleration: { acceleration: 0.8, sprintSpeed: 0.2 },
      agility: { agility: 0.65, balance: 0.2, reactions: 0.15 },
      ballControl: { ballControl: 0.6, dribbling: 0.25, composure: 0.15 },
      standingTackle: {
        standingTackle: 0.7,
        defAwareness: 0.2,
        interceptions: 0.1,
      },
      slidingTackle: {
        slidingTackle: 0.7,
        defAwareness: 0.2,
        interceptions: 0.1,
      },
      balance: { balance: 0.7, strength: 0.2, agility: 0.1 },
    },
  },
} as const;

export type Tuning = typeof TUNING;
