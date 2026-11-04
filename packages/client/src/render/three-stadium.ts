// packages/client/src/render/three-stadium.ts

import * as THREE from "three";
import type { Pitch } from "@fb/sim";
import { crowdCelebrationStrength } from "./goal-effects";
import { VISUAL_TUNING } from "./visualTuning";

export interface StadiumVisual {
  readonly group: THREE.Group;
  /** Pulse the crowd after a goal. */
  triggerCelebration(): void;
  update(deltaSeconds: number): void;
  reset(): void;
}

/**
 * Cheap procedural surround: four crowd faces around the pitch. Vertical
 * faces avoid occlusion when a camera sits behind the stand line and keep the
 * scene light enough for a laptop GPU.
 */
export function createStadiumVisual(pitch: Pitch): StadiumVisual {
  const group = new THREE.Group();
  group.name = "stadium";
  const tuning = VISUAL_TUNING.crowd;
  const texture = createCrowdTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
  });
  const halfLength = pitch.lengthM / 2;
  const halfWidth = pitch.widthM / 2;
  const sideWidth = pitch.lengthM + tuning.lengthPadM * 2;
  const sideZ = halfWidth + tuning.sideInsetM;
  const endWidth = pitch.widthM + tuning.sideInsetM * 2;
  const endX = halfLength + tuning.endInsetM;

  for (const direction of [-1, 1] as const) {
    group.add(
      createStand(
        sideWidth,
        tuning.heightM,
        new THREE.Vector3(0, tuning.heightM / 2, direction * sideZ),
        0,
        material,
      ),
    );
    group.add(
      createStand(
        endWidth,
        tuning.heightM,
        new THREE.Vector3(direction * endX, tuning.heightM / 2, 0),
        Math.PI / 2,
        material,
      ),
    );
  }

  const goalTuning = VISUAL_TUNING.goalMoment;
  let celebrationElapsed: number | null = null;

  const reset = (): void => {
    celebrationElapsed = null;
    material.color.setScalar(1);
    texture.offset.x = 0;
  };

  return {
    group,
    triggerCelebration(): void {
      celebrationElapsed = 0;
    },
    update(deltaSeconds: number): void {
      if (celebrationElapsed === null) {
        return;
      }
      celebrationElapsed += Math.max(0, deltaSeconds);
      const strength = crowdCelebrationStrength(
        celebrationElapsed,
        goalTuning.crowdDurationSeconds,
      );
      if (strength <= 0) {
        reset();
        return;
      }
      material.color.setScalar(1 + goalTuning.crowdBrightness * strength);
      texture.offset.x = Math.sin(celebrationElapsed * 9) * 0.002 * strength;
    },
    reset,
  };
}

function createStand(
  width: number,
  height: number,
  position: THREE.Vector3,
  rotationY: number,
  faceMaterial: THREE.MeshBasicMaterial,
): THREE.Group {
  const stand = new THREE.Group();
  stand.position.copy(position);
  stand.rotation.y = rotationY;

  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    faceMaterial,
  );
  stand.add(front);

  return stand;
}

function createCrowdTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#0a140f";
    ctx.fillRect(0, 0, width, height);
    const palette = ["#c8b38c", "#8d9a8f", "#b66b45", "#526b76", "#ddd5c3"];
    let seed = 0x51f15e;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let row = 0; row < 18; row += 1) {
      const y = 7 + row * 7;
      ctx.fillStyle = row % 2 === 0 ? "#0d1a12" : "#101e15";
      ctx.fillRect(0, y - 2, width, 3);
      for (let seat = 0; seat < 128; seat += 1) {
        const x = seat * 4 + (row % 2) * 2;
        ctx.fillStyle = palette[Math.floor(random() * palette.length)]!;
        ctx.globalAlpha = 0.35 + random() * 0.55;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255, 138, 30, 0.35)";
    ctx.fillRect(0, height - 8, width, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(VISUAL_TUNING.crowd.textureRepeatX, 1);
  texture.anisotropy = 4;
  return texture;
}
