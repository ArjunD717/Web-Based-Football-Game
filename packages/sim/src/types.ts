// packages/sim/src/types.ts

import type { PlayerStateName } from "@fb/shared";
export type { PlayerStateName } from "@fb/shared";

export type TeamSide = "home" | "away";

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

/** Placeholder M1 ratings; the full FC attribute set arrives with data import. */
export interface PlayerAttributes {
  readonly sprintSpeed: number;
  readonly acceleration: number;
  readonly agility: number;
  readonly stamina: number;
  readonly ballControl: number;
}

export interface PlayerState {
  readonly id: string;
  readonly team: TeamSide;
  readonly role: PlayerRole;
  readonly number: number;
  readonly attributes: PlayerAttributes;
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

export interface TeamState {
  readonly side: TeamSide;
  readonly name: string;
  readonly colors: TeamColors;
  readonly formation: Formation;
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

export type RestartType = "kickoff" | "throwIn" | "goalKick" | "corner";

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
}

export interface RestartState {
  readonly type: RestartType;
  readonly side: TeamSide;
  /** Ball placement in pitch metres. */
  readonly x: number;
  readonly y: number;
}

export interface ThrowInTracker {
  readonly side: TeamSide;
  readonly playerId: string;
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
  /**
   * The thrower of an active throw-in. A direct goal remains disallowed until
   * another player touches the ball; M5 replaces this with the full foul law.
   */
  throwIn: ThrowInTracker | null;
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
  readonly ball: BallState;
  tick: number;
  elapsedSeconds: number;
  lastTouch: LastTouch | null;
  referee: RefereeState;
}

export interface TeamSetup {
  readonly name?: string;
  readonly colors?: TeamColors;
  readonly formation?: Formation;
}
