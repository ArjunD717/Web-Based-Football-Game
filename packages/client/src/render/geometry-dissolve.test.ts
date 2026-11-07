// packages/client/src/render/geometry-dissolve.test.ts

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createDissolveMaterial } from "./geometry-dissolve";

describe("geometry dissolve material", () => {
  it("keeps the source opacity mode and depth writes", () => {
    const source = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const dissolve = createDissolveMaterial(source, false);
    expect(dissolve.material).not.toBe(source);
    expect(dissolve.material.transparent).toBe(true);
    expect(dissolve.material.opacity).toBe(0.6);
    expect(dissolve.material.depthWrite).toBe(false);
  });

  it("injects complementary uniforms into the fragment shader", () => {
    const dissolve = createDissolveMaterial(
      new THREE.MeshStandardMaterial(),
      true,
    );
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: "void main() {\n#include <alphatest_fragment>\n}",
    };
    dissolve.material.onBeforeCompile(
      shader as never,
      null as never,
    );
    expect(shader.uniforms.uFbDissolve).toBe(dissolve.progress);
    expect(shader.uniforms.uFbDissolveInverted?.value).toBe(1);
    expect(shader.fragmentShader).toContain("uniform float uFbDissolve;");
    expect(shader.fragmentShader).toContain("fbDither");
    expect(shader.fragmentShader).toContain("discard");
  });

  it("uses a distinct program cache key per dissolve side", () => {
    const source = new THREE.MeshStandardMaterial();
    const outgoing = createDissolveMaterial(source, false);
    const incoming = createDissolveMaterial(source, true);
    expect(outgoing.material.customProgramCacheKey()).not.toBe(
      incoming.material.customProgramCacheKey(),
    );
  });
});
