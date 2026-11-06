// packages/client/src/render/authored-asset.ts

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  PLAYER_LOW_ASSET_URL,
  PLAYER_MATCH_ASSET_URL,
} from "../character/asset";

export interface AuthoredTemplate {
  readonly scene: THREE.Group;
  readonly materials: ReadonlyMap<string, THREE.Material>;
  readonly modelBaseY: number;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
}

export interface AuthoredTemplates {
  readonly match: AuthoredTemplate | null;
  readonly low: AuthoredTemplate | null;
}

let templatesPromise: Promise<AuthoredTemplates> | null = null;
let templates: AuthoredTemplates | null = null;

function parseTemplate(gltf: {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
}): AuthoredTemplate {
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
  return {
    scene,
    materials,
    modelBaseY: -bounds.min.y,
    clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
  };
}

function loadTemplate(url: string, label: string): Promise<AuthoredTemplate | null> {
  return new GLTFLoader()
    .loadAsync(url)
    .then(parseTemplate)
    .catch((error: unknown) => {
      console.warn(
        `Authored player ${label} asset unavailable; keeping the fallback.`,
        error,
      );
      return null;
    });
}

/**
 * Load the match and low-poly templates once. The lobby warms both during its
 * first paint; the match renderer can switch geometry without waiting on a new
 * network request.
 */
export function loadAuthoredTemplates(): Promise<AuthoredTemplates> {
  if (templates !== null) {
    return Promise.resolve(templates);
  }
  if (templatesPromise !== null) {
    return templatesPromise;
  }
  templatesPromise = Promise.all([
    loadTemplate(PLAYER_MATCH_ASSET_URL, "match"),
    loadTemplate(PLAYER_LOW_ASSET_URL, "low"),
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
