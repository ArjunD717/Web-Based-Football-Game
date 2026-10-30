// packages/sim/src/physics/ball.ts
import { TUNING, clamp } from "@fb/shared";
import type {
  BallState,
  GoalGeometry,
  PlayerState,
  Pitch,
} from "../types";

export interface BallContact {
  readonly playerId: string;
  readonly team: "home" | "away";
  readonly playerNumber: number;
  /** Ball height when contact was resolved, metres. */
  readonly ballHeightM: number;
  /** Relative closing speed between ball and player, m/s. */
  readonly relativeSpeedMps: number;
  readonly contactX: number;
  readonly contactY: number;
}

export interface KickSpec {
  readonly targetX: number;
  readonly targetY: number;
  readonly speed: number;
  readonly lift: number;
  readonly spinX?: number;
  readonly spinY?: number;
  readonly spinZ?: number;
  /** Fraction of the kicker's velocity added to the ball. */
  readonly velocityTransfer?: number;
}

const BALL = TUNING.ball;
const BALL_RADIUS = BALL.radiusM;
const CROSS_SECTION_M2 = Math.PI * BALL_RADIUS * BALL_RADIUS;
/** 0.5 · ρ · Cd · A / m, units 1/m; multiplied by speed for deceleration. */
const DRAG_ACCEL_FACTOR =
  (0.5 * BALL.airDensityKgPerM3 * BALL.dragCoefficient * CROSS_SECTION_M2) /
  BALL.massKg;
/** 0.5 · ρ · A · Cl_slope · r / m, converts ω × v into acceleration. */
const MAGNUS_ACCEL_FACTOR =
  (0.5 *
    BALL.airDensityKgPerM3 *
    CROSS_SECTION_M2 *
    BALL.magnusLiftSlope *
    BALL_RADIUS) /
  BALL.massKg;

/**
 * Advance the ball with fixed substeps so fast shots cannot tunnel through
 * posts or players. The caller still supplies the authoritative 60 Hz tick.
 */
export function stepBall(
  ball: BallState,
  homePlayers: readonly PlayerState[],
  awayPlayers: readonly PlayerState[],
  pitch: Pitch,
  dt: number,
): BallContact | null {
  const speed = ballSpeed(ball);
  const steps = Math.min(
    BALL.maxSubsteps,
    Math.max(1, Math.ceil((speed * dt) / BALL.maxSubstepTravelM)),
  );
  const subDt = dt / steps;
  let contact: BallContact | null = null;

  for (let step = 0; step < steps; step += 1) {
    integrateForces(ball, subDt);
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;
    ball.z += ball.vz * subDt;

    resolveGround(ball, subDt);
    resolveGoalFrames(ball, pitch, subDt);
    contact =
      resolvePlayerContacts(ball, homePlayers, awayPlayers) ?? contact;
  }

  clampBallSpeed(ball);
  clampSpin(ball);
  return contact;
}

/** Apply a kick, clearing the kicker's body so the ball cannot stick. */
export function kickBall(
  ball: BallState,
  player: PlayerState,
  spec: KickSpec,
): void {
  let dx = spec.targetX - ball.x;
  let dy = spec.targetY - ball.y;
  let distance = Math.hypot(dx, dy);
  if (distance < 1e-6) {
    dx = Math.cos(player.facing);
    dy = Math.sin(player.facing);
    distance = 1;
  }

  const dirX = dx / distance;
  const dirY = dy / distance;
  const clearance =
    TUNING.player.radiusM + BALL_RADIUS + BALL.kickClearanceM;
  ball.x = player.x + dirX * clearance;
  ball.y = player.y + dirY * clearance;
  ball.z = BALL_RADIUS;

  const transfer =
    spec.velocityTransfer ?? BALL.kickPlayerVelocityTransfer;
  ball.vx = dirX * spec.speed + player.vx * transfer;
  ball.vy = dirY * spec.speed + player.vy * transfer;
  ball.vz = spec.lift;
  ball.spinX = clamp(spec.spinX ?? 0, -BALL.maxSpinRadPerS, BALL.maxSpinRadPerS);
  ball.spinY = clamp(spec.spinY ?? 0, -BALL.maxSpinRadPerS, BALL.maxSpinRadPerS);
  ball.spinZ = clamp(spec.spinZ ?? 0, -BALL.maxSpinRadPerS, BALL.maxSpinRadPerS);
  clampBallSpeed(ball);
}

function integrateForces(ball: BallState, dt: number): void {
  const speed = ballSpeed(ball);
  if (speed > 0) {
    const drag = DRAG_ACCEL_FACTOR * speed;
    ball.vx -= drag * ball.vx * dt;
    ball.vy -= drag * ball.vy * dt;
    ball.vz -= drag * ball.vz * dt;
  }

  if (ball.z > BALL_RADIUS + 1e-6) {
    const ax =
      MAGNUS_ACCEL_FACTOR *
      (ball.spinY * ball.vz - ball.spinZ * ball.vy);
    const ay =
      MAGNUS_ACCEL_FACTOR *
      (ball.spinZ * ball.vx - ball.spinX * ball.vz);
    const az =
      MAGNUS_ACCEL_FACTOR *
      (ball.spinX * ball.vy - ball.spinY * ball.vx);
    ball.vx += ax * dt;
    ball.vy += ay * dt;
    ball.vz += az * dt;
  }

  ball.vz -= BALL.gravityMps2 * dt;

  const spinDecay = Math.exp(-BALL.spinDecayPerSecond * dt);
  ball.spinX *= spinDecay;
  ball.spinY *= spinDecay;
  ball.spinZ *= spinDecay;
}

function resolveGround(ball: BallState, dt: number): void {
  if (ball.z <= BALL_RADIUS) {
    const impactVz = ball.vz;
    ball.z = BALL_RADIUS;

    if (impactVz < 0) {
      ball.vx *= BALL.groundTangentialRetention;
      ball.vy *= BALL.groundTangentialRetention;
      const bounce = -impactVz * BALL.groundRestitution;
      ball.vz = bounce < BALL.minBounceSpeedMps ? 0 : bounce;
    }
  }

  if (ball.z <= BALL_RADIUS + 1e-9 && ball.vz <= 0) {
    ball.vz = 0;
    ball.z = BALL_RADIUS;

    const horizontalSpeed = Math.hypot(ball.vx, ball.vy);
    if (horizontalSpeed <= BALL.settleSpeedMps) {
      ball.vx = 0;
      ball.vy = 0;
      ball.spinX = 0;
      ball.spinY = 0;
      ball.spinZ = 0;
      return;
    }

    const speedAfterResistance = Math.max(
      0,
      horizontalSpeed - BALL.rollingResistanceMps2 * dt,
    );
    if (speedAfterResistance <= BALL.settleSpeedMps) {
      ball.vx = 0;
      ball.vy = 0;
    } else {
      const scale = speedAfterResistance / horizontalSpeed;
      ball.vx *= scale;
      ball.vy *= scale;
    }

    // Rolling without slipping: ω = (-vy/r, vx/r, 0).
    ball.spinX = -ball.vy / BALL_RADIUS;
    ball.spinY = ball.vx / BALL_RADIUS;
    ball.spinZ = 0;
  }
}

function resolveGoalFrames(ball: BallState, pitch: Pitch, dt: number): void {
  resolveGoalFrame(ball, pitch.homeGoal, dt);
  resolveGoalFrame(ball, pitch.awayGoal, dt);
}

function resolveGoalFrame(
  ball: BallState,
  goal: GoalGeometry,
  dt: number,
): void {
  resolvePost(ball, goal, goal.centreY - goal.widthM / 2);
  resolvePost(ball, goal, goal.centreY + goal.widthM / 2);
  resolveCrossbar(ball, goal);
  resolveNet(ball, goal, dt);
}

function resolvePost(
  ball: BallState,
  goal: GoalGeometry,
  postY: number,
): void {
  const closestZ = clamp(ball.z, 0, goal.heightM);
  const dx = ball.x - goal.lineX;
  const dy = ball.y - postY;
  const dz = ball.z - closestZ;
  const minDistance = BALL_RADIUS + goal.postRadiusM;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared >= minDistance * minDistance) {
    return;
  }

  if (distanceSquared < 1e-12) {
    ball.x = goal.lineX + minDistance;
    return;
  }

  const distance = Math.sqrt(distanceSquared);
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const correction = minDistance - distance;
  ball.x += nx * correction;
  ball.y += ny * correction;
  ball.z += nz * correction;
  reflectBall(ball, nx, ny, nz, BALL.postRestitution);
}

function resolveCrossbar(ball: BallState, goal: GoalGeometry): void {
  const minY = goal.centreY - goal.widthM / 2;
  const maxY = goal.centreY + goal.widthM / 2;
  const closestY = clamp(ball.y, minY, maxY);
  const dx = ball.x - goal.lineX;
  const dy = ball.y - closestY;
  const dz = ball.z - goal.heightM;
  const minDistance = BALL_RADIUS + goal.postRadiusM;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared >= minDistance * minDistance) {
    return;
  }

  if (distanceSquared < 1e-12) {
    ball.x = goal.lineX + minDistance;
    return;
  }

  const distance = Math.sqrt(distanceSquared);
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const correction = minDistance - distance;
  ball.x += nx * correction;
  ball.y += ny * correction;
  ball.z += nz * correction;
  reflectBall(ball, nx, ny, nz, BALL.postRestitution);
}

function resolveNet(ball: BallState, goal: GoalGeometry, dt: number): void {
  const sideMinY = goal.centreY - goal.widthM / 2;
  const sideMaxY = goal.centreY + goal.widthM / 2;
  const backX = goal.lineX + goal.netDirection * goal.netDepthM;
  const minX = Math.min(goal.lineX, backX);
  const maxX = Math.max(goal.lineX, backX);
  const behindLine =
    goal.netDirection === -1 ? ball.x < goal.lineX : ball.x > goal.lineX;

  if (!behindLine) {
    return;
  }

  const nearMouth =
    ball.y > sideMinY - BALL_RADIUS && ball.y < sideMaxY + BALL_RADIUS;
  const nearHeight = ball.z < goal.heightM + BALL_RADIUS;
  if (!nearMouth || !nearHeight) {
    return;
  }

  const insideVolume =
    ball.x > minX && ball.x < maxX &&
    ball.y > sideMinY && ball.y < sideMaxY &&
    ball.z < goal.heightM;
  if (insideVolume) {
    const damping = Math.exp(-BALL.netDampingPerSecond * dt);
    ball.vx *= damping;
    ball.vy *= damping;
    ball.vz *= damping;
  }

  if (goal.netDirection === -1 && ball.x - BALL_RADIUS < backX) {
    ball.x = backX + BALL_RADIUS;
    if (ball.vx < 0) {
      ball.vx = -ball.vx * BALL.netRestitution;
      ball.vy *= BALL.netTangentialRetention;
      ball.vz *= BALL.netTangentialRetention;
    }
  } else if (goal.netDirection === 1 && ball.x + BALL_RADIUS > backX) {
    ball.x = backX - BALL_RADIUS;
    if (ball.vx > 0) {
      ball.vx = -ball.vx * BALL.netRestitution;
      ball.vy *= BALL.netTangentialRetention;
      ball.vz *= BALL.netTangentialRetention;
    }
  }

  const betweenPosts =
    ball.y > sideMinY - BALL_RADIUS && ball.y < sideMaxY + BALL_RADIUS;
  if (ball.x > minX && ball.x < maxX && betweenPosts) {
    if (ball.y - BALL_RADIUS < sideMinY) {
      ball.y = sideMinY + BALL_RADIUS;
      if (ball.vy < 0) {
        ball.vy = -ball.vy * BALL.netRestitution;
      }
    } else if (ball.y + BALL_RADIUS > sideMaxY) {
      ball.y = sideMaxY - BALL_RADIUS;
      if (ball.vy > 0) {
        ball.vy = -ball.vy * BALL.netRestitution;
      }
    }

    if (ball.z + BALL_RADIUS > goal.heightM) {
      ball.z = goal.heightM - BALL_RADIUS;
      if (ball.vz > 0) {
        ball.vz = -ball.vz * BALL.netRestitution;
      }
    }
  }
}

function resolvePlayerContacts(
  ball: BallState,
  homePlayers: readonly PlayerState[],
  awayPlayers: readonly PlayerState[],
): BallContact | null {
  const homeContact = resolveContactsForTeam(ball, homePlayers);
  const awayContact = resolveContactsForTeam(ball, awayPlayers);
  return awayContact ?? homeContact;
}

function resolveContactsForTeam(
  ball: BallState,
  players: readonly PlayerState[],
): BallContact | null {
  let contact: BallContact | null = null;

  for (const player of players) {
    if (player.sentOff || player.unavailable) {
      continue;
    }
    if (ball.z - BALL_RADIUS > TUNING.player.heightM) {
      continue;
    }

    let dx = ball.x - player.x;
    let dy = ball.y - player.y;
    let distance = Math.hypot(dx, dy);
    const minDistance = BALL_RADIUS + TUNING.player.radiusM;
    if (distance >= minDistance) {
      continue;
    }

    if (distance < 1e-9) {
      dx = Math.cos(player.facing);
      dy = Math.sin(player.facing);
      distance = 1;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    ball.x = player.x + nx * minDistance;
    ball.y = player.y + ny * minDistance;

    const relativeVx = ball.vx - player.vx;
    const relativeVy = ball.vy - player.vy;
    const normalSpeed = relativeVx * nx + relativeVy * ny;
    if (normalSpeed < 0) {
      const impulse = (1 + BALL.playerRestitution) * normalSpeed;
      ball.vx -= impulse * nx;
      ball.vy -= impulse * ny;
    }
    ball.vx += player.vx * BALL.playerVelocityTransfer;
    ball.vy += player.vy * BALL.playerVelocityTransfer;

    contact = {
      playerId: player.id,
      team: player.team,
      playerNumber: player.number,
      ballHeightM: ball.z,
      relativeSpeedMps: Math.hypot(relativeVx, relativeVy),
      contactX: ball.x,
      contactY: ball.y,
    };
  }

  return contact;
}

function reflectBall(
  ball: BallState,
  nx: number,
  ny: number,
  nz: number,
  restitution: number,
): void {
  const normalSpeed =
    ball.vx * nx + ball.vy * ny + ball.vz * nz;
  if (normalSpeed >= 0) {
    return;
  }
  const impulse = (1 + restitution) * normalSpeed;
  ball.vx -= impulse * nx;
  ball.vy -= impulse * ny;
  ball.vz -= impulse * nz;
}

function ballSpeed(ball: BallState): number {
  return Math.hypot(ball.vx, ball.vy, ball.vz);
}

function clampBallSpeed(ball: BallState): void {
  const speed = ballSpeed(ball);
  if (speed > BALL.maxSpeedMps) {
    const scale = BALL.maxSpeedMps / speed;
    ball.vx *= scale;
    ball.vy *= scale;
    ball.vz *= scale;
  }
}

function clampSpin(ball: BallState): void {
  ball.spinX = clamp(
    ball.spinX,
    -BALL.maxSpinRadPerS,
    BALL.maxSpinRadPerS,
  );
  ball.spinY = clamp(
    ball.spinY,
    -BALL.maxSpinRadPerS,
    BALL.maxSpinRadPerS,
  );
  ball.spinZ = clamp(
    ball.spinZ,
    -BALL.maxSpinRadPerS,
    BALL.maxSpinRadPerS,
  );
}
