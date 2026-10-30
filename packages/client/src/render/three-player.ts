// packages/client/src/render/three-player.ts

import * as THREE from "three";
import { clamp } from "@fb/shared";
import type { Pitch } from "@fb/sim";
import type { PlayerStateName } from "@fb/sim";
import { facingToRotationY, pitchToWorld } from "./three-layout";
import type { RenderPlayer, RenderTeamColors } from "./view";

export interface PlayerPose {
  readonly leftLeg: number;
  readonly rightLeg: number;
  readonly leftArm: number;
  readonly rightArm: number;
  readonly bodyY: number;
  readonly bodyTilt: number;
  readonly bodyLean: number;
}

/**
 * Pose math is kept pure and separate from Three.js so animation behaviour can
 * be tested without a WebGL context.
 */
export function computePlayerPose(
  state: PlayerStateName,
  phase: number,
  stamina: number,
): PlayerPose {
  const energy = 0.65 + clamp(stamina, 0, 1) * 0.35;
  const swing = Math.sin(phase);
  const idle = Math.sin(phase * 0.75);

  switch (state) {
    case "jog":
      return {
        leftLeg: swing * 0.52 * energy,
        rightLeg: -swing * 0.52 * energy,
        leftArm: -swing * 0.34 * energy,
        rightArm: swing * 0.34 * energy,
        bodyY: Math.abs(swing) * 0.025,
        bodyTilt: 0,
        bodyLean: -0.035,
      };
    case "sprint":
      return {
        leftLeg: swing * 0.9 * energy,
        rightLeg: -swing * 0.9 * energy,
        leftArm: -swing * 0.68 * energy,
        rightArm: swing * 0.68 * energy,
        bodyY: Math.abs(swing) * 0.045,
        bodyTilt: 0,
        bodyLean: -0.13,
      };
    case "dribble":
      return {
        leftLeg: swing * 0.34 * energy,
        rightLeg: -swing * 0.34 * energy,
        leftArm: -swing * 0.24 * energy,
        rightArm: swing * 0.24 * energy,
        bodyY: Math.abs(swing) * 0.02,
        bodyTilt: 0,
        bodyLean: -0.06,
      };
    case "pass":
    case "shoot":
    case "volley":
      return {
        leftLeg: -0.22,
        rightLeg: 1.05,
        leftArm: -0.55,
        rightArm: 0.4,
        bodyY: 0.02,
        bodyTilt: 0,
        bodyLean: 0.04,
      };
    case "header":
      return {
        leftLeg: -0.08,
        rightLeg: 0.08,
        leftArm: -2.35,
        rightArm: 2.35,
        bodyY: 0.11,
        bodyTilt: 0,
        bodyLean: 0,
      };
    case "tackle":
      return {
        leftLeg: 0.42,
        rightLeg: -0.35,
        leftArm: -0.55,
        rightArm: 0.5,
        bodyY: -0.12,
        bodyTilt: 0,
        bodyLean: 0.15,
      };
    case "slide":
      return {
        leftLeg: 0.28,
        rightLeg: -0.2,
        leftArm: -0.9,
        rightArm: 0.8,
        bodyY: 0.28,
        bodyTilt: 1.35,
        bodyLean: 0,
      };
    case "fall":
    case "injured":
      return {
        leftLeg: 0.16,
        rightLeg: -0.12,
        leftArm: -0.65,
        rightArm: 0.62,
        bodyY: 0.22,
        bodyTilt: 1.38,
        bodyLean: 0,
      };
    case "celebrate":
      return {
        leftLeg: -0.12,
        rightLeg: 0.12,
        leftArm: -2.7,
        rightArm: 2.7,
        bodyY: Math.abs(Math.sin(phase * 2)) * 0.18,
        bodyTilt: 0,
        bodyLean: 0,
      };
    case "idle":
    default:
      return {
        leftLeg: 0,
        rightLeg: 0,
        leftArm: idle * 0.06,
        rightArm: -idle * 0.06,
        bodyY: idle * 0.015,
        bodyTilt: 0,
        bodyLean: 0,
      };
  }
}

const SKIN_TONES = [0xd7a16f, 0xb8794f, 0x8d5b3c, 0x6f452f, 0xe2b78a] as const;

export class PlayerRig {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly card: THREE.Mesh;

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
    this.root.scale.setScalar(1.15);

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
      new THREE.RingGeometry(0.7, 0.82, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf4fbff,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.028;
    this.root.add(this.ring);

    const hipY = 0.92;
    for (const [group, z] of [
      [this.leftLeg, -0.13] as const,
      [this.rightLeg, 0.13] as const,
    ]) {
      group.position.set(0, hipY, z);
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.085, 0.48, 3, 7),
        skin,
      );
      leg.position.y = -0.31;
      leg.castShadow = true;
      group.add(leg);
      const sock = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        jersey,
      );
      sock.position.y = -0.57;
      sock.castShadow = true;
      group.add(sock);
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.09, 0.3),
        boots,
      );
      boot.position.set(0.06, -0.7, 0);
      boot.castShadow = true;
      group.add(boot);
      this.body.add(group);
    }

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 0.5, 4, 10),
      jersey,
    );
    torso.position.y = 1.22;
    torso.castShadow = true;
    this.body.add(torso);

    const shortsMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.26, 0.4),
      shorts,
    );
    shortsMesh.position.y = 0.91;
    shortsMesh.castShadow = true;
    this.body.add(shortsMesh);

    for (const [group, z] of [
      [this.leftArm, -0.3] as const,
      [this.rightArm, 0.3] as const,
    ]) {
      group.position.set(0, 1.48, z);
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.06, 0.38, 3, 7),
        skin,
      );
      arm.position.y = -0.21;
      arm.castShadow = true;
      group.add(arm);
      this.body.add(group);
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), skin);
    head.position.y = 1.82;
    head.castShadow = true;
    this.body.add(head);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1 }),
    );
    hair.position.y = 1.84;
    this.body.add(hair);

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
    this.ring.scale.setScalar(1 + Math.sin(tick * 0.14) * 0.06);
    this.card.visible = player.yellowCards > 0;

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
    const phase = elapsed * cadence + player.number * 0.63;
    const pose = computePlayerPose(player.state, phase, player.stamina);
    this.leftLeg.rotation.z = pose.leftLeg;
    this.rightLeg.rotation.z = pose.rightLeg;
    this.leftArm.rotation.z = pose.leftArm;
    this.rightArm.rotation.z = pose.rightArm;
    this.body.position.y = pose.bodyY;
    this.body.rotation.x = pose.bodyTilt;
    this.body.rotation.z = pose.bodyLean;
    this.shadow.scale.setScalar(
      1 - clamp((player.state === "slide" ? 0.18 : 0), 0, 0.3),
    );
  }
}

function createNumberSprite(number: number): THREE.Sprite {
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
