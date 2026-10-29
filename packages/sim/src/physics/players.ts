// packages/sim/src/physics/players.ts
import {
  TUNING,
  clamp,
  lerp,
  rotateTowards,
} from "@fb/shared";
import type {
  Pitch,
  PlayerAttributes,
  PlayerState,
  TeamState,
} from "../types";

/** Sprint rating 1..99 maps linearly to the tuned speed band. */
export function topSpeedFor(attributes: PlayerAttributes): number {
  const rating = clamp(attributes.sprintSpeed, 1, 99) / 99;
  return lerp(
    TUNING.player.minTopSpeedMps,
    TUNING.player.maxTopSpeedMps,
    rating,
  );
}

/** Seconds to 90% of top speed; higher acceleration rating is quicker. */
export function timeTo90For(attributes: PlayerAttributes): number {
  const rating = clamp(attributes.acceleration, 1, 99) / 99;
  return lerp(
    TUNING.player.maxTimeTo90Seconds,
    TUNING.player.minTimeTo90Seconds,
    rating,
  );
}

export function accelerationFor(attributes: PlayerAttributes): number {
  return (
    (TUNING.player.timeTo90Fraction * topSpeedFor(attributes)) /
    timeTo90For(attributes)
  );
}

export function turnRateFor(attributes: PlayerAttributes): number {
  const rating = clamp(attributes.agility, 1, 99) / 99;
  return lerp(
    TUNING.player.minTurnRateRadPerS,
    TUNING.player.maxTurnRateRadPerS,
    rating,
  );
}

export function staminaSpeedFactor(player: PlayerState): number {
  return lerp(
    TUNING.player.minStaminaSpeedFactor,
    1,
    clamp(player.stamina, 0, 1),
  );
}

export function tickPlayerTimers(
  players: readonly PlayerState[],
  dt: number,
): void {
  for (const player of players) {
    player.kickCooldown = Math.max(0, player.kickCooldown - dt);
    player.actionTimer = Math.max(0, player.actionTimer - dt);
  }
}

/** Advance every player in a team using the targets assigned by the AI. */
export function updateTeamMovement(
  team: TeamState,
  pitch: Pitch,
  dt: number,
): void {
  for (const player of team.players) {
    const staminaFactor = staminaSpeedFactor(player);
    const maxSpeed = topSpeedFor(player.attributes) * staminaFactor;
    const baseAcceleration = accelerationFor(player.attributes) * staminaFactor;
    const brakingAcceleration =
      baseAcceleration * TUNING.player.brakeAccelerationMultiplier;
    const dx = player.targetX - player.x;
    const dy = player.targetY - player.y;
    const distance = Math.hypot(dx, dy);

    // Cap approach speed by the distance needed to brake. A fixed arrive radius
    // is not enough at sprint speed: players would orbit a stationary target.
    const approachSpeed = Math.sqrt(2 * brakingAcceleration * distance);
    const desiredSpeed = Math.min(player.targetSpeed, maxSpeed, approachSpeed);
    const desiredVx = distance > 1e-6 ? (dx / distance) * desiredSpeed : 0;
    const desiredVy = distance > 1e-6 ? (dy / distance) * desiredSpeed : 0;

    const currentSpeed = Math.hypot(player.vx, player.vy);
    const braking = desiredSpeed < currentSpeed;
    const acceleration =
      braking ? brakingAcceleration : baseAcceleration;
    const maxDeltaSpeed = acceleration * dt;

    let deltaVx = desiredVx - player.vx;
    let deltaVy = desiredVy - player.vy;
    const deltaMagnitude = Math.hypot(deltaVx, deltaVy);
    if (deltaMagnitude > maxDeltaSpeed) {
      const scale = maxDeltaSpeed / deltaMagnitude;
      deltaVx *= scale;
      deltaVy *= scale;
    }
    player.vx += deltaVx;
    player.vy += deltaVy;

    let speed = Math.hypot(player.vx, player.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      player.vx *= scale;
      player.vy *= scale;
      speed = maxSpeed;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const margin = TUNING.player.pitchMarginM;
    if (player.x < margin) {
      player.x = margin;
      player.vx = Math.max(0, player.vx);
    } else if (player.x > pitch.lengthM - margin) {
      player.x = pitch.lengthM - margin;
      player.vx = Math.min(0, player.vx);
    }
    if (player.y < margin) {
      player.y = margin;
      player.vy = Math.max(0, player.vy);
    } else if (player.y > pitch.widthM - margin) {
      player.y = pitch.widthM - margin;
      player.vy = Math.min(0, player.vy);
    }

    const facingTarget =
      speed > TUNING.player.facingSpeedThresholdMps
        ? Math.atan2(player.vy, player.vx)
        : distance > TUNING.player.facingTargetDeadzoneM
          ? Math.atan2(dy, dx)
          : player.facing;
    player.facing = rotateTowards(
      player.facing,
      facingTarget,
      turnRateFor(player.attributes) * dt,
    );

    updateStamina(player, speed, dt);

    if (player.actionTimer <= 0) {
      if (speed >= TUNING.player.sprintThresholdMps) {
        player.state = "sprint";
      } else if (speed >= TUNING.player.jogThresholdMps) {
        player.state = "jog";
      } else {
        player.state = "idle";
      }
    }
  }
}

function updateStamina(player: PlayerState, speed: number, dt: number): void {
  const rating = clamp(player.attributes.stamina, 0, 99) / 99;

  if (speed >= TUNING.player.sprintThresholdMps) {
    const scale = lerp(
      TUNING.player.staminaDrainScaleAtRating1,
      TUNING.player.staminaDrainScaleAtRating99,
      rating,
    );
    player.stamina = Math.max(
      0,
      player.stamina - TUNING.player.staminaDrainPerSecond * scale * dt,
    );
    return;
  }

  const scale = lerp(
    TUNING.player.staminaRecoveryScaleAtRating1,
    TUNING.player.staminaRecoveryScaleAtRating99,
    rating,
  );
  player.stamina = Math.min(
    1,
    player.stamina + TUNING.player.staminaRecoveryPerSecond * scale * dt,
  );
}

/**
 * Resolve horizontal capsule overlaps with a positional correction. Velocity is
 * left alone so contact does not add free energy to the match.
 */
export function resolvePlayerCollisions(
  homePlayers: readonly PlayerState[],
  awayPlayers: readonly PlayerState[],
): void {
  for (let i = 0; i < homePlayers.length; i += 1) {
    const home = homePlayers[i];
    if (home === undefined) {
      continue;
    }
    for (let j = i + 1; j < homePlayers.length; j += 1) {
      const other = homePlayers[j];
      if (other !== undefined) {
        resolvePair(home, other);
      }
    }
    for (const away of awayPlayers) {
      resolvePair(home, away);
    }
  }

  for (let i = 0; i < awayPlayers.length; i += 1) {
    const away = awayPlayers[i];
    if (away === undefined) {
      continue;
    }
    for (let j = i + 1; j < awayPlayers.length; j += 1) {
      const other = awayPlayers[j];
      if (other !== undefined) {
        resolvePair(away, other);
      }
    }
  }
}

function resolvePair(a: PlayerState, b: PlayerState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDistance = TUNING.player.radiusM * 2;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minDistance * minDistance) {
    return;
  }

  if (distanceSquared < 1e-12) {
    b.x += minDistance / 2;
    a.x -= minDistance / 2;
    return;
  }

  const distance = Math.sqrt(distanceSquared);
  const overlap = (minDistance - distance) / 2;
  const nx = dx / distance;
  const ny = dy / distance;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;
}
