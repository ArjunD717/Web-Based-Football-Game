// packages/client/src/render/authored-material-lod.ts

import * as THREE from "three";

/**
 * Far authored players do not need per-pixel PBR. Lambert keeps albedo and
 * lighting but drops normal maps and the standard-material fragment path.
 */
export function cheapMaterialFor(source: THREE.Material): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    return source;
  }
  const cheap = new THREE.MeshLambertMaterial({
    name: `${source.name}:lod`,
    color: source.color.clone(),
    map: source.map,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    depthWrite: source.depthWrite,
    vertexColors: source.vertexColors,
  });
  cheap.polygonOffset = source.polygonOffset;
  cheap.polygonOffsetFactor = source.polygonOffsetFactor;
  cheap.polygonOffsetUnits = source.polygonOffsetUnits;
  return cheap;
}
