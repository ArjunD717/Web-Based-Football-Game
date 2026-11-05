// packages/client/src/render/three-dispose.ts

import * as THREE from "three";

/** Release every geometry, material and texture reachable from a visual root. */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture<unknown, THREE.TextureEventMap>>();
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
      if (!(material instanceof THREE.Material)) {
        continue;
      }
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          textures.add(value as THREE.Texture<unknown, THREE.TextureEventMap>);
        }
      }
      material.dispose();
    }
  });
  for (const texture of textures) {
    texture.dispose();
  }
}
