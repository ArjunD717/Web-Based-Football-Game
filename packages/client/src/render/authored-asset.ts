// packages/client/src/render/authored-asset.ts

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PLAYER_MATCH_ASSET_URL } from "../character/asset";

export interface AuthoredTemplate {
  readonly scene: THREE.Group;
  readonly materials: ReadonlyMap<string, THREE.Material>;
  readonly modelBaseY: number;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
}

let templatePromise: Promise<AuthoredTemplate | null> | null = null;
let template: AuthoredTemplate | null = null;

/**
 * Load the match GLB once for the whole app lifetime. The lobby starts this
 * request during its first paint, so the match renderer normally finds the
 * parsed template ready and never shows the procedural fallback frame.
 */
export function loadAuthoredTemplate(): Promise<AuthoredTemplate | null> {
  if (template !== null) {
    return Promise.resolve(template);
  }
  if (templatePromise !== null) {
    return templatePromise;
  }
  templatePromise = new GLTFLoader()
    .loadAsync(PLAYER_MATCH_ASSET_URL)
    .then((gltf) => {
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
      template = {
        scene,
        materials,
        modelBaseY: -bounds.min.y,
        clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
      };
      return template;
    })
    .catch((error: unknown) => {
      console.warn(
        "Authored player asset unavailable; keeping procedural match rigs.",
        error,
      );
      return null;
    });
  return templatePromise;
}

/** Fire-and-forget warm-up used by the lobby entry point. */
export function preloadAuthoredPlayer(): void {
  void loadAuthoredTemplate();
}
