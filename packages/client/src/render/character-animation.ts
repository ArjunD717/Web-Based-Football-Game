// packages/client/src/render/character-animation.ts

import type { PlayerStateName } from "@fb/sim";
import { computePlayerPose } from "./three-player";
import { VISUAL_TUNING } from "./visualTuning";

export interface BoneRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CharacterPose {
  /** Euler rotations relative to the glTF bind pose, keyed by bone name. */
  readonly rotations: Readonly<Record<string, BoneRotation>>;
  /** Vertical offset of the visual root, in metres. */
  readonly rootLift: number;
  /** Rotation around the local lateral axis; used for falls and slides. */
  readonly bodyTilt: number;
  /** Rotation around the local forward axis; used for running lean. */
  readonly bodyLean: number;
}

const ROT = (x: number, y = 0, z = 0): BoneRotation => ({ x, y, z });

const RAISED_ARM_STATES: Partial<Record<PlayerStateName, true>> = {
  header: true,
  celebrate: true,
  diveLeft: true,
  diveRight: true,
};

const LOCOMOTION_STATES: Partial<Record<PlayerStateName, true>> = {
  idle: true,
  jog: true,
  sprint: true,
  dribble: true,
};

/**
 * Adapt the tested match pose to the authored skeleton.
 *
 * The procedural rig treats the arm angle as a lateral raise. The glTF
 * character starts in an A-pose, so the idle/locomotion arm targets add a
 * constant downward offset and use the remaining angle as a forward/back
 * swing around the shoulder's local X axis. Raises (header/celebration/dive)
 * use the original lateral angle on local Z instead.
 */
export function computeCharacterPose(
  state: PlayerStateName,
  phase: number,
  stamina: number,
  stateAgeSeconds = 0,
): CharacterPose {
  const base = computePlayerPose(state, phase, stamina, stateAgeSeconds);
  const raised = RAISED_ARM_STATES[state] === true;
  const locomotion = LOCOMOTION_STATES[state] === true;
  const armDown = VISUAL_TUNING.authoredPlayer.armDownRadians;
  const swingScale = locomotion ? 1 : 0.38;

  const leftArm = raised
    ? ROT(0, 0, base.leftArm)
    : ROT(base.leftArm * swingScale, 0, armDown);
  const rightArm = raised
    ? ROT(0, 0, base.rightArm)
    : ROT(base.rightArm * swingScale, 0, -armDown);
  const leftElbow = raised ? 0.18 : base.leftElbow;
  const rightElbow = raised ? 0.18 : base.rightElbow;

  return {
    rotations: {
      pelvis: ROT(0, base.bodyTwist * 0.22, 0),
      spine_01: ROT(base.bodyLean * 0.42, base.bodyTwist * 0.42, 0),
      spine_02: ROT(base.bodyLean * 0.32, base.bodyTwist * 0.34, 0),
      spine_03: ROT(base.bodyLean * 0.16, base.bodyTwist * 0.18, 0),
      neck_01: ROT(base.headPitch * 0.45, base.headYaw * 0.45, 0),
      head: ROT(base.headPitch * 0.55, base.headYaw * 0.55, 0),
      thigh_l: ROT(base.leftLeg, 0, 0),
      thigh_r: ROT(base.rightLeg, 0, 0),
      calf_l: ROT(base.leftKnee, 0, 0),
      calf_r: ROT(base.rightKnee, 0, 0),
      upperarm_l: leftArm,
      upperarm_r: rightArm,
      lowerarm_l: ROT(leftElbow, 0, 0),
      lowerarm_r: ROT(rightElbow, 0, 0),
    },
    rootLift: base.bodyY,
    bodyTilt: base.bodyTilt,
    bodyLean: base.bodyLean,
  };
}
