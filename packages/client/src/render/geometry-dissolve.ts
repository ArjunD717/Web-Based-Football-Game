// packages/client/src/render/geometry-dissolve.ts

import type * as THREE from "three";

const DISSOLVE_UNIFORM = "uFbDissolve";
const INVERTED_UNIFORM = "uFbDissolveInverted";
const BLUE_NOISE_UNIFORM = "uFbBlueNoise";
const ALPHA_TEST_INCLUDE = "#include <alphatest_fragment>";
const FRAGMENT_MAIN = "void main() {";

/**
 * Screen-space blue-noise dithering. Both sides of a dissolve evaluate the
 * same texture coordinate, so their survive/discard decisions are
 * complementary at every pixel. The texture is static, so no per-frame random
 * hash is introduced while the camera and player are still.
 */
function dissolveFragment(noiseSize: number): string {
  return /* glsl */ `
	float fbDither = texture2D(
		${BLUE_NOISE_UNIFORM},
		floor(gl_FragCoord.xy) / ${noiseSize}.0
	).r;
	float fbCutoff = 1.0 - uFbDissolve;
	if (uFbDissolveInverted > 0.5) {
		if (fbDither < fbCutoff) discard;
	} else if (fbDither >= fbCutoff) {
		discard;
	}
`;
}

export interface DissolveProgress {
  value: number;
}

export interface DissolveMaterial {
  readonly material: THREE.Material;
  readonly progress: DissolveProgress;
  readonly source: THREE.Material;
  readonly incoming: boolean;
}

/**
 * Clone a material for one direction of the geometry dissolve. The original
 * transparency mode and depth writes are preserved: opaque materials remain
 * opaque and depth-writing, which is what removes the alpha-blend ghosting.
 */
export function createDissolveMaterial(
  source: THREE.Material,
  incoming: boolean,
  blueNoise: THREE.Texture,
  blueNoiseSize: number,
): DissolveMaterial {
  const material = source.clone();
  const progress: DissolveProgress = { value: 0 };
  const inverted: DissolveProgress = { value: incoming ? 1 : 0 };
  const noiseScale = Math.max(1, Math.floor(blueNoiseSize));
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms[DISSOLVE_UNIFORM] = progress;
    shader.uniforms[INVERTED_UNIFORM] = inverted;
    shader.uniforms[BLUE_NOISE_UNIFORM] = { value: blueNoise };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        FRAGMENT_MAIN,
        `uniform sampler2D ${BLUE_NOISE_UNIFORM};
uniform float ${DISSOLVE_UNIFORM};
uniform float ${INVERTED_UNIFORM};
${FRAGMENT_MAIN}`,
      )
      .replace(
        ALPHA_TEST_INCLUDE,
        `${ALPHA_TEST_INCLUDE}
${dissolveFragment(noiseScale)}`,
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${previousKey()}|fb-dissolve-${incoming ? "in" : "out"}-${noiseScale}`;
  material.needsUpdate = true;
  return { material, progress, source, incoming };
}
