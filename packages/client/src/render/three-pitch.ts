// packages/client/src/render/three-pitch.ts

import * as THREE from "three";
import { TUNING } from "@fb/shared";
import type { GoalGeometry, Pitch, TeamSide } from "@fb/sim";
import { netRippleStrength } from "./goal-effects";
import {
  createStadiumVisual,
  type StadiumVisual,
} from "./three-stadium";
import { VISUAL_TUNING } from "./visualTuning";

const PIXELS_PER_METRE = 20;
const LINE_COLOUR = "rgba(239, 250, 243, 0.88)";

export interface GoalNetVisual {
  readonly side: TeamSide;
  trigger(): void;
  update(deltaSeconds: number): void;
  reset(): void;
}

export interface PitchVisual {
  readonly group: THREE.Group;
  readonly texture: THREE.CanvasTexture;
  readonly stadium: StadiumVisual;
  readonly goalNets: readonly GoalNetVisual[];
}

/** Texture-based markings keep the 3D pitch crisp without thousands of lines. */
export function createPitchVisual(pitch: Pitch): PitchVisual {
  const group = new THREE.Group();
  group.name = "pitch";

  const texture = createPitchTexture(pitch);
  texture.anisotropy = 8;
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(pitch.lengthM, pitch.widthM),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.94,
      metalness: 0,
    }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0;
  surface.receiveShadow = true;
  group.add(surface);

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(pitch.lengthM + 24, pitch.widthM + 20),
    new THREE.MeshStandardMaterial({
      color: 0x07180f,
      roughness: 1,
    }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.04;
  surround.receiveShadow = true;
  group.add(surround);

  const homeGoal = createGoalVisual(pitch, pitch.homeGoal);
  const awayGoal = createGoalVisual(pitch, pitch.awayGoal);
  group.add(homeGoal.group);
  group.add(awayGoal.group);
  group.add(createCornerFlags(pitch));
  const stadium = createStadiumVisual(pitch);
  group.add(stadium.group);
  return {
    group,
    texture,
    stadium,
    goalNets: [homeGoal.net, awayGoal.net],
  };
}

function createPitchTexture(pitch: Pitch): THREE.CanvasTexture {
  const width = Math.round(pitch.lengthM * PIXELS_PER_METRE);
  const height = Math.round(pitch.widthM * PIXELS_PER_METRE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Could not create the pitch texture");
  }

  ctx.scale(PIXELS_PER_METRE, PIXELS_PER_METRE);
  ctx.fillStyle = "#176b3c";
  ctx.fillRect(0, 0, pitch.lengthM, pitch.widthM);

  const stripes = 14;
  for (let stripe = 0; stripe < stripes; stripe += 1) {
    if (stripe % 2 === 0) {
      continue;
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    ctx.fillRect(
      (pitch.lengthM / stripes) * stripe,
      0,
      pitch.lengthM / stripes,
      pitch.widthM,
    );
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, pitch.widthM);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.08)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, pitch.lengthM, pitch.widthM);

  ctx.strokeStyle = LINE_COLOUR;
  ctx.fillStyle = LINE_COLOUR;
  ctx.lineWidth = 0.12;
  ctx.lineJoin = "round";

  const centreX = pitch.lengthM / 2;
  const centreY = pitch.widthM / 2;
  const penaltyHalfWidth = pitch.penaltyAreaWidthM / 2;
  const goalAreaHalfWidth = pitch.goalAreaWidthM / 2;
  const spotX = pitch.penaltySpotDistanceM;
  const arcOutsideX = pitch.penaltyAreaLengthM;
  const arcHalfY = Math.sqrt(
    Math.max(0, pitch.penaltyArcRadiusM ** 2 - (arcOutsideX - spotX) ** 2),
  );
  const arcAngle = Math.atan2(arcHalfY, arcOutsideX - spotX);

  ctx.strokeRect(0, 0, pitch.lengthM, pitch.widthM);
  ctx.beginPath();
  ctx.moveTo(centreX, 0);
  ctx.lineTo(centreX, pitch.widthM);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centreX, centreY, TUNING.match.centreCircleRadiusM, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centreX, centreY, 0.18, 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1] as const) {
    const penaltyX =
      side === -1 ? 0 : pitch.lengthM - pitch.penaltyAreaLengthM;
    const goalAreaX =
      side === -1 ? 0 : pitch.lengthM - pitch.goalAreaLengthM;
    ctx.strokeRect(
      penaltyX,
      centreY - penaltyHalfWidth,
      pitch.penaltyAreaLengthM,
      pitch.penaltyAreaWidthM,
    );
    ctx.strokeRect(
      goalAreaX,
      centreY - goalAreaHalfWidth,
      pitch.goalAreaLengthM,
      pitch.goalAreaWidthM,
    );

    const spot = side === -1 ? spotX : pitch.lengthM - spotX;
    ctx.beginPath();
    ctx.arc(spot, centreY, 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (side === -1) {
      ctx.arc(spot, centreY, pitch.penaltyArcRadiusM, -arcAngle, arcAngle);
    } else {
      ctx.arc(
        spot,
        centreY,
        pitch.penaltyArcRadiusM,
        Math.PI - arcAngle,
        Math.PI + arcAngle,
      );
    }
    ctx.stroke();
  }

  const cornerArcs: readonly {
    readonly x: number;
    readonly y: number;
    readonly start: number;
    readonly end: number;
  }[] = [
    { x: 1, y: 1, start: 0, end: Math.PI / 2 },
    { x: 1, y: pitch.widthM - 1, start: Math.PI / 2, end: Math.PI },
    { x: pitch.lengthM - 1, y: 1, start: -Math.PI / 2, end: 0 },
    {
      x: pitch.lengthM - 1,
      y: pitch.widthM - 1,
      start: Math.PI,
      end: Math.PI * 1.5,
    },
  ];
  for (const arc of cornerArcs) {
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, pitch.cornerArcRadiusM, arc.start, arc.end);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCornerFlags(pitch: Pitch): THREE.Group {
  const group = new THREE.Group();
  group.name = "corner-flags";
  const flagTuning = VISUAL_TUNING.cornerFlag;
  const poleGeometry = new THREE.CylinderGeometry(
    flagTuning.poleRadiusM,
    flagTuning.poleRadiusM,
    flagTuning.poleHeightM,
    6,
  );
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8f0e8,
    roughness: 0.55,
  });
  const flagGeometry = new THREE.PlaneGeometry(
    flagTuning.flagWidthM,
    flagTuning.flagHeightM,
  );
  const flagMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8a1e,
    side: THREE.DoubleSide,
  });
  const halfLength = pitch.lengthM / 2;
  const halfWidth = pitch.widthM / 2;
  for (const x of [-halfLength, halfLength] as const) {
    for (const z of [-halfWidth, halfWidth] as const) {
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(x, flagTuning.poleHeightM / 2, z);
      group.add(pole);
      const flag = new THREE.Mesh(flagGeometry, flagMaterial);
      flag.position.set(
        x + Math.sign(x) * flagTuning.flagWidthM * 0.45,
        flagTuning.poleHeightM - flagTuning.flagHeightM * 0.5,
        z,
      );
      flag.rotation.y = Math.PI / 4;
      group.add(flag);
    }
  }
  return group;
}

function createNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(239, 250, 243, 0.72)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createNetMaterial(
  source: THREE.CanvasTexture,
  widthM: number,
  heightM: number,
): THREE.MeshBasicMaterial {
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.repeat.set(
    Math.max(1, Math.round(widthM / 0.32)),
    Math.max(1, Math.round(heightM / 0.32)),
  );
  return new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xdfeee4,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function createGoalVisual(
  pitch: Pitch,
  goal: GoalGeometry,
): { group: THREE.Group; net: GoalNetVisual } {
  const group = new THREE.Group();
  const side: TeamSide = goal.netDirection === -1 ? "home" : "away";
  group.name = `goal-${side}`;
  const net = new GoalNetEffect(side);
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4fbf6,
    roughness: 0.48,
    metalness: 0.08,
  });
  const netTexture = createNetTexture();

  const worldX = goal.lineX - pitch.lengthM / 2;
  const centreZ = goal.centreY - pitch.widthM / 2;
  const halfWidth = goal.widthM / 2;
  const postGeometry = new THREE.CylinderGeometry(
    Math.max(goal.postRadiusM, 0.09),
    Math.max(goal.postRadiusM, 0.09),
    goal.heightM,
    10,
  );
  for (const direction of [-1, 1] as const) {
    const post = new THREE.Mesh(postGeometry, frameMaterial);
    post.position.set(worldX, goal.heightM / 2, centreZ + direction * halfWidth);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.max(goal.postRadiusM, 0.09),
      Math.max(goal.postRadiusM, 0.09),
      goal.widthM,
      10,
    ),
    frameMaterial,
  );
  bar.rotation.x = Math.PI / 2;
  bar.position.set(worldX, goal.heightM, centreZ);
  bar.castShadow = true;
  group.add(bar);

  const addNetPlane = (
    mesh: THREE.Mesh,
    widthM: number,
    heightM: number,
    normalSign: number,
  ): void => {
    group.add(mesh);
    net.addPlane(mesh, widthM, heightM, normalSign);
  };

  const backX = worldX + goal.netDirection * goal.netDepthM;
  const netBack = new THREE.Mesh(
    new THREE.PlaneGeometry(goal.widthM, goal.heightM, 14, 8),
    createNetMaterial(netTexture, goal.widthM, goal.heightM),
  );
  netBack.rotation.y = Math.PI / 2;
  netBack.position.set(backX, goal.heightM / 2, centreZ);
  addNetPlane(netBack, goal.widthM, goal.heightM, goal.netDirection);

  for (const direction of [-1, 1] as const) {
    const sideNet = new THREE.Mesh(
      new THREE.PlaneGeometry(goal.netDepthM, goal.heightM, 6, 8),
      createNetMaterial(netTexture, goal.netDepthM, goal.heightM),
    );
    sideNet.position.set(
      worldX + (goal.netDirection * goal.netDepthM) / 2,
      goal.heightM / 2,
      centreZ + direction * halfWidth,
    );
    addNetPlane(sideNet, goal.netDepthM, goal.heightM, direction);
  }

  const roof = new THREE.Mesh(
    new THREE.PlaneGeometry(goal.netDepthM, goal.widthM, 6, 12),
    createNetMaterial(netTexture, goal.netDepthM, goal.widthM),
  );
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(
    worldX + (goal.netDirection * goal.netDepthM) / 2,
    goal.heightM,
    centreZ,
  );
  addNetPlane(roof, goal.netDepthM, goal.widthM, 1);

  return { group, net };
}

interface NetPlane {
  readonly mesh: THREE.Mesh;
  readonly basePositions: Float32Array;
  readonly widthM: number;
  readonly heightM: number;
  readonly normalSign: number;
}

/**
 * Goal nets are small CPU-deformed planes. The ball and goal law remain
 * authoritative; this only makes the net react to a confirmed score.
 */
export class GoalNetEffect implements GoalNetVisual {
  private readonly planes: NetPlane[] = [];
  private elapsedSeconds = 0;
  private active = false;

  constructor(readonly side: TeamSide) {}

  addPlane(
    mesh: THREE.Mesh,
    widthM: number,
    heightM: number,
    normalSign: number,
  ): void {
    const position = mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    this.planes.push({
      mesh,
      basePositions: new Float32Array(position.array as ArrayLike<number>),
      widthM,
      heightM,
      normalSign,
    });
  }

  trigger(): void {
    this.active = true;
    this.elapsedSeconds = 0;
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }
    const tuning = VISUAL_TUNING.goalMoment;
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    if (this.elapsedSeconds >= tuning.netDurationSeconds) {
      this.reset();
      return;
    }
    const strength = netRippleStrength(
      this.elapsedSeconds,
      tuning.netDurationSeconds,
    );
    for (const plane of this.planes) {
      const position = plane.mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const positions = position.array as Float32Array;
      for (let index = 0; index < positions.length; index += 3) {
        const baseX = plane.basePositions[index] ?? 0;
        const baseY = plane.basePositions[index + 1] ?? 0;
        const baseZ = plane.basePositions[index + 2] ?? 0;
        const u = baseX / plane.widthM + 0.5;
        const v = baseY / plane.heightM + 0.5;
        const centreWeight = Math.exp(
          -(((u - 0.5) / 0.38) ** 2 + ((v - 0.5) / 0.42) ** 2),
        );
        const wave =
          0.55 + 0.45 * Math.sin(this.elapsedSeconds * 25 - u * 7 - v * 5);
        positions[index + 2] =
          baseZ +
          plane.normalSign *
            tuning.netAmplitudeM *
            strength *
            centreWeight *
            wave;
      }
      position.needsUpdate = true;
    }
  }

  reset(): void {
    if (!this.active) {
      return;
    }
    for (const plane of this.planes) {
      const position = plane.mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const positions = position.array as Float32Array;
      positions.set(plane.basePositions);
      position.needsUpdate = true;
    }
    this.active = false;
    this.elapsedSeconds = 0;
  }
}
