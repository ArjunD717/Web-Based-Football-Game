// packages/client/src/camera/context/contextShots.ts

import type { SnapshotEvent, SnapshotRestartType } from "@fb/shared";
import type { TeamSide } from "@fb/sim";
import { pitchToWorld } from "../../render/three-layout";
import type { MatchView, RenderPlayer } from "../../render/view";
import { cameraSideSign, clamp01 } from "../cameraMath";
import { CAMERA_TUNING, type CameraTuning } from "../cameraTuning";
import type {
  CameraPose,
  CameraRenderState,
  CameraShot,
  CameraShotDebug,
  CameraVec3,
} from "../types";

export interface ContextShot extends CameraShot {
  readonly durationSeconds: number;
}

interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

const TAU = Math.PI * 2;

abstract class TimedShot implements ContextShot {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly blendSeconds: number;
  abstract readonly durationSeconds: number;
  protected elapsedSeconds = 0;

  enter(_state: CameraRenderState): void {
    this.elapsedSeconds = 0;
  }

  update(dt: number, state: CameraRenderState): CameraPose {
    this.elapsedSeconds = Math.max(
      0,
      Math.min(this.durationSeconds, this.elapsedSeconds + dt),
    );
    return this.pose(state);
  }

  exit(): void {
    this.elapsedSeconds = 0;
  }

  debug(): CameraShotDebug {
    return { zoom: 0 };
  }

  protected abstract pose(state: CameraRenderState): CameraPose;
}

/** Wide establishing shot used at kick-off and after the players reset. */
export class KickoffShot extends TimedShot {
  readonly id = "kickoff";
  readonly label = "Kick-off";

  constructor(private readonly tuning: CameraTuning = CAMERA_TUNING) {
    super();
  }

  get durationSeconds(): number {
    return this.tuning.context.kickoffDurationSeconds;
  }

  get blendSeconds(): number {
    return this.tuning.context.kickoffBlendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const { pitch, view } = state;
    const context = this.tuning.context;
    const side = cameraSideSign(view.selfSide, view.half);
    const camera = localToWorld(
      pitch,
      { x: pitch.centreX, y: pitch.centreY + side * (pitch.widthM / 2 + context.kickoffSetbackM) },
      context.kickoffHeightM,
    );
    const target = localToWorld(
      pitch,
      { x: pitch.centreX, y: pitch.centreY },
      0,
    );
    return { position: camera, target, fovDegrees: context.kickoffFovDegrees };
  }
}

/** Shared framings for the six law restarts. */
export class RestartShot extends TimedShot {
  readonly id: string;
  readonly label: string;

  constructor(
    readonly restartType: Exclude<SnapshotRestartType, "kickoff">,
    private readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    super();
    this.id = `restart-${restartType}`;
    this.label = restartLabel(restartType);
  }

  get durationSeconds(): number {
    switch (this.restartType) {
      case "throwIn":
        return this.tuning.context.throwInDurationSeconds;
      case "goalKick":
        return this.tuning.context.goalKickDurationSeconds;
      case "corner":
        return this.tuning.context.cornerDurationSeconds;
      case "directFreeKick":
      case "indirectFreeKick":
        return this.tuning.context.freeKickDurationSeconds;
      case "penalty":
        return this.tuning.context.penaltyDurationSeconds;
      case "dropBall":
        return this.tuning.context.throwInDurationSeconds;
    }
  }

  get blendSeconds(): number {
    return this.tuning.context.restartBlendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const view = state.view;
    const pitch = state.pitch;
    const ball = { x: view.ball.x, y: view.ball.y };
    const side = this.sideFor(view);
    const attack = cameraSideSign(side, view.half);
    const attackingGoalX = attack === 1 ? pitch.lengthM : 0;
    const goalCentre = { x: attackingGoalX, y: pitch.centreY };
    const penaltySpot = {
      x: attackingGoalX - attack * pitch.penaltySpotDistanceM,
      y: pitch.centreY,
    };

    switch (this.restartType) {
      case "throwIn":
        return this.throwIn(state, ball, attack);
      case "goalKick":
        return this.goalKick(state, attack);
      case "corner":
        return this.corner(state, ball, penaltySpot);
      case "directFreeKick":
      case "indirectFreeKick":
        return this.freeKick(state, ball, goalCentre);
      case "penalty":
        return this.penalty(state, ball, goalCentre);
      case "dropBall":
      default:
        return this.calmRestart(state, ball);
    }
  }

  private throwIn(
    state: CameraRenderState,
    ball: LocalPoint,
    attack: 1 | -1,
  ): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const outward = ball.y <= pitch.centreY ? -1 : 1;
    const camera = localToWorld(
      pitch,
      { x: ball.x, y: ball.y + outward * context.restartSetbackM },
      context.restartHeightM,
    );
    const target = localToWorld(
      pitch,
      {
        x: ball.x + attack * context.restartLookAheadM,
        y: pitch.centreY,
      },
      0,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.restartFovDegrees,
    };
  }

  private goalKick(state: CameraRenderState, attack: 1 | -1): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const ownGoalX = attack === 1 ? 0 : pitch.lengthM;
    const camera = localToWorld(
      pitch,
      {
        x: ownGoalX - attack * context.goalKickSetbackM,
        y: pitch.centreY,
      },
      context.goalKickHeightM,
    );
    const target = localToWorld(
      pitch,
      {
        x: pitch.centreX + attack * context.restartLookAheadM,
        y: pitch.centreY,
      },
      0,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.goalKickFovDegrees,
    };
  }

  private corner(
    state: CameraRenderState,
    ball: LocalPoint,
    penaltySpot: LocalPoint,
  ): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const away = unitFrom(penaltySpot, ball);
    const camera = localToWorld(
      pitch,
      {
        x: ball.x + away.x * context.restartSetbackM,
        y: ball.y + away.y * context.restartSetbackM,
      },
      context.restartHeightM,
    );
    const target = localToWorld(
      pitch,
      penaltySpot,
      context.restartTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.restartFovDegrees,
    };
  }

  private freeKick(
    state: CameraRenderState,
    ball: LocalPoint,
    goalCentre: LocalPoint,
  ): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const away = unitFrom(goalCentre, ball);
    const camera = localToWorld(
      pitch,
      {
        x: ball.x + away.x * context.restartSetbackM,
        y: ball.y + away.y * context.restartSetbackM,
      },
      context.restartHeightM,
    );
    const target = localToWorld(
      pitch,
      goalCentre,
      context.restartTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.restartFovDegrees,
    };
  }

  private penalty(
    state: CameraRenderState,
    ball: LocalPoint,
    goalCentre: LocalPoint,
  ): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const away = unitFrom(goalCentre, ball);
    const camera = localToWorld(
      pitch,
      {
        x: ball.x + away.x * context.restartSetbackM,
        y: ball.y + away.y * context.restartSetbackM,
      },
      context.restartHeightM,
    );
    const target = localToWorld(
      pitch,
      goalCentre,
      context.restartTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.restartFovDegrees,
    };
  }

  private calmRestart(
    state: CameraRenderState,
    ball: LocalPoint,
  ): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const camera = localToWorld(
      pitch,
      { x: ball.x, y: pitch.centreY + pitch.widthM / 2 + context.calmSetbackM },
      context.calmHeightM,
    );
    const target = localToWorld(pitch, ball, 0);
    return {
      position: camera,
      target,
      fovDegrees: context.calmFovDegrees,
    };
  }

  private sideFor(view: MatchView): TeamSide {
    return view.match?.restartSide ?? view.selfSide ?? "home";
  }
}

/** Low, close orbit around the scorer after the ball crosses the line. */
export class GoalCelebrationShot extends TimedShot {
  readonly id = "goal-celebration";
  readonly label = "Goal celebration";

  constructor(
    private readonly scorer: LocalPoint,
    private readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    super();
  }

  get durationSeconds(): number {
    return this.tuning.context.celebrationDurationSeconds;
  }

  get blendSeconds(): number {
    return this.tuning.context.celebrationBlendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const swing = clamp01(this.elapsedSeconds / this.durationSeconds);
    const angle =
      swing * TAU * context.celebrationOrbits + Math.PI * 0.5;
    const camera = localToWorld(
      pitch,
      {
        x: this.scorer.x + Math.cos(angle) * context.celebrationRadiusM,
        y: this.scorer.y + Math.sin(angle) * context.celebrationRadiusM,
      },
      context.celebrationHeightM,
    );
    const target = localToWorld(
      pitch,
      this.scorer,
      context.celebrationTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.celebrationFovDegrees,
    };
  }
}

/** Close push-in on a foul, card or injury. */
export class IncidentShot extends TimedShot {
  readonly id = "incident";
  readonly label = "Incident";

  constructor(
    private readonly player: LocalPoint,
    private readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    super();
  }

  get durationSeconds(): number {
    return this.tuning.context.incidentDurationSeconds;
  }

  get blendSeconds(): number {
    return this.tuning.context.incidentBlendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const sideline = this.player.y <= pitch.centreY ? -1 : 1;
    const camera = localToWorld(
      pitch,
      {
        x: this.player.x,
        y: this.player.y + sideline * context.incidentSetbackM,
      },
      context.incidentHeightM,
    );
    const target = localToWorld(
      pitch,
      this.player,
      context.incidentTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.incidentFovDegrees,
    };
  }
}

/** Calm wide view for substitutions and half-time. */
export class CalmShot extends TimedShot {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly options: {
      readonly id: string;
      readonly label: string;
      readonly durationSeconds: number;
      readonly blendSeconds: number;
      readonly fovDegrees: number;
    },
    private readonly tuning: CameraTuning = CAMERA_TUNING,
  ) {
    super();
    this.id = options.id;
    this.label = options.label;
  }

  get durationSeconds(): number {
    return this.options.durationSeconds;
  }

  get blendSeconds(): number {
    return this.options.blendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const side = cameraSideSign(state.view.selfSide, state.view.half);
    const camera = localToWorld(
      pitch,
      {
        x: pitch.centreX,
        y: pitch.centreY + side * (pitch.widthM / 2 + context.calmSetbackM),
      },
      context.calmHeightM,
    );
    const target = localToWorld(pitch, {
      x: pitch.centreX,
      y: pitch.centreY,
    }, 0);
    return {
      position: camera,
      target,
      fovDegrees: this.options.fovDegrees,
    };
  }
}

/** Slow full-time orbit around the centre circle. */
export class FullTimeShot extends TimedShot {
  readonly id = "full-time";
  readonly label = "Full-time";

  constructor(private readonly tuning: CameraTuning = CAMERA_TUNING) {
    super();
  }

  get durationSeconds(): number {
    return this.tuning.context.fullTimeDurationSeconds;
  }

  get blendSeconds(): number {
    return this.tuning.context.fullTimeBlendSeconds;
  }

  protected pose(state: CameraRenderState): CameraPose {
    const context = this.tuning.context;
    const pitch = state.pitch;
    const swing = clamp01(this.elapsedSeconds / this.durationSeconds);
    const angle = swing * TAU * context.fullTimeOrbits;
    const camera = localToWorld(
      pitch,
      {
        x: pitch.centreX + Math.cos(angle) * context.fullTimeRadiusM,
        y: pitch.centreY + Math.sin(angle) * context.fullTimeRadiusM,
      },
      context.fullTimeHeightM,
    );
    const target = localToWorld(
      pitch,
      { x: pitch.centreX, y: pitch.centreY },
      context.fullTimeTargetHeightM,
    );
    return {
      position: camera,
      target,
      fovDegrees: context.fullTimeFovDegrees,
    };
  }
}

export function createKickoffShot(tuning = CAMERA_TUNING): ContextShot {
  return new KickoffShot(tuning);
}

export function createRestartShot(
  restartType: Exclude<SnapshotRestartType, "kickoff">,
  tuning = CAMERA_TUNING,
): ContextShot {
  return new RestartShot(restartType, tuning);
}

export function createIncidentShot(
  player: LocalPoint,
  tuning = CAMERA_TUNING,
): ContextShot {
  return new IncidentShot(player, tuning);
}

export function createSubstitutionShot(tuning = CAMERA_TUNING): ContextShot {
  return new CalmShot(
    {
      id: "substitution",
      label: "Substitution",
      durationSeconds: tuning.context.substitutionDurationSeconds,
      blendSeconds: tuning.context.substitutionBlendSeconds,
      fovDegrees: tuning.context.substitutionFovDegrees,
    },
    tuning,
  );
}

export function createHalfTimeShot(tuning = CAMERA_TUNING): ContextShot {
  return new CalmShot(
    {
      id: "half-time",
      label: "Half-time",
      durationSeconds: tuning.context.halfTimeDurationSeconds,
      blendSeconds: tuning.context.halfTimeBlendSeconds,
      fovDegrees: tuning.context.calmFovDegrees,
    },
    tuning,
  );
}

export function findPlayerPoint(
  view: MatchView,
  event: SnapshotEvent,
): LocalPoint {
  const team = event.side === "home" ? view.home : view.away;
  const player = team.players.find(
    (candidate) => candidate.number === event.playerNumber,
  );
  return player === undefined
    ? { x: view.ball.x, y: view.ball.y }
    : { x: player.x, y: player.y };
}

export function restartLabel(type: SnapshotRestartType): string {
  switch (type) {
    case "throwIn":
      return "Throw-in";
    case "goalKick":
      return "Goal kick";
    case "corner":
      return "Corner";
    case "directFreeKick":
      return "Free kick";
    case "indirectFreeKick":
      return "Indirect free kick";
    case "penalty":
      return "Penalty";
    case "dropBall":
      return "Drop ball";
    case "kickoff":
      return "Kick-off";
  }
}

function localToWorld(
  pitch: CameraRenderState["pitch"],
  point: LocalPoint,
  height: number,
): CameraVec3 {
  return pitchToWorld(pitch, point.x, point.y, height);
}

function unitFrom(
  from: LocalPoint,
  to: LocalPoint,
): { readonly x: number; readonly y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length <= 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
}

export function nearestPlayer(
  view: MatchView,
  side: TeamSide,
  point: LocalPoint,
): RenderPlayer | null {
  let best: RenderPlayer | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const team = side === "home" ? view.home : view.away;
  for (const player of team.players) {
    if (player.sentOff) {
      continue;
    }
    const distance =
      (player.x - point.x) ** 2 + (player.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best;
}
