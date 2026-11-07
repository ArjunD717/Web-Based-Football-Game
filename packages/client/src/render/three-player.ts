// packages/client/src/render/three-player.ts

import * as THREE from "three";
import { clamp } from "@fb/shared";
import type { Pitch } from "@fb/sim";
import type { PlayerStateName } from "@fb/sim";
import { disposeObject } from "./three-dispose";
import { facingToRotationY, pitchToWorld } from "./three-layout";
import { VISUAL_TUNING } from "./visualTuning";
import type { PlayerDetail } from "./player-lod";
import type { RenderPlayer, RenderTeamColors } from "./view";

export interface PlayerPose {
  /** Hip rotation around the lateral axis; positive swings forward. */
  readonly leftLeg: number;
  readonly rightLeg: number;
  /** Knee flexion; negative bends the lower leg behind the thigh. */
  readonly leftKnee: number;
  readonly rightKnee: number;
  /** Shoulder rotation around the lateral axis; positive swings forward. */
  readonly leftArm: number;
  readonly rightArm: number;
  /** Elbow flexion; positive brings the forearm forward. */
  readonly leftElbow: number;
  readonly rightElbow: number;
  readonly bodyY: number;
  /** Sideways tilt used by falls and slides. */
  readonly bodyTilt: number;
  /** Forward/back lean around the local lateral axis. */
  readonly bodyLean: number;
  /** Counter-rotation of the torso against the legs. */
  readonly bodyTwist: number;
  /** Nod around the neck's lateral axis. */
  readonly headPitch: number;
  /** Head turn toward the running direction. */
  readonly headYaw: number;
}

const clamp01 = (value: number): number => clamp(value, 0, 1);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

interface KickPose {
  readonly hip: number;
  readonly knee: number;
}

/**
 * One-shot kicking cycle. The state timer is 0.4 s, so the strike lands just
 * after half-way and the follow-through settles without snapping back.
 */
function kickPose(stateAgeSeconds: number, power: number): KickPose {
  const progress = clamp01(stateAgeSeconds / 0.4);
  const swing = smoothstep(0.06, 0.55, progress);
  const followThrough = smoothstep(0.78, 1, progress);
  return {
    hip: -0.45 + (1.6 + power * 0.25) * swing - 0.35 * followThrough,
    knee: lerp(-0.9, -0.05, smoothstep(0.16, 0.52, progress)),
  };
}

/**
 * Pose math is kept pure and separate from Three.js so animation behaviour can
 * be tested without a WebGL context. `stateAgeSeconds` drives one-shot actions;
 * locomotion is phase-driven and stamina-scaled.
 */
export function computePlayerPose(
  state: PlayerStateName,
  phase: number,
  stamina: number,
  stateAgeSeconds = 0,
): PlayerPose {
  const energy = 0.65 + clamp(stamina, 0, 1) * 0.35;
  const swing = Math.sin(phase);
  const idle = Math.sin(phase * 0.75);

  switch (state) {
    case "jog": {
      const kneeLift = 0.55 * energy;
      return {
        leftLeg: swing * 0.5 * energy,
        rightLeg: -swing * 0.5 * energy,
        leftKnee: -0.12 - Math.max(0, swing) * kneeLift,
        rightKnee: -0.12 - Math.max(0, -swing) * kneeLift,
        leftArm: -swing * 0.36 * energy,
        rightArm: swing * 0.36 * energy,
        leftElbow: 0.25 + Math.max(0, -swing) * 0.18,
        rightElbow: 0.25 + Math.max(0, swing) * 0.18,
        bodyY: Math.abs(swing) * 0.025,
        bodyTilt: 0,
        bodyLean: -0.045,
        bodyTwist: -swing * 0.055,
        headPitch: 0.015,
        headYaw: 0,
      };
    }
    case "sprint": {
      const kneeLift = 0.95 * energy;
      return {
        leftLeg: swing * 0.88 * energy,
        rightLeg: -swing * 0.88 * energy,
        leftKnee: -0.17 - Math.max(0, swing) * kneeLift,
        rightKnee: -0.17 - Math.max(0, -swing) * kneeLift,
        leftArm: -swing * 0.7 * energy,
        rightArm: swing * 0.7 * energy,
        leftElbow: 0.72 + Math.max(0, -swing) * 0.3,
        rightElbow: 0.72 + Math.max(0, swing) * 0.3,
        bodyY: Math.abs(swing) * 0.045,
        bodyTilt: 0,
        bodyLean: -0.17,
        bodyTwist: -swing * 0.1,
        headPitch: 0.035,
        headYaw: 0,
      };
    }
    case "dribble": {
      const kneeLift = 0.42 * energy;
      return {
        leftLeg: swing * 0.34 * energy,
        rightLeg: -swing * 0.34 * energy,
        leftKnee: -0.14 - Math.max(0, swing) * kneeLift,
        rightKnee: -0.14 - Math.max(0, -swing) * kneeLift,
        leftArm: -swing * 0.26 * energy,
        rightArm: swing * 0.26 * energy,
        leftElbow: 0.34 + Math.max(0, -swing) * 0.15,
        rightElbow: 0.34 + Math.max(0, swing) * 0.15,
        bodyY: Math.abs(swing) * 0.02,
        bodyTilt: 0,
        bodyLean: -0.06,
        bodyTwist: -swing * 0.04,
        headPitch: 0.055,
        headYaw: 0,
      };
    }
    case "pass": {
      const kick = kickPose(stateAgeSeconds, 0.35);
      return {
        leftLeg: -0.14,
        rightLeg: kick.hip * 0.62,
        leftKnee: -0.18,
        rightKnee: lerp(-0.65, -0.12, clamp01(kick.hip + 0.45)),
        leftArm: -0.42,
        rightArm: 0.3,
        leftElbow: 0.3,
        rightElbow: 0.24,
        bodyY: 0.015,
        bodyTilt: 0,
        bodyLean: 0.055,
        bodyTwist: 0.12,
        headPitch: 0.04,
        headYaw: -0.05,
      };
    }
    case "shoot":
    case "volley": {
      const volley = state === "volley";
      const kick = kickPose(stateAgeSeconds, volley ? 1 : 0.7);
      return {
        leftLeg: -0.16,
        rightLeg: kick.hip,
        leftKnee: -0.22,
        rightKnee: kick.knee,
        leftArm: volley ? -1.45 : -0.8,
        rightArm: volley ? 1.15 : 0.48,
        leftElbow: 0.38,
        rightElbow: 0.52,
        bodyY: volley ? 0.05 : 0.02,
        bodyTilt: volley ? -0.12 : 0,
        bodyLean: volley ? 0.02 : 0.09,
        bodyTwist: volley ? -0.08 : 0.16,
        headPitch: volley ? -0.1 : 0.04,
        headYaw: 0,
      };
    }
    case "header": {
      const jump = Math.sin(Math.PI * clamp01(stateAgeSeconds / 0.32));
      return {
        leftLeg: -0.1,
        rightLeg: 0.1,
        leftKnee: -0.42,
        rightKnee: -0.42,
        leftArm: -2.3,
        rightArm: 2.3,
        leftElbow: 0.28,
        rightElbow: 0.28,
        bodyY: 0.02 + jump * 0.16,
        bodyTilt: 0,
        bodyLean: -0.04,
        bodyTwist: 0,
        headPitch: -0.28 * jump,
        headYaw: 0,
      };
    }
    case "tackle": {
      const lunge = Math.sin(Math.PI * clamp01(stateAgeSeconds / 0.32));
      return {
        leftLeg: 0.45,
        rightLeg: -0.38,
        leftKnee: -0.5 - lunge * 0.18,
        rightKnee: -0.38,
        leftArm: -0.62,
        rightArm: 0.56,
        leftElbow: 0.42,
        rightElbow: 0.34,
        bodyY: -0.1 * lunge,
        bodyTilt: 0,
        bodyLean: 0.16 + lunge * 0.12,
        bodyTwist: -0.08,
        headPitch: 0.06,
        headYaw: 0,
      };
    }
    case "slide":
      return {
        leftLeg: 0.32,
        rightLeg: -0.26,
        leftKnee: -0.18,
        rightKnee: -0.7,
        leftArm: -0.95,
        rightArm: 0.82,
        leftElbow: 0.24,
        rightElbow: 0.3,
        bodyY: 0.28,
        bodyTilt: 1.35,
        bodyLean: 0.06,
        bodyTwist: 0,
        headPitch: 0.2,
        headYaw: 0,
      };
    case "diveLeft":
    case "diveRight": {
      const side = state === "diveLeft" ? 1 : -1;
      const progress = clamp01(stateAgeSeconds / 0.4);
      const extend = smoothstep(0, 0.2, progress);
      const recover = smoothstep(0.78, 1, progress);
      return {
        leftLeg: 0.3,
        rightLeg: -0.24,
        leftKnee: -0.18,
        rightKnee: -0.48,
        leftArm: -2.45,
        rightArm: 2.35,
        leftElbow: 0.18,
        rightElbow: 0.22,
        bodyY: 0.08 + 0.4 * extend - 0.08 * recover,
        bodyTilt: side * (0.12 + 1.22 * extend - 0.16 * recover),
        bodyLean: 0.08,
        bodyTwist: side * 0.08,
        headPitch: 0.16,
        headYaw: 0,
      };
    }
    case "fall":
    case "injured":
      return {
        leftLeg: 0.16,
        rightLeg: -0.12,
        leftKnee: -0.36,
        rightKnee: -0.12,
        leftArm: -0.68,
        rightArm: 0.64,
        leftElbow: 0.16,
        rightElbow: 0.22,
        bodyY: 0.22,
        bodyTilt: 1.38,
        bodyLean: 0.04,
        bodyTwist: 0,
        headPitch: 0.22,
        headYaw: 0,
      };
    case "celebrate":
      return {
        leftLeg: -0.12,
        rightLeg: 0.12,
        leftKnee: -0.1,
        rightKnee: -0.1,
        leftArm: -2.7,
        rightArm: 2.7,
        leftElbow: 0.16 + Math.abs(Math.sin(phase)) * 0.1,
        rightElbow: 0.16 + Math.abs(Math.sin(phase)) * 0.1,
        bodyY: Math.abs(Math.sin(phase * 2)) * 0.18,
        bodyTilt: 0,
        bodyLean: 0,
        bodyTwist: Math.sin(phase * 0.5) * 0.12,
        headPitch: -0.1,
        headYaw: 0,
      };
    case "idle":
    default:
      return {
        leftLeg: 0,
        rightLeg: 0,
        leftKnee: -0.035,
        rightKnee: -0.035,
        leftArm: idle * 0.06,
        rightArm: -idle * 0.06,
        leftElbow: 0.08 + Math.abs(idle) * 0.02,
        rightElbow: 0.08 + Math.abs(idle) * 0.02,
        bodyY: idle * 0.015,
        bodyTilt: 0,
        bodyLean: 0,
        bodyTwist: idle * 0.015,
        headPitch: 0.01,
        headYaw: idle * 0.04,
      };
  }
}

const SKIN_TONES = [0xd7a16f, 0xb8794f, 0x8d5b3c, 0x6f452f, 0xe2b78a] as const;

/** Joint blend responsiveness; roughly a 40 ms time constant. */
const POSE_BLEND_RATE = 26;

/** Linear joint-space blend used to cross-fade locomotion and action states. */
export function blendPlayerPoses(
  from: PlayerPose,
  to: PlayerPose,
  alpha: number,
): PlayerPose {
  const t = clamp01(alpha);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  return {
    leftLeg: mix(from.leftLeg, to.leftLeg),
    rightLeg: mix(from.rightLeg, to.rightLeg),
    leftKnee: mix(from.leftKnee, to.leftKnee),
    rightKnee: mix(from.rightKnee, to.rightKnee),
    leftArm: mix(from.leftArm, to.leftArm),
    rightArm: mix(from.rightArm, to.rightArm),
    leftElbow: mix(from.leftElbow, to.leftElbow),
    rightElbow: mix(from.rightElbow, to.rightElbow),
    bodyY: mix(from.bodyY, to.bodyY),
    bodyTilt: mix(from.bodyTilt, to.bodyTilt),
    bodyLean: mix(from.bodyLean, to.bodyLean),
    bodyTwist: mix(from.bodyTwist, to.bodyTwist),
    headPitch: mix(from.headPitch, to.headPitch),
    headYaw: mix(from.headYaw, to.headYaw),
  };
}

/** Common surface used by the procedural and authored match-player rigs. */
export interface MatchPlayerRig {
  readonly root: THREE.Group;
  update(pitch: Pitch, player: RenderPlayer, elapsed: number, tick: number): void;
  setDetail?(detail: PlayerDetail): void;
  setShadowCasting?(enabled: boolean): void;
  setAnimationStride?(stride: number): void;
  setMaterialLod?(active: boolean): void;
  setGeometryDetail?(detail: "high" | "low"): void;
  advanceVisualTransition?(deltaSeconds: number): void;
  attachLowTemplate?(template: { readonly scene: THREE.Object3D } | null): void;
  readonly geometry?: "high" | "low";
  dispose(): void;
}

export class PlayerRig implements MatchPlayerRig {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly upperBody = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftElbow = new THREE.Group();
  private readonly rightElbow = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly switchRing: THREE.Mesh;
  private readonly marker: THREE.Sprite;
  private readonly shadow: THREE.Mesh;
  private readonly card: THREE.Mesh;
  private lastState: PlayerStateName | null = null;
  private stateStartedElapsed = 0;
  private lastElapsed: number | null = null;
  private stridePhase = 0;
  private currentPose: PlayerPose | null = null;

  constructor(player: RenderPlayer, colors: RenderTeamColors) {
    const skin = new THREE.MeshStandardMaterial({
      color: SKIN_TONES[player.number % SKIN_TONES.length]!,
      roughness: 0.82,
    });
    const jersey = new THREE.MeshStandardMaterial({
      color: player.goalkeeper ? colors.keeper : colors.primary,
      roughness: 0.72,
    });
    const shorts = new THREE.MeshStandardMaterial({
      color: player.goalkeeper ? colors.keeper : colors.secondary,
      roughness: 0.78,
    });
    const boots = new THREE.MeshStandardMaterial({
      color: 0x101917,
      roughness: 0.5,
      metalness: 0.1,
    });

    this.root.name = `player-${player.id}`;
    this.root.scale.setScalar(VISUAL_TUNING.playerScale);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.08, 36),
      new THREE.MeshBasicMaterial({
        color: 0x62f6ff,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.028;
    this.root.add(this.ring);

    this.switchRing = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.12, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffbd5f,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.switchRing.rotation.x = -Math.PI / 2;
    this.switchRing.position.y = 0.026;
    this.switchRing.visible = false;
    this.root.add(this.switchRing);

    this.marker = createControlledMarker();
    this.marker.position.y = 2.75;
    this.marker.scale.set(0.9, 0.9, 0.9);
    this.root.add(this.marker);

    const hipY = 0.92;
    const legSides = [
      {
        hip: this.leftLeg,
        knee: this.leftKnee,
        z: -0.13,
      },
      {
        hip: this.rightLeg,
        knee: this.rightKnee,
        z: 0.13,
      },
    ] as const;
    for (const { hip, knee, z } of legSides) {
      hip.position.set(0, hipY, z);
      const thigh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.085, 0.22, 3, 7),
        skin,
      );
      thigh.position.y = -0.18;
      thigh.castShadow = true;
      hip.add(thigh);
      knee.position.y = -0.36;
      hip.add(knee);
      const shin = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.068, 0.24, 3, 7),
        skin,
      );
      shin.position.y = -0.17;
      shin.castShadow = true;
      knee.add(shin);
      const sock = new THREE.Mesh(
        new THREE.BoxGeometry(0.19, 0.19, 0.19),
        jersey,
      );
      sock.position.y = -0.28;
      sock.castShadow = true;
      knee.add(sock);
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.09, 0.3),
        boots,
      );
      boot.position.set(0.06, -0.36, 0);
      boot.castShadow = true;
      knee.add(boot);
      this.body.add(hip);
    }

    const shortsMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.26, 0.4),
      shorts,
    );
    shortsMesh.position.y = 0.91;
    shortsMesh.castShadow = true;
    this.body.add(shortsMesh);

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 0.5, 4, 10),
      jersey,
    );
    torso.position.y = 1.22;
    torso.castShadow = true;
    this.upperBody.add(torso);

    const armSides = [
      { shoulder: this.leftArm, elbow: this.leftElbow, z: -0.3 },
      { shoulder: this.rightArm, elbow: this.rightElbow, z: 0.3 },
    ] as const;
    for (const { shoulder, elbow, z } of armSides) {
      shoulder.position.set(0, 1.48, z);
      const upperArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.06, 0.2, 3, 7),
        skin,
      );
      upperArm.position.y = -0.14;
      upperArm.castShadow = true;
      shoulder.add(upperArm);
      elbow.position.y = -0.29;
      shoulder.add(elbow);
      const forearm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.054, 0.19, 3, 7),
        skin,
      );
      forearm.position.y = -0.13;
      forearm.castShadow = true;
      elbow.add(forearm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 7, 6), skin);
      hand.position.y = -0.28;
      hand.castShadow = true;
      elbow.add(hand);
      this.upperBody.add(shoulder);
    }

    this.head.position.y = 1.82;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), skin);
    skull.castShadow = true;
    this.head.add(skull);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1 }),
    );
    hair.position.y = 0.02;
    this.head.add(hair);
    this.upperBody.add(this.head);
    this.body.add(this.upperBody);
    this.root.add(this.body);

    const number = createNumberSprite(player.number);
    number.position.y = 2.22;
    this.root.add(number);

    this.card = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.22, 0.035),
      new THREE.MeshBasicMaterial({ color: 0xf1c45c }),
    );
    this.card.position.set(0.08, 2.02, 0.2);
    this.card.visible = false;
    this.root.add(this.card);
  }

  update(pitch: Pitch, player: RenderPlayer, elapsed: number, tick: number): void {
    if (player.sentOff) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const world = pitchToWorld(pitch, player.x, player.y);
    this.root.position.set(world.x, world.y, world.z);
    this.root.rotation.y = facingToRotationY(player.facing);
    this.ring.visible = player.controlled;
    this.ring.scale.setScalar(1 + Math.sin(tick * 0.14) * 0.08);
    this.switchRing.visible = player.switchTarget && !player.controlled;
    this.switchRing.scale.setScalar(1 + Math.sin(tick * 0.1 + 1.3) * 0.05);
    this.marker.visible = player.controlled;
    this.marker.position.y = 2.75 + Math.sin(tick * 0.12) * 0.09;
    this.card.visible = player.yellowCards > 0;

    // Replays and match restarts can move the presentation clock backwards.
    // Snap the new frame rather than blending across an unrelated timeline.
    const previousElapsed = this.lastElapsed;
    const rewound = previousElapsed !== null && elapsed < previousElapsed;
    if (rewound) {
      this.lastState = null;
      this.currentPose = null;
    }
    if (player.state !== this.lastState) {
      this.lastState = player.state;
      this.stateStartedElapsed = elapsed;
    }
    this.lastElapsed = elapsed;
    const stateAge = Math.max(0, elapsed - this.stateStartedElapsed);
    const deltaSeconds =
      previousElapsed === null || rewound
        ? 0
        : Math.max(0, elapsed - previousElapsed);

    const cadence =
      player.state === "sprint"
        ? 11
        : player.state === "jog"
          ? 7
          : player.state === "dribble"
            ? 8
            : player.state === "celebrate"
              ? 4
              : 3;
    // Advance the stride instead of recomputing it from the clock: a jog-to-
    // sprint transition changes cadence but must not teleport the feet.
    if (previousElapsed === null || rewound) {
      this.stridePhase = elapsed * cadence + player.number * 0.63;
    } else {
      this.stridePhase += deltaSeconds * cadence;
    }
    const target = computePlayerPose(
      player.state,
      this.stridePhase,
      player.stamina,
      stateAge,
    );
    const blend =
      this.currentPose === null || rewound
        ? 1
        : 1 - Math.exp(-deltaSeconds * POSE_BLEND_RATE);
    const pose =
      this.currentPose === null
        ? target
        : blendPlayerPoses(this.currentPose, target, blend);
    this.currentPose = pose;
    this.leftLeg.rotation.z = pose.leftLeg;
    this.rightLeg.rotation.z = pose.rightLeg;
    this.leftKnee.rotation.z = pose.leftKnee;
    this.rightKnee.rotation.z = pose.rightKnee;
    this.leftArm.rotation.z = pose.leftArm;
    this.rightArm.rotation.z = pose.rightArm;
    this.leftElbow.rotation.z = pose.leftElbow;
    this.rightElbow.rotation.z = pose.rightElbow;
    this.body.position.y = pose.bodyY;
    this.body.rotation.x = pose.bodyTilt;
    this.body.rotation.z = pose.bodyLean;
    this.upperBody.rotation.y = pose.bodyTwist;
    this.head.rotation.z = pose.headPitch;
    this.head.rotation.y = pose.headYaw;
    this.shadow.scale.setScalar(
      1 - clamp(player.state === "slide" ? 0.18 : 0, 0, 0.3),
    );
  }

  dispose(): void {
    disposeObject(this.root);
  }
}

export function createControlledMarker(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.translate(64, 64);
    ctx.shadowColor = "rgba(98, 246, 255, 0.9)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, 42);
    ctx.lineTo(-38, -16);
    ctx.lineTo(-17, -16);
    ctx.lineTo(0, 10);
    ctx.lineTo(17, -16);
    ctx.lineTo(38, -16);
    ctx.closePath();
    ctx.fillStyle = "#62f6ff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(5, 22, 24, 0.9)";
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  );
  return sprite;
}

export function createNumberSprite(number: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = "700 70px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(4, 14, 8, 0.85)";
    ctx.strokeText(String(number), 64, 68);
    ctx.fillStyle = "#f5fbf7";
    ctx.fillText(String(number), 64, 68);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.7, 0.7, 0.7);
  return sprite;
}
