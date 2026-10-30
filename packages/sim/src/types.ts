// packages/sim/src/types.ts

import type {
  GoalkeeperAttributes,
  PlayerPosition,
  PlayerStateName,
  TeamTactics,
} from "@fb/shared";
export type { PlayerStateName } from "@fb/shared";

export type TeamSide = "home" | "away";

export type AiDifficulty =
  | "beginner"
  | "amateur"
  | "professional"
  | "worldClass"
  | "legendary";

/** +1 attacks toward increasing x; -1 toward decreasing x. */
export type AttackDirection = 1 | -1;

export type PlayerRole =
  | "GK"
  | "RB"
  | "CB"
  | "LB"
  | "CDM"
  | "CM"
  | "CAM"
  | "RM"
  | "LM"
  | "RW"
  | "LW"
  | "CF"
  | "ST";

/** Mirrors the state vocabulary the renderer and referee will share. */

/**
 * Ratings consumed by the simulation. Physical and contact values are blended
 * where one movement/contact model needs several source attributes; tactical
 * ratings stay one-to-one so decisions can read the authored value directly.
 */
export interface PlayerAttributes {
  readonly sprintSpeed: number;
  readonly acceleration: number;
  readonly agility: number;
  readonly stamina: number;
  readonly ballControl: number;
  readonly standingTackle: number;
  readonly slidingTackle: number;
  readonly aggression: number;
  readonly balance: number;
  readonly strength: number;
  readonly finishing: number;
  readonly shotPower: number;
  readonly longShots: number;
  readonly attPosition: number;
  readonly shortPassing: number;
  readonly vision: number;
  readonly crossing: number;
  readonly longPassing: number;
  readonly curve: number;
  readonly dribbling: number;
  readonly reactions: number;
  readonly composure: number;
  readonly interceptions: number;
  readonly headingAccuracy: number;
  readonly defAwareness: number;
  readonly jumping: number;
  readonly skillMoves: number;
  readonly weakFoot: number;
  /** Present only for players authored as goalkeepers. */
  readonly goalkeeper: GoalkeeperAttributes | null;
  /** Authored 1..99 risk; omitted synthetic/legacy players use a neutral value. */
  readonly injuryProneness?: number;
}

export type InjurySeverity = "minor" | "serious";

export interface InjuryState {
  readonly severity: InjurySeverity;
  /** Minor injuries allow play at a reduced movement/stamina multiplier. */
  readonly canPlayOn: boolean;
  readonly speedFactor: number;
  readonly staminaFactor: number;
  readonly treatmentSeconds: number;
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly team: TeamSide;
  /** Mutable so an emergency outfielder can take the goalkeeper role. */
  role: PlayerRole;
  readonly number: number;
  readonly attributes: PlayerAttributes;
  /** 0..1 multiplier for technical decisions from the authored position fit. */
  readonly roleFamiliarity: number;
  /** Normalized formation slot, x from own goal (0) to opponent goal (1). */
  readonly formationX: number;
  readonly formationY: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians; 0 faces +x. */
  facing: number;

  state: PlayerStateName;
  actionTimer: number;
  kickCooldown: number;
  stamina: number;
  /** Yellow cards shown to this player; a second yellow becomes a red. */
  yellowCards: number;
  /** Sent-off players remain in the roster for stable snapshot slots. */
  sentOff: boolean;
  /** Injured players can be unavailable for the rest of the match. */
  unavailable: boolean;
  injury: InjuryState | null;
  /** True while a network client owns this body; AI leaves movement/actions alone. */
  isUserControlled: boolean;

  /** Derived every tick by the AI, in metres / m/s. */
  targetX: number;
  targetY: number;
  targetSpeed: number;
}

export interface TeamColors {
  readonly primary: string;
  readonly secondary: string;
  readonly keeper: string;
}

export interface FormationSlot {
  readonly role: PlayerRole;
  readonly x: number;
  readonly y: number;
}

export interface Formation {
  readonly name: string;
  readonly slots: readonly FormationSlot[];
}

/** Simulation IDs of the authored set-piece takers; null when not authored. */
export interface TeamSetPieceTakers {
  penalty: string | null;
  freeKick: string | null;
  cornerLeft: string | null;
  cornerRight: string | null;
}

export interface SubstitutePlayer {
  readonly player: PlayerState;
  readonly positions: readonly PlayerPosition[];
  readonly preferredPosition: PlayerPosition;
}

export interface TeamState {
  readonly side: TeamSide;
  readonly name: string;
  readonly colors: TeamColors;
  readonly formation: Formation;
  /** Authored team instructions; all values are validated 0..100 or enums. */
  readonly tactics: TeamTactics;
  /** Mutable because a substituted taker must resolve to the new player. */
  takers: TeamSetPieceTakers;
  /** Flipped at half-time when the teams change ends. */
  attackDirection: AttackDirection;
  players: PlayerState[];
  /** Eligible matchday substitutes; reserves do not enter the match. */
  readonly bench: SubstitutePlayer[];
  substitutionsUsed: number;
  substitutionWindowsUsed: number;
  /** True while the current dead-ball interval has already used a window. */
  substitutionWindowUsed: boolean;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity in rad/s, world axes. */
  spinX: number;
  spinY: number;
  spinZ: number;
}

export interface LastTouch {
  readonly team: TeamSide;
  readonly playerId: string;
  readonly playerNumber: number;
}

export type MatchPhase =
  | "deadBall"
  | "live"
  | "halfTime"
  | "fullTime"
  | "shootout";

/** 1/2 are regulation halves; 3/4 are the two extra-time periods. */
export type MatchHalf = 1 | 2 | 3 | 4;

export type RestartType =
  | "kickoff"
  | "throwIn"
  | "goalKick"
  | "corner"
  | "directFreeKick"
  | "indirectFreeKick"
  | "penalty"
  | "dropBall";

export type FoulStrictness = "lenient" | "standard" | "strict";

export type CardKind = "yellow" | "red";

export type MatchEventType =
  | "foul"
  | "advantage"
  | "yellowCard"
  | "redCard"
  | "offside"
  | "handball"
  | "penalty"
  | "injury"
  | "substitution"
  | "goalkeeperHold"
  | "varReview"
  | "shootoutGoal"
  | "shootoutMiss"
  | "forfeit";

export interface MatchEvent {
  readonly seq: number;
  readonly tick: number;
  readonly type: MatchEventType;
  readonly side: TeamSide;
  readonly playerId: string | null;
  readonly playerNumber: number | null;
}

export interface MatchRules {
  /** Real seconds in one half; game clock is still scaled to 45 minutes. */
  readonly realHalfSeconds: number;
  /** Real seconds between the first-half whistle and the second-half kick-off. */
  readonly halfTimeSeconds: number;
  /** Real seconds play is frozen while a restart is being set up. */
  readonly restartDelaySeconds: number;
  /** Longer pause after a goal before the conceding side kicks off. */
  readonly goalRestartDelaySeconds: number;
  /** Real seconds before the opening/second-half kick-off becomes live. */
  readonly kickoffDelaySeconds: number;
  /** Game-clock seconds represented by one half (45 minutes). */
  readonly gameSecondsPerHalf: number;
  /** Referee tolerance used by the tackle severity model. */
  readonly strictness: FoulStrictness;
  /** Behaviour profile used by every non-user-controlled player. */
  readonly aiDifficulty: AiDifficulty;
  /** Knockout option: two 15-minute extra-time periods. */
  readonly extraTimeEnabled: boolean;
  /** Knockout option: penalty shootout when the score is level. */
  readonly shootoutEnabled: boolean;
  /** Optional VAR-lite checks for goals, penalties and direct reds. */
  readonly varEnabled: boolean;
}

/** Cumulative, per-team match facts used by soak tests and the HUD. */
export interface TeamMatchStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  fouls: number;
  offsides: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  /** Attempted passes; completed passes are a subset. */
  passes: number;
  passesCompleted: number;
  /** Simulation ticks in which this team was the nearest team to the ball. */
  possessionTicks: number;
}

export interface MatchStats {
  readonly home: TeamMatchStats;
  readonly away: TeamMatchStats;
}

export interface RestartState {
  readonly type: RestartType;
  readonly side: TeamSide;
  /** Ball placement in pitch metres. */
  readonly x: number;
  readonly y: number;
}

export type PenaltyEncroachment =
  | "none"
  | "attacker"
  | "defender"
  | "both";

export interface PenaltyRuntime {
  readonly side: TeamSide;
  readonly takerId: string;
  readonly goalkeeperId: string;
  /** True once the taker has played the ball. */
  kicked: boolean;
  encroachment: PenaltyEncroachment;
}

export interface SetPieceRuntime {
  readonly type: RestartType;
  readonly side: TeamSide;
  readonly takerId: string | null;
  /** First player to touch the ball after the restart; null while pending. */
  firstTouchId: string | null;
  /** True once anyone other than the taker touches the ball. */
  otherTouched: boolean;
  /** Defenders instructed to hold the free-kick wall until the ball is played. */
  readonly wallPlayerIds: readonly string[];
  readonly penalty: PenaltyRuntime | null;
}

export interface OffsideRuntime {
  readonly side: TeamSide;
  /** Tick at which the decisive kick was played. */
  readonly tick: number;
  readonly playerIds: readonly string[];
}

export interface PendingFoul {
  readonly side: TeamSide;
  readonly offenderId: string;
  readonly offenderNumber: number;
  readonly restartType: "directFreeKick" | "penalty";
  readonly severity: number;
  readonly x: number;
  readonly y: number;
  readonly expiresTick: number;
}

export interface GoalkeeperHold {
  readonly side: TeamSide;
  readonly playerId: string;
  seconds: number;
}

export type VarReviewKind = "goal" | "penalty" | "redCard";
export type VarReviewDecision = "checking" | "confirmed" | "overturned";

export interface VarReview {
  readonly kind: VarReviewKind;
  readonly side: TeamSide;
  readonly playerId: string | null;
  readonly playerNumber: number | null;
  timerSeconds: number;
  decision: VarReviewDecision;
  /** Contact/offence severity used for the deterministic VAR check. */
  readonly severity: number;
  /** Goal review payload; null for penalties and red cards. */
  readonly goal: {
    readonly scoringSide: TeamSide;
    readonly restartSide: TeamSide;
    readonly ownGoal: boolean;
  } | null;
}

export interface ShootoutKick {
  readonly side: TeamSide;
  readonly playerId: string;
  readonly playerNumber: number;
  readonly scored: boolean;
}

export interface ShootoutState {
  readonly firstSide: TeamSide;
  /** Zero-based kick index across both sides. */
  index: number;
  homeScore: number;
  awayScore: number;
  timerSeconds: number;
  winner: TeamSide | null;
  /** True after the first five kicks per side have been taken. */
  suddenDeath: boolean;
  lastKick: ShootoutKick | null;
  kicks: ShootoutKick[];
}

export interface RefereeState {
  phase: MatchPhase;
  /** 1/2 regulation, 3/4 extra time; meaningful until full-time. */
  half: MatchHalf;
  /** Continuous game clock; extra time starts at 90 and 105 minutes. */
  clockSeconds: number;
  /** Board allowance for the current period, seconds. */
  addedTimeSeconds: number;
  /** Stoppage allowance accumulated but not yet shown on the board. */
  stoppageSeconds: number;
  /** Set once the regulation clock has expired for this period. */
  regulationExpired: boolean;
  scoreHome: number;
  scoreAway: number;
  restart: RestartState | null;
  /** Countdown while dead or at half-time. */
  timerSeconds: number;
  readonly firstKickoffSide: TeamSide;
  /** Runtime for the restart currently in play, cleared on the next restart. */
  setPiece: SetPieceRuntime | null;
  /** Players in an offside position when their team last played the ball. */
  offside: OffsideRuntime | null;
  /** A foul held for the advantage window; converted to a restart on expiry. */
  pendingFoul: PendingFoul | null;
  /** Most recent disciplinary/rule event, mirrored into snapshots. */
  lastEvent: MatchEvent | null;
  eventSeq: number;
  /** Active goalkeeper possession clock; null while nobody is holding it. */
  goalkeeperHold: GoalkeeperHold | null;
  /** Match abandoned/forfeited below seven players. */
  forfeitSide: TeamSide | null;
  /** VAR-lite review currently freezing the match. */
  varReview: VarReview | null;
  /** Penalty shootout runtime; null outside a shootout. */
  shootout: ShootoutState | null;
}

export interface PitchConfig {
  readonly lengthM: number;
  readonly widthM: number;
  readonly goalWidthM: number;
  readonly goalHeightM: number;
  readonly goalPostRadiusM: number;
  readonly goalNetDepthM: number;
  readonly penaltyAreaLengthM: number;
  readonly penaltyAreaWidthM: number;
  readonly goalAreaLengthM: number;
  readonly goalAreaWidthM: number;
  readonly penaltySpotDistanceM: number;
  readonly penaltyArcRadiusM: number;
  readonly cornerArcRadiusM: number;
}

export interface GoalGeometry {
  readonly lineX: number;
  readonly centreY: number;
  /** Direction from the goal line into the net: -1 or +1 on x. */
  readonly netDirection: -1 | 1;
  readonly widthM: number;
  readonly heightM: number;
  readonly postRadiusM: number;
  readonly netDepthM: number;
}

export interface Pitch extends PitchConfig {
  readonly centreX: number;
  readonly centreY: number;
  /** Goal at x = 0, defended by home. */
  readonly homeGoal: GoalGeometry;
  /** Goal at x = length, defended by away. */
  readonly awayGoal: GoalGeometry;
}

export interface MatchState {
  readonly seed: number;
  readonly pitch: Pitch;
  readonly rules: MatchRules;
  readonly home: TeamState;
  readonly away: TeamState;
  readonly stats: MatchStats;
  readonly ball: BallState;
  tick: number;
  elapsedSeconds: number;
  lastTouch: LastTouch | null;
  /**
   * Most recent deliberate pass waiting for the next touch. It lets stats
   * distinguish a completed pass from a loose ball without changing physics.
   */
  passInFlight: {
    readonly side: TeamSide;
    readonly passerId: string;
  } | null;
  /** Receiver of a deliberately played offside run, cleared on any touch. */
  offsidePassTargetId: string | null;
  referee: RefereeState;
}

export interface TeamSetup {
  readonly name?: string;
  readonly colors?: TeamColors;
  readonly formation?: Formation;
}
