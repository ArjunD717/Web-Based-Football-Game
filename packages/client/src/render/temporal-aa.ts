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

const MOTION_VERTEX = /* glsl */ `
uniform mat4 uPrevModelMatrix;
uniform mat4 uPrevViewProjection;
varying vec2 vVelocity;
varying float vValid;

void main() {
	vec4 localPosition = vec4(position, 1.0);
	vec4 currentWorld = modelMatrix * localPosition;
	vec4 currentClip = projectionMatrix * viewMatrix * currentWorld;
	vec4 previousWorld = uPrevModelMatrix * localPosition;
	vec4 previousClip = uPrevViewProjection * previousWorld;
	gl_Position = currentClip;

	if (currentClip.w <= 0.0 || previousClip.w <= 0.0) {
		vVelocity = vec2(0.0);
		vValid = 0.0;
		return;
	}
	vec2 currentUv = currentClip.xy / currentClip.w * 0.5 + 0.5;
	vec2 previousUv = previousClip.xy / previousClip.w * 0.5 + 0.5;
	vVelocity = currentUv - previousUv;
	vValid = 1.0;
}
`;

const MOTION_FRAGMENT = /* glsl */ `
varying vec2 vVelocity;
varying float vValid;
void main() {
	gl_FragColor = vec4(vVelocity, 0.0, vValid);
}
`;

const DEPTH_COPY_FRAGMENT = /* glsl */ `
uniform sampler2D tDepth;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4(texture2D(tDepth, vUv).x, 0.0, 0.0, 1.0);
}
`;

const RESOLVE_FRAGMENT = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform sampler2D tMotion;
uniform sampler2D tPrevDepth;
uniform mat4 uInvViewProjection;
uniform mat4 uPrevViewProjection;
uniform mat4 uInvPrevViewProjection;
uniform vec2 uResolution;
uniform float uHistoryWeight;
uniform float uHistoryValid;
uniform float uDisocclusionDepthM;
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
	vec4 currentClip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
	vec4 currentWorldClip = uInvViewProjection * currentClip;
	vec3 currentWorld = currentWorldClip.xyz / max(currentWorldClip.w, 1e-6);

	vec4 motion = texture2D(tMotion, uv);
	vec2 previousUv;
	float valid = uHistoryValid;
	if (motion.a > 0.5) {
		previousUv = uv - motion.xy;
	} else {
		vec4 previousClip = uPrevViewProjection * vec4(currentWorld, 1.0);
		previousUv = previousClip.xy / max(abs(previousClip.w), 1e-6) * 0.5 + 0.5;
		if (previousClip.w <= 0.0) {
			valid = 0.0;
		}
	}
	if (
		previousUv.x < 0.0 || previousUv.x > 1.0 ||
		previousUv.y < 0.0 || previousUv.y > 1.0
	) {
		valid = 0.0;
	}
	vec2 clampedPreviousUv = clamp(previousUv, vec2(0.0), vec2(1.0));
	float previousDepth = texture2D(tPrevDepth, clampedPreviousUv).x;
	vec4 previousWorldClip = vec4(
		clampedPreviousUv * 2.0 - 1.0,
		previousDepth * 2.0 - 1.0,
		1.0
	);
	vec4 previousWorldHomogeneous = uInvPrevViewProjection * previousWorldClip;
	vec3 previousWorld = previousWorldHomogeneous.xyz /
		max(previousWorldHomogeneous.w, 1e-6);
	if (distance(currentWorld, previousWorld) > uDisocclusionDepthM) {
		valid = 0.0;
	}

	vec3 history = texture2D(tHistory, clampedPreviousUv).rgb;
	history = clamp(history, minimum, maximum);
	vec3 resolved = mix(current, history, uHistoryWeight * valid);
	gl_FragColor = vec4(resolved, 1.0);
}
`;

export type TemporalMotionShape = "player" | "ball";

export interface TemporalMotionSource {
  readonly object: THREE.Object3D;
  readonly shape: TemporalMotionShape;
}

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

interface VelocityUniforms {
  [uniform: string]: THREE.IUniform;
  uPrevModelMatrix: { value: THREE.Matrix4 };
  uPrevViewProjection: { value: THREE.Matrix4 };
}

interface DepthCopyUniforms {
  [uniform: string]: THREE.IUniform;
  tDepth: { value: THREE.Texture | null };
}

/**
 * Temporal antialiasing for the live Three scene. Camera jitter supplies
 * subpixel samples; depth plus rigid motion proxies reproject into the previous
 * frame. A depth and neighborhood check rejects history at disocclusions,
 * while the feature remains user-selectable because unsupported WebGL context
 * combinations must be able to bypass it.
 */
export class TemporalAa {
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly velocityMaterial: THREE.ShaderMaterial;
  private readonly depthCopyMaterial: THREE.ShaderMaterial;
  private readonly velocityUniforms: VelocityUniforms;
  private readonly depthCopyUniforms: DepthCopyUniforms;
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
  private velocityTarget: THREE.WebGLRenderTarget | null = null;
  private readonly history: (THREE.WebGLRenderTarget | null)[] = [null, null];
  private readonly depthHistory: (THREE.WebGLRenderTarget | null)[] = [
    null,
    null,
  ];
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
  private readonly lastInverseViewProjection = new THREE.Matrix4();
  private readonly drawingBuffer = new THREE.Vector2();
  private readonly jitter = new THREE.Vector2();
  private readonly savedClearColor = new THREE.Color();
  private motionSources: readonly TemporalMotionSource[] = [];
  private readonly motionScene = new THREE.Scene();
  private readonly motionProxies = new Map<THREE.Object3D, THREE.Mesh>();
  private readonly playerProxyGeometry: THREE.CapsuleGeometry;
  private readonly ballProxyGeometry: THREE.SphereGeometry;
  private previousMotionMatrices = new WeakMap<
    THREE.Object3D,
    THREE.Matrix4
  >();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const velocityUniforms: VelocityUniforms = {
      uPrevModelMatrix: { value: new THREE.Matrix4() },
      uPrevViewProjection: { value: new THREE.Matrix4() },
    };
    this.velocityUniforms = velocityUniforms;
    this.velocityMaterial = new THREE.ShaderMaterial({
      uniforms: velocityUniforms,
      vertexShader: MOTION_VERTEX,
      fragmentShader: MOTION_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.velocityMaterial.onBeforeRender = (
      _renderer,
      _scene,
      _camera,
      _geometry,
      object,
    ) => {
      const previous = this.previousMotionMatrices.get(object);
      this.velocityUniforms.uPrevModelMatrix.value.copy(
        previous ?? object.matrixWorld,
      );
    };

    const depthCopyUniforms: DepthCopyUniforms = {
      tDepth: { value: null },
    };
    this.depthCopyUniforms = depthCopyUniforms;
    this.depthCopyMaterial = new THREE.ShaderMaterial({
      uniforms: depthCopyUniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: DEPTH_COPY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.resolveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        tMotion: { value: null },
        tPrevDepth: { value: null },
        uInvViewProjection: { value: new THREE.Matrix4() },
        uPrevViewProjection: { value: new THREE.Matrix4() },
        uInvPrevViewProjection: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2() },
        uHistoryWeight: { value: 0 },
        uHistoryValid: { value: 0 },
        uDisocclusionDepthM: { value: 0 },
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

    const proxy = VISUAL_TUNING.temporalAa.motionProxy;
    this.playerProxyGeometry = new THREE.CapsuleGeometry(
      proxy.playerRadiusM,
      proxy.playerLengthM,
      4,
      8,
    );
    this.playerProxyGeometry.translate(0, proxy.playerCenterYOffsetM, 0);
    this.ballProxyGeometry = new THREE.SphereGeometry(
      proxy.ballRadiusM,
      10,
      8,
    );
  }

  setMotionSources(sources: readonly TemporalMotionSource[]): void {
    this.motionSources = sources;
  }

  reset(): void {
    this.historyValid = false;
    this.frame = 0;
    // After a cut or a replay seek the previous proxy matrix is unrelated to
    // the next frame's history, so start motion vectors from zero again.
    this.previousMotionMatrices = new WeakMap();
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
    this.velocityTarget = this.createHalfFloatTarget(width, height);
    this.history[0] = this.createHalfFloatTarget(width, height);
    this.history[1] = this.createHalfFloatTarget(width, height);
    this.depthHistory[0] = this.createHalfFloatTarget(width, height);
    this.depthHistory[1] = this.createHalfFloatTarget(width, height);
    this.readIndex = 0;
    this.reset();
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
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
    this.collectMotionProxies();
    this.renderMotionVectors(camera);
    camera.clearViewOffset();

    const historyRead = this.history[this.readIndex] ?? null;
    const historyWrite = this.history[1 - this.readIndex] ?? null;
    const previousDepth = this.depthHistory[this.readIndex] ?? null;
    const depthWrite = this.depthHistory[1 - this.readIndex] ?? null;
    if (
      historyRead === null ||
      historyWrite === null ||
      previousDepth === null ||
      depthWrite === null
    ) {
      this.renderer.setRenderTarget(previousTarget);
      return;
    }

    const uniforms = this.resolveMaterial.uniforms as {
      tCurrent: { value: THREE.Texture | null };
      tHistory: { value: THREE.Texture | null };
      tDepth: { value: THREE.Texture | null };
      tMotion: { value: THREE.Texture | null };
      tPrevDepth: { value: THREE.Texture | null };
      uInvViewProjection: { value: THREE.Matrix4 };
      uPrevViewProjection: { value: THREE.Matrix4 };
      uInvPrevViewProjection: { value: THREE.Matrix4 };
      uResolution: { value: THREE.Vector2 };
      uHistoryWeight: { value: number };
      uHistoryValid: { value: number };
      uDisocclusionDepthM: { value: number };
    };
    uniforms.tCurrent.value = this.sceneTarget.texture;
    uniforms.tHistory.value = historyRead.texture;
    uniforms.tDepth.value = this.sceneTarget.depthTexture;
    uniforms.tMotion.value = this.velocityTarget?.texture ?? null;
    uniforms.tPrevDepth.value = previousDepth.texture;
    uniforms.uInvViewProjection.value.copy(this.inverseViewProjection);
    uniforms.uPrevViewProjection.value.copy(this.lastViewProjection);
    uniforms.uInvPrevViewProjection.value.copy(
      this.lastInverseViewProjection,
    );
    uniforms.uResolution.value.set(this.width, this.height);
    uniforms.uHistoryWeight.value = tuning.historyWeight;
    uniforms.uHistoryValid.value = this.historyValid ? 1 : 0;
    uniforms.uDisocclusionDepthM.value = tuning.disocclusionDepthM;

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
    this.copyDepth(depthWrite);
    this.fullscreenMesh.material = this.copyMaterial;
    this.renderer.setRenderTarget(previousTarget);

    this.updateMotionMatrices();
    this.lastViewProjection.copy(this.currentViewProjection);
    this.lastInverseViewProjection.copy(this.inverseViewProjection);
    this.historyValid = true;
    this.readIndex = 1 - this.readIndex;
  }

  dispose(): void {
    this.disposeTargets();
    this.resolveMaterial.dispose();
    this.copyMaterial.dispose();
    this.velocityMaterial.dispose();
    this.depthCopyMaterial.dispose();
    this.playerProxyGeometry.dispose();
    this.ballProxyGeometry.dispose();
    this.fullscreenMesh.geometry.dispose();
    this.motionScene.clear();
    this.motionProxies.clear();
  }

  private collectMotionProxies(): void {
    const active = new Set<THREE.Object3D>();
    for (const source of this.motionSources) {
      let proxy = this.motionProxies.get(source.object);
      if (proxy === undefined) {
        proxy = new THREE.Mesh(
          source.shape === "ball"
            ? this.ballProxyGeometry
            : this.playerProxyGeometry,
          this.velocityMaterial,
        );
        proxy.matrixAutoUpdate = false;
        proxy.frustumCulled = false;
        proxy.userData.motionShape = source.shape;
        this.motionScene.add(proxy);
        this.motionProxies.set(source.object, proxy);
      } else if (proxy.userData.motionShape !== source.shape) {
        proxy.geometry =
          source.shape === "ball"
            ? this.ballProxyGeometry
            : this.playerProxyGeometry;
        proxy.userData.motionShape = source.shape;
      }
      proxy.visible = true;
      active.add(source.object);
      proxy.matrix.copy(source.object.matrixWorld);
      proxy.matrixWorld.copy(source.object.matrixWorld);
      proxy.matrixWorldNeedsUpdate = false;
    }
    for (const [object, proxy] of this.motionProxies) {
      if (!active.has(object)) {
        proxy.visible = false;
      }
    }
  }

  private renderMotionVectors(camera: THREE.PerspectiveCamera): void {
    if (this.velocityTarget === null) {
      return;
    }
    const previousTarget = this.renderer.getRenderTarget();
    const savedAutoClear = this.renderer.autoClear;
    this.renderer.getClearColor(this.savedClearColor);
    const savedAlpha = this.renderer.getClearAlpha();

    this.renderer.setRenderTarget(this.velocityTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.autoClear = false;
    this.velocityUniforms.uPrevViewProjection.value.copy(
      this.lastViewProjection,
    );
    this.renderer.render(this.motionScene, camera);

    this.renderer.autoClear = savedAutoClear;
    this.renderer.setClearColor(this.savedClearColor, savedAlpha);
    this.renderer.setRenderTarget(previousTarget);
  }

  private copyDepth(target: THREE.WebGLRenderTarget): void {
    const sceneTarget = this.sceneTarget;
    if (sceneTarget === null || sceneTarget.depthTexture === null) {
      return;
    }
    const previousTarget = this.renderer.getRenderTarget();
    this.depthCopyUniforms.tDepth.value = sceneTarget.depthTexture;
    this.fullscreenMesh.material = this.depthCopyMaterial;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    this.renderer.setRenderTarget(previousTarget);
  }

  private updateMotionMatrices(): void {
    for (const proxy of this.motionProxies.values()) {
      if (!proxy.visible) {
        continue;
      }
      let matrix = this.previousMotionMatrices.get(proxy);
      if (matrix === undefined) {
        matrix = new THREE.Matrix4();
        this.previousMotionMatrices.set(proxy, matrix);
      }
      matrix.copy(proxy.matrixWorld);
    }
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

  private createHalfFloatTarget(
    width: number,
    height: number,
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
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
    this.velocityTarget?.dispose();
    this.history[0]?.dispose();
    this.history[1]?.dispose();
    this.depthHistory[0]?.dispose();
    this.depthHistory[1]?.dispose();
    this.sceneTarget = null;
    this.velocityTarget = null;
    this.history[0] = null;
    this.history[1] = null;
    this.depthHistory[0] = null;
    this.depthHistory[1] = null;
  }
}
