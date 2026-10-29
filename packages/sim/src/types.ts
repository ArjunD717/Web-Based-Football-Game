// packages/sim/src/types.ts

import type {
  GoalkeeperAttributes,
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
}

export interface PlayerState {
  readonly id: string;
  readonly team: TeamSide;
  readonly role: PlayerRole;
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
  readonly penalty: string | null;
  readonly freeKick: string | null;
  readonly cornerLeft: string | null;
  readonly cornerRight: string | null;
}

export interface TeamState {
  readonly side: TeamSide;
  readonly name: string;
  readonly colors: TeamColors;
  readonly formation: Formation;
  /** Authored team instructions; all values are validated 0..100 or enums. */
  readonly tactics: TeamTactics;
  readonly takers: TeamSetPieceTakers;
  /** Flipped at half-time when the teams change ends. */
  attackDirection: AttackDirection;
  readonly players: PlayerState[];
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

export type MatchPhase = "deadBall" | "live" | "halfTime" | "fullTime";

export type RestartType =
  | "kickoff"
  | "throwIn"
  | "goalKick"
  | "corner"
  | "directFreeKick"
  | "indirectFreeKick"
  | "penalty";

export type FoulStrictness = "lenient" | "standard" | "strict";

export type CardKind = "yellow" | "red";

export type MatchEventType =
  | "foul"
  | "advantage"
  | "yellowCard"
  | "redCard"
  | "offside"
  | "handball"
  | "penalty";

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
  readonly x: number;
  readonly y: number;
  readonly expiresTick: number;
}

export interface RefereeState {
  phase: MatchPhase;
  /** 1 or 2; meaningful until full-time. */
  half: 1 | 2;
  /** Continuous game clock, 0..90 minutes in seconds. */
  clockSeconds: number;
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
  /** Receiver of a deliberately played offside run, cleared on any touch. */
  offsidePassTargetId: string | null;
  referee: RefereeState;
}

export interface TeamSetup {
  readonly name?: string;
  readonly colors?: TeamColors;
  readonly formation?: Formation;
}
