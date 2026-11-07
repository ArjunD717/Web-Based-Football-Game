// packages/client/src/render/geometry-dissolve.ts

import type * as THREE from "three";

const DISSOLVE_UNIFORM = "uFbDissolve";
const INVERTED_UNIFORM = "uFbDissolveInverted";
const ALPHA_TEST_INCLUDE = "#include <alphatest_fragment>";
const FRAGMENT_MAIN = "void main() {";

/**
 * Screen-space dithering. Both sides of a dissolve evaluate the same
 * coordinate hash, so their survive/discard decisions are complementary at
 * every pixel. The hash is stable frame to frame.
 */
const DISSOLVE_FRAGMENT = /* glsl */ `
	float fbDither = fract(
		52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715)))
	);
	float fbCutoff = 1.0 - uFbDissolve;
	if (uFbDissolveInverted > 0.5) {
		if (fbDither < fbCutoff) discard;
	} else if (fbDither >= fbCutoff) {
		discard;
	}
`;

export interface DissolveProgress {
  value: number;
}

export interface DissolveMaterial {
  readonly material: THREE.Material;
  readonly progress: DissolveProgress;
}

/**
 * Clone a material for one direction of the geometry dissolve. The original
 * transparency mode and depth writes are preserved: opaque materials remain
 * opaque and depth-writing, which is what removes the alpha-blend ghosting.
 */
export function createDissolveMaterial(
  source: THREE.Material,
  incoming: boolean,
): DissolveMaterial {
  const material = source.clone();
  const progress: DissolveProgress = { value: 0 };
  const inverted: DissolveProgress = { value: incoming ? 1 : 0 };
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms[DISSOLVE_UNIFORM] = progress;
    shader.uniforms[INVERTED_UNIFORM] = inverted;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        FRAGMENT_MAIN,
        `uniform float ${DISSOLVE_UNIFORM};
uniform float ${INVERTED_UNIFORM};
${FRAGMENT_MAIN}`,
      )
      .replace(
        ALPHA_TEST_INCLUDE,
        `${ALPHA_TEST_INCLUDE}
${DISSOLVE_FRAGMENT}`,
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${previousKey()}|fb-dissolve-${incoming ? "in" : "out"}`;
  material.needsUpdate = true;
  return { material, progress };
}
