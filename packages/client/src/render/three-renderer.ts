// packages/client/src/render/three-renderer.ts

import * as THREE from "three";
import type { Pitch } from "@fb/sim";
import type { MatchRenderer } from "./renderer";
import { computeCameraPose, pitchToWorld } from "./three-layout";
import { createPitchVisual } from "./three-pitch";
import { PlayerRig } from "./three-player";
import type { MatchView } from "./view";

const MAX_PIXEL_RATIO = 2;
const BALL_RADIUS_M = 0.16;

/**
 * Three.js presentation layer. It consumes the same immutable MatchView as the
 * 2D renderer, so simulation and network code remain unaware of the camera,
 * meshes or animation.
 */
export class ThreeMatchRenderer implements MatchRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private readonly onWindowResize = (): void => {
    this.resize();
  };
  private readonly players = new Map<string, PlayerRig>();
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private readonly ballShadowMaterial: THREE.MeshBasicMaterial;
  private readonly backdrop: THREE.CanvasTexture;
  private readonly pitchGroup = new THREE.Group();
  private pitch: Pitch | null = null;
  private pitchKey = "";
  private width = 1;
  private height = 1;
  private lastFitKey = "";

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.backdrop = createBackdropTexture();
    this.scene.background = this.backdrop;
    this.scene.fog = new THREE.Fog(0x06110b, 135, 260);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);

    const hemisphere = new THREE.HemisphereLight(0xc9f7dd, 0x06130d, 1.7);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(35, 72, 26);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -68;
    key.shadow.camera.right = 68;
    key.shadow.camera.top = 56;
    key.shadow.camera.bottom = -56;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 180;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9ed7ff, 0.55);
    fill.position.set(-42, 34, -38);
    this.scene.add(fill);

    this.scene.add(this.pitchGroup);

    const ballAssets = createBallAssets();
    this.ball = ballAssets.mesh;
    this.ballShadowMaterial = ballAssets.shadowMaterial;
    this.ballShadow = ballAssets.shadow;
    this.scene.add(this.ballShadow);
    this.scene.add(this.ball);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    const parent = canvas.parentElement;
    if (parent !== null) {
      this.resizeObserver.observe(parent);
    }
    window.addEventListener("resize", this.onWindowResize);
    this.resize();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect?.width ?? 1));
    this.height = Math.max(1, Math.floor(rect?.height ?? 1));
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.lastFitKey = "";
    if (this.pitch !== null) {
      this.fitCamera(this.pitch);
    }
  }

  render(view: MatchView): void {
    if (this.width <= 1 || this.height <= 1) {
      this.resize();
    }
    if (this.pitch === null || this.pitchKey !== pitchKey(view.pitch)) {
      this.installPitch(view.pitch);
    }
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.updateProjectionMatrix();
    const fitKey = `${this.pitchKey}:${this.camera.aspect.toFixed(3)}`;
    if (fitKey !== this.lastFitKey) {
      this.fitCamera(view.pitch);
      this.lastFitKey = fitKey;
    }

    this.syncPlayers(view);
    this.updateBall(view);

    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    disposeObject(this.scene);
    this.players.clear();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private installPitch(pitch: Pitch): void {
    if (this.pitchGroup.children.length > 0) {
      disposeObject(this.pitchGroup);
      this.pitchGroup.clear();
    }
    const visual = createPitchVisual(pitch);
    this.pitchGroup.add(visual.group);
    this.pitch = pitch;
    this.pitchKey = pitchKey(pitch);
    this.fitCamera(pitch);
  }

  private fitCamera(pitch: Pitch): void {
    const pose = computeCameraPose(
      pitch,
      this.width / Math.max(1, this.height),
    );
    this.camera.fov = pose.fovDegrees;
    const target = new THREE.Vector3(
      pose.target.x,
      pose.target.y,
      pose.target.z,
    );
    const direction = new THREE.Vector3(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    ).normalize();
    let distance = Math.hypot(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    const bounds = {
      x: pitch.lengthM / 2 + pitch.goalNetDepthM + 0.8,
      z: pitch.widthM / 2 + 1.2,
    };
    const corners = [
      [-bounds.x, 0, -bounds.z],
      [bounds.x, 0, -bounds.z],
      [-bounds.x, 0, bounds.z],
      [bounds.x, 0, bounds.z],
      [-bounds.x, pitch.goalHeightM, -bounds.z],
      [bounds.x, pitch.goalHeightM, -bounds.z],
      [-bounds.x, pitch.goalHeightM, bounds.z],
      [bounds.x, pitch.goalHeightM, bounds.z],
    ] as const;
    const point = new THREE.Vector3();
    for (let iteration = 0; iteration < 10; iteration += 1) {
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      let extent = 0;
      for (const [x, y, z] of corners) {
        point.set(x, y, z).project(this.camera);
        extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
      }
      if (extent >= 0.9 && extent <= 0.94) {
        break;
      }
      const adjustment = THREE.MathUtils.clamp(extent / 0.9, 0.82, 1.25);
      distance *= adjustment;
    }
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  private syncPlayers(view: MatchView): void {
    const seen = new Set<string>();
    for (const team of [view.away, view.home]) {
      for (const player of team.players) {
        seen.add(player.id);
        let rig = this.players.get(player.id);
        if (rig === undefined) {
          rig = new PlayerRig(player, team.colors);
          this.players.set(player.id, rig);
          this.scene.add(rig.root);
        }
        rig.update(view.pitch, player, view.elapsedSeconds, view.tick);
      }
    }
    for (const [id, rig] of this.players) {
      if (seen.has(id)) {
        continue;
      }
      this.scene.remove(rig.root);
      disposeObject(rig.root);
      this.players.delete(id);
    }
  }

  private updateBall(view: MatchView): void {
    const world = pitchToWorld(view.pitch, view.ball.x, view.ball.y, view.ball.z);
    this.ball.position.set(world.x, world.y, world.z);
    this.ball.rotation.x = view.tick * 0.16 + view.ball.spinZ * 0.22;
    this.ball.rotation.z = view.tick * 0.11;

    const ground = pitchToWorld(view.pitch, view.ball.x, view.ball.y, 0.018);
    this.ballShadow.position.set(ground.x, ground.y, ground.z);
    const height = Math.max(0, view.ball.z - BALL_RADIUS_M);
    const scale = 1 + Math.min(1.6, height * 0.12);
    this.ballShadow.scale.set(scale, scale, scale);
    this.ballShadowMaterial.opacity = Math.max(
      0.06,
      0.3 - Math.min(0.22, height * 0.04),
    );
  }
}

export function createThreeRenderer(
  canvas: HTMLCanvasElement,
): MatchRenderer {
  return new ThreeMatchRenderer(canvas);
}

function pitchKey(pitch: Pitch): string {
  return [
    pitch.lengthM,
    pitch.widthM,
    pitch.goalWidthM,
    pitch.goalHeightM,
    pitch.penaltyAreaLengthM,
    pitch.penaltyAreaWidthM,
    pitch.goalAreaLengthM,
    pitch.goalAreaWidthM,
  ].join(":");
}

function createBallAssets(): {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly shadowMaterial: THREE.MeshBasicMaterial;
} {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS_M, 24, 18),
    new THREE.MeshStandardMaterial({
      map: createBallTexture(),
      roughness: 0.56,
      metalness: 0.02,
    }),
  );
  ball.castShadow = true;
  ball.name = "ball";

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS_M * 1.45, 20),
    shadowMaterial,
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.name = "ball-shadow";

  return { mesh: ball, shadow, shadowMaterial };
}

function createBackdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#0c2117");
    gradient.addColorStop(0.55, "#07150d");
    gradient.addColorStop(1, "#040b07");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#f5faf6";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#18211b";
    for (const [x, y, radius] of [
      [128, 58, 24],
      [58, 150, 21],
      [198, 150, 21],
      [128, 210, 18],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(24, 33, 27, 0.45)";
    ctx.lineWidth = 3;
    for (const x of [0, 64, 128, 192, 256]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo((x + 90) % 256, 256);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<{ dispose(): void }>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & { material?: unknown };
    if (mesh.geometry !== undefined) {
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material === undefined
        ? []
        : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.Material) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value);
          }
        }
        material.dispose();
      }
    }
  });
  for (const texture of textures) {
    texture.dispose();
  }
}
