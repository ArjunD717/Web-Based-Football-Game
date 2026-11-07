// packages/client/src/render/geometry-dissolve-pool.test.ts

import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureGeometryFadeBudget,
  createBlueNoiseRanks,
  createBlueNoiseTexture,
  GeometryDissolvePool,
  geometryFadeBudgetState,
  releaseGeometryFadeBudget,
  tryAcquireGeometryFadeBudget,
} from "./geometry-dissolve-pool";
import { VISUAL_TUNING } from "./visualTuning";

describe("blue-noise generation", () => {
  it("produces a deterministic rank permutation", () => {
    const first = createBlueNoiseRanks(8);
    const second = createBlueNoiseRanks(8);
    expect([...first]).toEqual([...second]);
    expect(new Set(first).size).toBe(64);
    expect(Math.min(...first)).toBe(0);
    expect(Math.max(...first)).toBe(254);
  });

  it("builds a repeatable nearest-filtered data texture", () => {
    const texture = createBlueNoiseTexture(8);
    expect(texture.image.width).toBe(8);
    expect(texture.image.height).toBe(8);
    const data = texture.image.data as Uint8Array;
    expect(data).toHaveLength(8 * 8 * 4);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(data[3]).toBe(255);
    texture.dispose();
  });
});

describe("geometry dissolve pool", () => {
  it("reuses free material clones per source and side", () => {
    const pool = new GeometryDissolvePool(8);
    const source = new THREE.MeshStandardMaterial();
    const first = pool.acquireMaterial(source, false);
    pool.releaseMaterial(first);
    const reused = pool.acquireMaterial(source, false);
    expect(reused).toBe(first);
    pool.releaseMaterial(reused);

    const incoming = pool.acquireMaterial(source, true);
    expect(incoming).not.toBe(first);
    expect(incoming.incoming).toBe(true);
    pool.releaseMaterial(incoming);
    pool.dispose();
  });

  it("reuses free fade meshes and unbinds their previous skeleton", () => {
    const pool = new GeometryDissolvePool(8);
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const first = pool.acquireMesh(geometry, material);
    const skeleton = new THREE.Skeleton([]);
    first.skeleton = skeleton;
    first.bindMatrix.makeTranslation(1, 2, 3);
    pool.releaseMesh(first);
    expect(first.parent).toBeNull();
    expect(first.skeleton).not.toBe(skeleton);
    expect(first.bindMatrix.equals(new THREE.Matrix4())).toBe(true);
    const reused = pool.acquireMesh(geometry, material);
    expect(reused).toBe(first);
    pool.releaseMesh(reused);
    pool.dispose();
  });

  it("drops idle clones when their owning rig is disposed", () => {
    const pool = new GeometryDissolvePool(8);
    const source = new THREE.MeshStandardMaterial();
    const material = pool.acquireMaterial(source, false);
    pool.releaseMaterial(material);
    pool.dropSource(source);
    const recreated = pool.acquireMaterial(source, false);
    expect(recreated).not.toBe(material);
    pool.releaseMaterial(recreated);
    pool.dispose();
  });

  it("does not double-release a material into the free list", () => {
    const pool = new GeometryDissolvePool(8);
    const source = new THREE.MeshStandardMaterial();
    const material = pool.acquireMaterial(source, false);
    pool.releaseMaterial(material);
    pool.releaseMaterial(material);
    const first = pool.acquireMaterial(source, false);
    const second = pool.acquireMaterial(source, false);
    expect(first).toBe(material);
    expect(second).not.toBe(material);
    pool.releaseMaterial(first);
    pool.releaseMaterial(second);
    pool.dispose();
  });
});

describe("adaptive geometry dissolve budget", () => {
  afterEach(() => {
    configureGeometryFadeBudget(
      VISUAL_TUNING.authoredPlayer.geometryFadeMaxActive,
    );
  });

  it("honours the configured cap and reopens after release", () => {
    configureGeometryFadeBudget(2);
    expect(geometryFadeBudgetState()).toEqual({ active: 0, max: 2 });
    expect(tryAcquireGeometryFadeBudget()).toBe(true);
    expect(tryAcquireGeometryFadeBudget()).toBe(true);
    expect(tryAcquireGeometryFadeBudget()).toBe(false);
    expect(geometryFadeBudgetState().active).toBe(2);
    releaseGeometryFadeBudget();
    expect(tryAcquireGeometryFadeBudget()).toBe(true);
    releaseGeometryFadeBudget();
    releaseGeometryFadeBudget();
    expect(geometryFadeBudgetState().active).toBe(0);
  });

  it("clamps invalid caps to one active transition", () => {
    configureGeometryFadeBudget(Number.NaN);
    expect(geometryFadeBudgetState().max).toBe(1);
    expect(tryAcquireGeometryFadeBudget()).toBe(true);
    expect(tryAcquireGeometryFadeBudget()).toBe(false);
    releaseGeometryFadeBudget();
  });
});
