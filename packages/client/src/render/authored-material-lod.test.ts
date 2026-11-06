// packages/client/src/render/authored-material-lod.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cheapMaterialFor } from "./authored-material-lod";

describe("authored material LOD", () => {
  it("keeps albedo and transparency but drops PBR maps", () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: 0x336699,
      map,
      normalMap,
      transparent: true,
      opacity: 0.6,
    });
    const cheap = cheapMaterialFor(source);
    expect(cheap).toBeInstanceOf(THREE.MeshLambertMaterial);
    if (!(cheap instanceof THREE.MeshLambertMaterial)) {
      return;
    }
    expect(cheap.map).toBe(map);
    expect(cheap.normalMap).toBeNull();
    expect(cheap.color.getHex()).toBe(0x336699);
    expect(cheap.transparent).toBe(true);
    expect(cheap.opacity).toBe(0.6);
  });

  it("reuses non-standard materials instead of losing their shader", () => {
    const source = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    expect(cheapMaterialFor(source)).toBe(source);
  });
});
