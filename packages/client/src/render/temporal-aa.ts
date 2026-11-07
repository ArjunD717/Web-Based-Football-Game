// packages/client/src/render/temporal-aa.ts

import * as THREE from "three";
import { VISUAL_TUNING } from "./visualTuning";

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;

vec3 linearToSrgb(vec3 value) {
	vec3 low = value * 12.92;
	vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
	return mix(low, high, step(vec3(0.0031308), value));
}

void main() {
	gl_FragColor = vec4(linearToSrgb(texture2D(tInput, vUv).rgb), 1.0);
}
`;

const RESOLVE_FRAGMENT = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform mat4 uInvViewProjection;
uniform mat4 uPrevViewProjection;
uniform vec2 uResolution;
uniform float uHistoryWeight;
uniform float uHistoryValid;
varying vec2 vUv;

void main() {
	vec2 uv = vUv;
	vec3 current = texture2D(tCurrent, uv).rgb;
	vec3 minimum = current;
	vec3 maximum = current;
	for (int y = -1; y <= 1; y += 1) {
		for (int x = -1; x <= 1; x += 1) {
			vec2 offset = vec2(float(x), float(y)) / uResolution;
			vec3 sampleColor = texture2D(
				tCurrent,
				clamp(uv + offset, vec2(0.0), vec2(1.0))
			).rgb;
			minimum = min(minimum, sampleColor);
			maximum = max(maximum, sampleColor);
		}
	}

	float depth = texture2D(tDepth, uv).x;
	vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
	vec4 world = uInvViewProjection * clip;
	world.xyz /= max(world.w, 1e-6);
	vec4 previousClip = uPrevViewProjection * vec4(world.xyz, 1.0);
	vec2 previousUv = previousClip.xy / max(abs(previousClip.w), 1e-6) * 0.5 + 0.5;
	vec3 history = texture2D(tHistory, clamp(previousUv, vec2(0.0), vec2(1.0))).rgb;
	history = clamp(history, minimum, maximum);

	float valid = uHistoryValid;
	if (
		previousClip.w <= 0.0 ||
		previousUv.x < 0.0 || previousUv.x > 1.0 ||
		previousUv.y < 0.0 || previousUv.y > 1.0
	) {
		valid = 0.0;
	}
	vec3 resolved = mix(current, history, uHistoryWeight * valid);
	gl_FragColor = vec4(resolved, 1.0);
}
`;

export function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1;
  let value = Math.max(0, Math.floor(index));
  while (value > 0) {
    fraction /= base;
    result += fraction * (value % base);
    value = Math.floor(value / base);
  }
  return result;
}

/** Deterministic subpixel jitter in drawing-buffer pixels. */
export function temporalJitter(
  frame: number,
  pixels: number,
  target: THREE.Vector2,
): THREE.Vector2 {
  const scale = Number.isFinite(pixels) ? pixels : 0;
  target.set(
    (halton(frame, 2) - 0.5) * scale,
    (halton(frame, 3) - 0.5) * scale,
  );
  return target;
}

/**
 * Minimal TAA for the live Three scene. Camera jitter supplies subpixel
 * samples; depth is reprojected into the previous view-projection and a
 * neighborhood clamp rejects most history from moving players. This is
 * deliberately feature-flagged: there are no per-object motion vectors yet.
 */
export class TemporalAa {
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly fullscreenMesh: THREE.Mesh;
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0,
    1,
  );
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private readonly history: (THREE.WebGLRenderTarget | null)[] = [null, null];
  private width = 0;
  private height = 0;
  private readIndex = 0;
  private historyValid = false;
  private frame = 0;
  private hasCameraSample = false;
  private readonly lastCameraPosition = new THREE.Vector3();
  private readonly lastCameraQuaternion = new THREE.Quaternion();
  private readonly currentCameraPosition = new THREE.Vector3();
  private readonly currentCameraQuaternion = new THREE.Quaternion();
  private readonly lastViewProjection = new THREE.Matrix4();
  private readonly currentViewProjection = new THREE.Matrix4();
  private readonly inverseViewProjection = new THREE.Matrix4();
  private readonly drawingBuffer = new THREE.Vector2();
  private readonly jitter = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.resolveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        uInvViewProjection: { value: new THREE.Matrix4() },
        uPrevViewProjection: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2() },
        uHistoryWeight: { value: 0 },
        uHistoryValid: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: RESOLVE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null } },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.fullscreenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.copyMaterial,
    );
    this.fullscreenMesh.frustumCulled = false;
    this.fullscreenScene.add(this.fullscreenMesh);
  }

  reset(): void {
    this.historyValid = false;
    this.frame = 0;
  }

  resize(): void {
    this.renderer.getDrawingBufferSize(this.drawingBuffer);
    const width = Math.max(1, Math.floor(this.drawingBuffer.x));
    const height = Math.max(1, Math.floor(this.drawingBuffer.y));
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.disposeTargets();
    this.sceneTarget = this.createSceneTarget(width, height);
    this.history[0] = this.createHistoryTarget(width, height);
    this.history[1] = this.createHistoryTarget(width, height);
    this.readIndex = 0;
    this.reset();
  }

  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): void {
    this.resize();
    if (this.sceneTarget === null) {
      return;
    }
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.currentCameraPosition);
    camera.getWorldQuaternion(this.currentCameraQuaternion);
    if (
      this.hasCameraSample &&
      this.cameraJumped(this.currentCameraPosition, this.currentCameraQuaternion)
    ) {
      this.reset();
    }
    this.hasCameraSample = true;
    this.lastCameraPosition.copy(this.currentCameraPosition);
    this.lastCameraQuaternion.copy(this.currentCameraQuaternion);

    const tuning = VISUAL_TUNING.temporalAa;
    temporalJitter(this.frame, tuning.jitterPixels, this.jitter);
    this.frame += 1;
    camera.setViewOffset(
      this.width,
      this.height,
      this.jitter.x,
      this.jitter.y,
      this.width,
      this.height,
    );
    this.currentViewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.inverseViewProjection.copy(this.currentViewProjection).invert();

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.render(scene, camera);
    camera.clearViewOffset();

    const historyRead = this.history[this.readIndex] ?? null;
    const historyWrite = this.history[1 - this.readIndex] ?? null;
    if (historyRead === null || historyWrite === null) {
      return;
    }
    const uniforms = this.resolveMaterial.uniforms as {
      tCurrent: { value: THREE.Texture | null };
      tDepth: { value: THREE.Texture | null };
      tHistory: { value: THREE.Texture | null };
      uInvViewProjection: { value: THREE.Matrix4 };
      uPrevViewProjection: { value: THREE.Matrix4 };
      uResolution: { value: THREE.Vector2 };
      uHistoryWeight: { value: number };
      uHistoryValid: { value: number };
    };
    uniforms.tCurrent.value = this.sceneTarget.texture;
    uniforms.tDepth.value = this.sceneTarget.depthTexture;
    uniforms.tHistory.value = historyRead.texture;
    uniforms.uInvViewProjection.value.copy(this.inverseViewProjection);
    uniforms.uPrevViewProjection.value.copy(this.lastViewProjection);
    uniforms.uResolution.value.set(this.width, this.height);
    uniforms.uHistoryWeight.value = tuning.historyWeight;
    uniforms.uHistoryValid.value = this.historyValid ? 1 : 0;

    this.fullscreenMesh.material = this.resolveMaterial;
    this.renderer.setRenderTarget(historyWrite);
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    const copyUniforms = this.copyMaterial.uniforms as {
      tInput: { value: THREE.Texture | null };
    };
    copyUniforms.tInput.value = historyWrite.texture;
    this.fullscreenMesh.material = this.copyMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    this.renderer.setRenderTarget(previousTarget);
    this.lastViewProjection.copy(this.currentViewProjection);
    this.historyValid = true;
    this.readIndex = 1 - this.readIndex;
  }

  dispose(): void {
    this.disposeTargets();
    this.resolveMaterial.dispose();
    this.copyMaterial.dispose();
    this.fullscreenMesh.geometry.dispose();
  }

  private cameraJumped(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): boolean {
    const tuning = VISUAL_TUNING.temporalAa;
    if (
      position.distanceTo(this.lastCameraPosition) >
      tuning.cameraCutDistanceM
    ) {
      return true;
    }
    const dot = Math.min(
      1,
      Math.abs(quaternion.dot(this.lastCameraQuaternion)),
    );
    return 2 * Math.acos(dot) > tuning.cameraCutAngleRadians;
  }

  private createSceneTarget(
    width: number,
    height: number,
  ): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(
      width,
      height,
      THREE.UnsignedIntType,
    );
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    return target;
  }

  private createHistoryTarget(
    width: number,
    height: number,
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    return target;
  }

  private disposeTargets(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    this.history[0]?.dispose();
    this.history[1]?.dispose();
    this.sceneTarget = null;
    this.history[0] = null;
    this.history[1] = null;
  }
}
