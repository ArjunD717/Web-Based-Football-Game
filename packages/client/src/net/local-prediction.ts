// packages/client/src/net/local-prediction.ts
import {
  CONTROL_BUTTONS,
  TUNING,
  clamp,
  rotateTowards,
  type SnapshotFrame,
} from "@fb/shared";
import type { MatchView, RenderPlayer } from "../render/view";

/** Minimal input shape; the sent camera-relative frame is accepted as-is. */
export interface PredictionInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly buttons: number;
}

interface PredictedPlayer {
  readonly id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
}

/**
 * Visual-only prediction for the locally controlled player. The simulation and
 * ball remain authoritative; this class only advances the rendered body toward
 * the input, then pulls it back toward the interpolated snapshot. It never
 * feeds state back into the server.
 */
export class LocalPlayerPrediction {
  private predicted: PredictedPlayer | null = null;
  private lastAuthoritativeTick = -1;

  reset(): void {
    this.predicted = null;
    this.lastAuthoritativeTick = -1;
  }

  apply(
    view: MatchView,
    frame: SnapshotFrame,
    input: PredictionInput | null,
    dtSeconds: number,
  ): MatchView {
    const side = view.selfSide;
    if (side === null || view.match === null) {
      this.reset();
      return view;
    }
    const controlledIndex =
      side === "home" ? frame.controlledHome : frame.controlledAway;
    const authoritative =
      controlledIndex >= 0
        ? frame.players[controlledIndex] ?? null
        : null;
    const player = view[side].players.find((entry) => entry.controlled);
    if (player === undefined || authoritative === null) {
      this.reset();
      return view;
    }
    if (view.match.phase !== "live") {
      this.reset();
      return view;
    }

    const dt = clamp(
      dtSeconds,
      0,
      TUNING.presentation.maxFrameDeltaSeconds,
    );
    const delaySeconds =
      TUNING.network.snapshotInterpolationDelayMs / 1_000;
    const margin = TUNING.player.pitchMarginM;
    const authoritativeX = clamp(
      player.x + authoritative.vx * delaySeconds,
      margin,
      view.pitch.lengthM - margin,
    );
    const authoritativeY = clamp(
      player.y + authoritative.vy * delaySeconds,
      margin,
      view.pitch.widthM - margin,
    );

    if (this.predicted === null || this.predicted.id !== player.id) {
      this.lastAuthoritativeTick = -1;
      this.predicted = {
        id: player.id,
        x: authoritativeX,
        y: authoritativeY,
        vx: authoritative.vx,
        vy: authoritative.vy,
        facing: player.facing,
      };
    }

    const predicted = this.predicted;
    const error = Math.hypot(
      predicted.x - authoritativeX,
      predicted.y - authoritativeY,
    );
    const newAuthoritativeTick =
      frame.tick !== this.lastAuthoritativeTick;
    this.lastAuthoritativeTick = frame.tick;
    if (error > TUNING.network.predictionSnapDistanceM) {
      predicted.x = authoritativeX;
      predicted.y = authoritativeY;
      predicted.vx = authoritative.vx;
      predicted.vy = authoritative.vy;
      predicted.facing = player.facing;
    } else if (newAuthoritativeTick) {
      const correction =
        1 -
        Math.exp(
          -TUNING.network.predictionCorrectionPerSecond /
            TUNING.network.snapshotHz,
        );
      predicted.x += (authoritativeX - predicted.x) * correction;
      predicted.y += (authoritativeY - predicted.y) * correction;
    }

    const moveX = input?.moveX ?? 0;
    const moveY = input?.moveY ?? 0;
    const magnitude = Math.min(1, Math.hypot(moveX, moveY));
    const sprint =
      ((input?.buttons ?? 0) & CONTROL_BUTTONS.SPRINT) !== 0;
    const directionX = magnitude > 1e-6 ? moveX / magnitude : 0;
    const directionY = magnitude > 1e-6 ? moveY / magnitude : 0;
    const targetSpeed =
      magnitude *
      TUNING.player.maxTopSpeedMps *
      (sprint ? 1 : TUNING.control.jogSpeedFactor);
    const desiredVx = directionX * targetSpeed;
    const desiredVy = directionY * targetSpeed;
    const acceleration =
      (TUNING.player.timeTo90Fraction *
        TUNING.player.maxTopSpeedMps) /
      TUNING.player.minTimeTo90Seconds;
    const maxDeltaSpeed =
      acceleration *
      (magnitude > 0.05 ? 1 : TUNING.player.brakeAccelerationMultiplier) *
      dt;
    const deltaVx = desiredVx - predicted.vx;
    const deltaVy = desiredVy - predicted.vy;
    const deltaMagnitude = Math.hypot(deltaVx, deltaVy);
    if (deltaMagnitude > maxDeltaSpeed && deltaMagnitude > 0) {
      const scale = maxDeltaSpeed / deltaMagnitude;
      predicted.vx += deltaVx * scale;
      predicted.vy += deltaVy * scale;
    } else {
      predicted.vx = desiredVx;
      predicted.vy = desiredVy;
    }

    predicted.x = clamp(
      predicted.x + predicted.vx * dt,
      margin,
      view.pitch.lengthM - margin,
    );
    predicted.y = clamp(
      predicted.y + predicted.vy * dt,
      margin,
      view.pitch.widthM - margin,
    );
    const speed = Math.hypot(predicted.vx, predicted.vy);
    if (speed > TUNING.player.facingSpeedThresholdMps) {
      predicted.facing = rotateTowards(
        predicted.facing,
        Math.atan2(predicted.vy, predicted.vx),
        TUNING.player.maxTurnRateRadPerS * dt,
      );
    }

    return withPlayer(view, player, {
      x: predicted.x,
      y: predicted.y,
      facing: predicted.facing,
    });
  }
}

function withPlayer(
  view: MatchView,
  original: RenderPlayer,
  patch: Pick<RenderPlayer, "x" | "y" | "facing">,
): MatchView {
  const side = original.team;
  const team = view[side];
  const players = team.players.map((player) =>
    player.id === original.id ? { ...player, ...patch } : player,
  );
  const updatedTeam = { ...team, players };
  return side === "home"
    ? { ...view, home: updatedTeam }
    : { ...view, away: updatedTeam };
}
