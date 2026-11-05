// packages/client/src/character/pose.ts

/**
 * Presentation-only bone targets for the character lab. Values are local
 * rotations in radians applied on top of the glTF rest pose. The match
 * simulation never reads this module.
 */

export type LabPoseName =
  | "idle"
  | "jog"
  | "sprint"
  | "strike"
  | "leap"
  | "celebrate";

export interface BoneRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PoseFrame {
  readonly rotations: Readonly<Record<string, BoneRotation>>;
  /** Vertical root offset in metres; feet leave the stage during a leap. */
  readonly rootLift: number;
}

const TAU = Math.PI * 2;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const rot = (x: number, y = 0, z = 0): BoneRotation => ({ x, y, z });

export function poseFrame(name: LabPoseName, timeSeconds: number): PoseFrame {
  switch (name) {
    case "jog": {
      const phase = timeSeconds * TAU * 1.55;
      const swing = Math.sin(phase);
      const knee = -0.08 - Math.max(0, -swing) * 0.76;
      const otherKnee = -0.08 - Math.max(0, swing) * 0.76;
      return {
        rotations: {
          thigh_l: rot(swing * 0.58, 0, 0.01),
          thigh_r: rot(-swing * 0.58, 0, -0.01),
          calf_l: rot(knee),
          calf_r: rot(otherKnee),
          upperarm_l: rot(-swing * 0.42, 0, 0.04),
          upperarm_r: rot(swing * 0.42, 0, -0.04),
          lowerarm_l: rot(0.2 + Math.max(0, swing) * 0.24),
          lowerarm_r: rot(0.2 + Math.max(0, -swing) * 0.24),
          spine_01: rot(0.025, swing * 0.03, 0),
          spine_02: rot(0.02, -swing * 0.045, 0),
          neck_01: rot(-0.02),
          head: rot(-0.01, -swing * 0.025, 0),
        },
        rootLift: 0,
      };
    }
    case "sprint": {
      const phase = timeSeconds * TAU * 2.35;
      const swing = Math.sin(phase);
      return {
        rotations: {
          thigh_l: rot(swing * 0.92, 0, 0.015),
          thigh_r: rot(-swing * 0.92, 0, -0.015),
          calf_l: rot(-0.16 - Math.max(0, -swing) * 1.02),
          calf_r: rot(-0.16 - Math.max(0, swing) * 1.02),
          upperarm_l: rot(-swing * 0.82, 0, 0.05),
          upperarm_r: rot(swing * 0.82, 0, -0.05),
          lowerarm_l: rot(0.55 + Math.max(0, swing) * 0.28),
          lowerarm_r: rot(0.55 + Math.max(0, -swing) * 0.28),
          spine_01: rot(0.11, swing * 0.05, 0),
          spine_02: rot(0.07, -swing * 0.075, 0),
          neck_01: rot(-0.09),
          head: rot(-0.04, -swing * 0.03, 0),
        },
        rootLift: Math.abs(swing) * 0.012,
      };
    }
    case "strike": {
      const cycle = (timeSeconds * 0.95) % 1;
      const windup = smoothstep(0.02, 0.34, cycle);
      const contact = smoothstep(0.34, 0.52, cycle);
      const follow = smoothstep(0.52, 0.8, cycle);
      const recover = smoothstep(0.8, 1, cycle);
      const hip = -0.28 * windup + 1.32 * contact - 0.48 * follow;
      const knee = -0.62 + 0.54 * contact - 0.18 * follow;
      return {
        rotations: {
          thigh_l: rot(-0.16 - windup * 0.1),
          thigh_r: rot(hip),
          calf_l: rot(-0.2),
          calf_r: rot(knee),
          upperarm_l: rot(-0.65 - contact * 0.14, 0, 0.08),
          upperarm_r: rot(0.38 + contact * 0.25, 0, -0.1),
          lowerarm_l: rot(0.3),
          lowerarm_r: rot(0.42),
          spine_01: rot(0.02 + follow * 0.04),
          spine_02: rot(-0.03, 0.14 * contact, 0),
          neck_01: rot(0.03),
          head: rot(0.03, -0.08 * contact, 0),
        },
        rootLift: 0.018 * Math.sin(Math.PI * clamp01(cycle / 0.7)) * (1 - recover),
      };
    }
    case "leap": {
      const cycle = (timeSeconds * 0.72) % 1;
      const lift = Math.sin(Math.PI * clamp01(cycle / 0.8));
      const tuck = smoothstep(0.05, 0.35, cycle) * (1 - smoothstep(0.62, 0.92, cycle));
      return {
        rotations: {
          thigh_l: rot(0.45 * tuck + 0.08),
          thigh_r: rot(0.55 * tuck + 0.02),
          calf_l: rot(-0.95 * tuck),
          calf_r: rot(-1.05 * tuck),
          upperarm_l: rot(-0.9 * tuck, 0, 0.16),
          upperarm_r: rot(-0.9 * tuck, 0, -0.16),
          lowerarm_l: rot(0.5),
          lowerarm_r: rot(0.5),
          spine_01: rot(0.08 * tuck),
          spine_02: rot(0.06 * tuck),
          head: rot(-0.08 * lift),
        },
        rootLift: lift * 0.34,
      };
    }
    case "celebrate": {
      const pulse = Math.sin(timeSeconds * TAU * 1.2);
      return {
        rotations: {
          thigh_l: rot(0.03),
          thigh_r: rot(-0.03),
          calf_l: rot(-0.06),
          calf_r: rot(-0.06),
          upperarm_l: rot(-0.25, 0, -2.35),
          upperarm_r: rot(-0.25, 0, 2.35),
          lowerarm_l: rot(0.12),
          lowerarm_r: rot(0.12),
          spine_01: rot(-0.08, 0, pulse * 0.05),
          spine_02: rot(-0.05, 0, -pulse * 0.04),
          neck_01: rot(-0.12),
          head: rot(-0.14, 0, pulse * 0.03),
        },
        rootLift: Math.abs(pulse) * 0.035,
      };
    }
    case "idle":
    default: {
      const breath = Math.sin(timeSeconds * 1.35);
      return {
        rotations: {
          thigh_l: rot(0.01, 0, 0.015),
          thigh_r: rot(-0.01, 0, -0.015),
          calf_l: rot(-0.045),
          calf_r: rot(-0.045),
          upperarm_l: rot(0.015, 0, 0.035),
          upperarm_r: rot(0.015, 0, -0.035),
          lowerarm_l: rot(0.09),
          lowerarm_r: rot(0.09),
          spine_01: rot(breath * 0.008),
          spine_02: rot(breath * 0.012, breath * 0.008, 0),
          neck_01: rot(-breath * 0.006),
          head: rot(breath * 0.008, breath * 0.015, 0),
        },
        rootLift: breath * 0.004,
      };
    }
  }
}
