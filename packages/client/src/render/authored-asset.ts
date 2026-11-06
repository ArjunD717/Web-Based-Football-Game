// packages/client/src/render/authored-asset.ts

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  PLAYER_LOW_ASSET_URL,
  PLAYER_LOW_MESHOPT_URL,
  PLAYER_MATCH_ASSET_URL,
  PLAYER_MATCH_MESHOPT_URL,
} from "../character/asset";
import {
  authoredAssetBudgetIssues,
  type AuthoredAssetKind,
} from "./asset-budget";

export interface AuthoredTemplate {
  readonly scene: THREE.Group;
  readonly materials: ReadonlyMap<string, THREE.Material>;
  readonly modelBaseY: number;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  readonly compressed: boolean;
}

export interface AuthoredTemplates {
  readonly match: AuthoredTemplate | null;
  readonly low: AuthoredTemplate | null;
}

let templatesPromise: Promise<AuthoredTemplates> | null = null;
let templates: AuthoredTemplates | null = null;

function countTriangles(scene: THREE.Object3D): number {
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const geometry = (object as THREE.Mesh).geometry;
    const count =
      geometry.index?.count ??
      geometry.getAttribute("position")?.count ??
      0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function countBones(scene: THREE.Object3D): number {
  let bones = 0;
  scene.traverse((object) => {
    if (object instanceof THREE.Bone) {
      bones += 1;
    }
  });
  return bones;
}

function warnBudget(
  kind: AuthoredAssetKind,
  scene: THREE.Object3D,
  compressed: boolean,
  bytes: number | null,
): void {
  const issues = authoredAssetBudgetIssues({
    kind,
    compressedBytes: bytes,
    triangles: countTriangles(scene),
    bones: countBones(scene),
  });
  if (issues.length > 0) {
    console.warn(
      `Authored ${kind} ${compressed ? "meshopt" : "uncompressed"} asset exceeds budget:`,
      issues,
    );
  }
}

function parseTemplate(
  gltf: {
    readonly scene: THREE.Group;
    readonly animations: readonly THREE.AnimationClip[];
  },
  kind: AuthoredAssetKind,
  compressed: boolean,
  bytes: number | null,
): AuthoredTemplate {
  const scene = gltf.scene;
  const materials = new Map<string, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const mesh = object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    const source = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const entry of source) {
      materials.set(entry.name, entry);
      if (entry.name === "eye_decal") {
        entry.transparent = true;
        entry.depthWrite = false;
        entry.alphaTest = 0.02;
        entry.side = THREE.DoubleSide;
        entry.polygonOffset = true;
        entry.polygonOffsetFactor = -2;
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(scene);
  warnBudget(kind, scene, compressed, bytes);
  return {
    scene,
    materials,
    modelBaseY: -bounds.min.y,
    clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
    compressed,
  };
}

async function fetchBytes(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const length = response.headers.get("content-length");
    if (length === null) {
      return null;
    }
    const size = Number.parseInt(length, 10);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

async function loadArchivedTemplate(
  kind: AuthoredAssetKind,
  compressedUrl: string,
  fallbackUrl: string,
): Promise<AuthoredTemplate | null> {
  const compressedBytes = await fetchBytes(compressedUrl);
  const meshoptLoader = new GLTFLoader();
  meshoptLoader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await meshoptLoader.loadAsync(compressedUrl);
    return parseTemplate(gltf, kind, true, compressedBytes);
  } catch (error: unknown) {
    console.warn(
      `Authored ${kind} meshopt asset unavailable; trying uncompressed.`,
      error,
    );
  }
  try {
    const fallbackLoader = new GLTFLoader();
    const gltf = await fallbackLoader.loadAsync(fallbackUrl);
    return parseTemplate(gltf, kind, false, await fetchBytes(fallbackUrl));
  } catch (error: unknown) {
    console.warn(
      `Authored ${kind} fallback asset unavailable; keeping procedural players.`,
      error,
    );
    return null;
  }
}

/**
 * Load the compressed match and low templates, with an uncompressed fallback
 * when meshopt decoding is unavailable. The lobby warms both during its first
 * paint.
 */
export function loadAuthoredTemplates(): Promise<AuthoredTemplates> {
  if (templates !== null) {
    return Promise.resolve(templates);
  }
  if (templatesPromise !== null) {
    return templatesPromise;
  }
  templatesPromise = Promise.all([
    loadArchivedTemplate("match", PLAYER_MATCH_MESHOPT_URL, PLAYER_MATCH_ASSET_URL),
    loadArchivedTemplate("low", PLAYER_LOW_MESHOPT_URL, PLAYER_LOW_ASSET_URL),
  ]).then(([match, low]) => {
    templates = { match, low };
    return templates;
  });
  return templatesPromise;
}

/** Fire-and-forget warm-up used by the lobby entry point. */
export function preloadAuthoredPlayer(): void {
  void loadAuthoredTemplates();
}
