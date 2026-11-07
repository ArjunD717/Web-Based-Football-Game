// packages/client/src/render/geometry-dissolve-pool.ts

import * as THREE from "three";
import { VISUAL_TUNING } from "./visualTuning";
import {
  createDissolveMaterial,
  type DissolveMaterial,
} from "./geometry-dissolve";

/** The generated texture is small enough to start quickly and repeat cleanly. */
export const BLUE_NOISE_SIZE = 32;

/**
 * Farthest-point sampling produces a progressive, tileable blue-noise rank
 * order without external assets. The first rank starts at the origin and each
 * next rank fills the largest remaining void under toroidal distance.
 */
export function createBlueNoiseRanks(size: number): Uint8Array {
  const dimension = Math.max(2, Math.floor(size));
  const count = dimension * dimension;
  const selected = new Uint8Array(count);
  const nearest = new Uint32Array(count);
  nearest.fill(0xffffffff);
  const ranks = new Uint8Array(count);
  const half = dimension / 2;

  for (let rank = 0; rank < count; rank += 1) {
    let best = 0;
    let bestDistance = -1;
    for (let index = 0; index < count; index += 1) {
      if (selected[index] !== 0) {
        continue;
      }
      const distance = nearest[index] ?? 0;
      if (distance > bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    selected[best] = 1;
    ranks[best] = Math.round((rank * 254) / (count - 1));

    const bestX = best % dimension;
    const bestY = Math.floor(best / dimension);
    for (let y = 0; y < dimension; y += 1) {
      let dy = Math.abs(y - bestY);
      if (dy > half) {
        dy = dimension - dy;
      }
      const dy2 = dy * dy;
      for (let x = 0; x < dimension; x += 1) {
        if (selected[y * dimension + x] !== 0) {
          continue;
        }
        let dx = Math.abs(x - bestX);
        if (dx > half) {
          dx = dimension - dx;
        }
        const distance = dx * dx + dy2;
        const index = y * dimension + x;
        if (distance < (nearest[index] ?? 0xffffffff)) {
          nearest[index] = distance;
        }
      }
    }
  }
  return ranks;
}

export function createBlueNoiseTexture(
  size: number = BLUE_NOISE_SIZE,
): THREE.DataTexture {
  const dimension = Math.max(2, Math.floor(size));
  const ranks = createBlueNoiseRanks(dimension);
  const data = new Uint8Array(dimension * dimension * 4);
  for (let index = 0; index < ranks.length; index += 1) {
    const value = ranks[index] ?? 0;
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    data,
    dimension,
    dimension,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Shared by every authored rig in one player library. Inactive material clones
 * and skinned fade meshes are reused across players instead of being retained
 * per rig for the lifetime of the match.
 */
export class GeometryDissolvePool {
  private readonly blueNoise: THREE.DataTexture;
  private readonly blueNoiseSize: number;
  private readonly outgoing = new Map<THREE.Material, DissolveMaterial[]>();
  private readonly incoming = new Map<THREE.Material, DissolveMaterial[]>();
  private readonly active = new Set<DissolveMaterial>();
  private readonly allMaterials = new Set<DissolveMaterial>();
  private readonly freeMeshes: THREE.SkinnedMesh[] = [];
  private readonly emptySkeleton = new THREE.Skeleton([]);
  private disposed = false;

  constructor(noiseSize: number = BLUE_NOISE_SIZE) {
    this.blueNoiseSize = Math.max(2, Math.floor(noiseSize));
    this.blueNoise = createBlueNoiseTexture(this.blueNoiseSize);
  }

  acquireMaterial(
    source: THREE.Material,
    incoming: boolean,
  ): DissolveMaterial {
    const bucket = incoming ? this.incoming : this.outgoing;
    const free = bucket.get(source);
    const pooled = free?.pop();
    const material =
      pooled ??
      createDissolveMaterial(
        source,
        incoming,
        this.blueNoise,
        this.blueNoiseSize,
      );
    this.active.add(material);
    this.allMaterials.add(material);
    return material;
  }

  releaseMaterial(material: DissolveMaterial): void {
    if (this.disposed || !this.active.delete(material)) {
      return;
    }
    const bucket = material.incoming ? this.incoming : this.outgoing;
    let free = bucket.get(material.source);
    if (free === undefined) {
      free = [];
      bucket.set(material.source, free);
    }
    free.push(material);
  }

  /**
   * Drop idle clones for a material that belongs to a disposed rig. Shared
   * palette sources are deliberately not dropped by individual rigs.
   */
  dropSource(source: THREE.Material): void {
    if (this.disposed) {
      return;
    }
    for (const bucket of [this.outgoing, this.incoming]) {
      const free = bucket.get(source);
      if (free === undefined) {
        continue;
      }
      for (const material of free) {
        this.allMaterials.delete(material);
        material.material.dispose();
      }
      bucket.delete(source);
    }
  }

  acquireMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
  ): THREE.SkinnedMesh {
    const mesh =
      this.freeMeshes.pop() ??
      new THREE.SkinnedMesh(geometry, material);
    mesh.geometry = geometry;
    mesh.material = material;
    mesh.visible = true;
    return mesh;
  }

  releaseMesh(mesh: THREE.SkinnedMesh): void {
    if (this.disposed) {
      return;
    }
    mesh.removeFromParent();
    mesh.visible = false;
    mesh.skeleton = this.emptySkeleton;
    mesh.bindMatrix.identity();
    mesh.bindMatrixInverse.identity();
    this.freeMeshes.push(mesh);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const material of this.allMaterials) {
      material.material.dispose();
    }
    this.allMaterials.clear();
    this.active.clear();
    this.outgoing.clear();
    this.incoming.clear();
    this.freeMeshes.length = 0;
    this.blueNoise.dispose();
  }
}

let activeGeometryFades = 0;
let maxGeometryFades = VISUAL_TUNING.authoredPlayer.geometryFadeMaxActive;

/** The renderer adjusts this between normal and frame-pressured budgets. */
export function configureGeometryFadeBudget(maxActive: number): void {
  maxGeometryFades = Number.isFinite(maxActive)
    ? Math.max(1, Math.floor(maxActive))
    : 1;
}

export function tryAcquireGeometryFadeBudget(): boolean {
  if (activeGeometryFades >= maxGeometryFades) {
    return false;
  }
  activeGeometryFades += 1;
  return true;
}

export function releaseGeometryFadeBudget(): void {
  activeGeometryFades = Math.max(0, activeGeometryFades - 1);
}

export function geometryFadeBudgetState(): {
  readonly active: number;
  readonly max: number;
} {
  return { active: activeGeometryFades, max: maxGeometryFades };
}
