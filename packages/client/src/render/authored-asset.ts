// packages/client/src/render/authored-asset.ts

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  PLAYER_LOW_ASSET_URL,
  PLAYER_LOW_KTX2_URL,
  PLAYER_LOW_MESHOPT_URL,
  PLAYER_MATCH_ASSET_URL,
  PLAYER_MATCH_KTX2_URL,
  PLAYER_MATCH_MESHOPT_URL,
} from "../character/asset";
import {
  authoredAssetBudgetIssues,
  type AuthoredAssetKind,
} from "./asset-budget";

export type AuthoredDelivery = "ktx2" | "meshopt" | "plain";

export interface AuthoredTemplate {
  readonly scene: THREE.Group;
  readonly materials: ReadonlyMap<string, THREE.Material>;
  readonly modelBaseY: number;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  readonly delivery: AuthoredDelivery;
}

export interface AuthoredTemplates {
  readonly match: AuthoredTemplate | null;
  readonly low: AuthoredTemplate | null;
}

interface TemplateVariant {
  readonly delivery: AuthoredDelivery;
  readonly url: string;
}

const BASIS_TRANSCODER_JS = "/basis/basis_transcoder.js";
const BASIS_TRANSCODER_WASM = "/basis/basis_transcoder.wasm";
const KTX2_LOAD_TIMEOUT_MS = 12_000;

let templatesPromise: Promise<AuthoredTemplates> | null = null;
let templates: AuthoredTemplates | null = null;
let ktx2LoaderPromise: Promise<KTX2Loader | null> | undefined;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function basisDecoderReady(): Promise<boolean> {
  if (typeof WebAssembly !== "object" || typeof Worker !== "function") {
    return false;
  }
  try {
    const [jsResponse, wasmResponse] = await Promise.all([
      fetch(BASIS_TRANSCODER_JS),
      fetch(BASIS_TRANSCODER_WASM),
    ]);
    if (!jsResponse.ok || !wasmResponse.ok) {
      return false;
    }
    const jsContentType = jsResponse.headers.get("content-type") ?? "";
    const contentType = wasmResponse.headers.get("content-type") ?? "";
    if (
      jsContentType.includes("text/html") ||
      contentType.includes("text/html")
    ) {
      return false;
    }
    const wasm = new Uint8Array(await wasmResponse.arrayBuffer());
    return (
      wasm.length > 4 &&
      wasm[0] === 0x00 &&
      wasm[1] === 0x61 &&
      wasm[2] === 0x73 &&
      wasm[3] === 0x6d
    );
  } catch {
    return false;
  }
}

/**
 * KTX2Loader needs a renderer's extension support before it can choose a
 * transcode target. The lobby preloads assets before the match renderer
 * exists, so probe a throwaway context instead of constructing a renderer.
 */
async function createKtx2Loader(): Promise<KTX2Loader | null> {
  if (!(await basisDecoderReady()) || typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (gl === null) {
    return null;
  }
  const extensions = {
    has(name: string): boolean {
      try {
        return gl.getExtension(name) !== null;
      } catch {
        return false;
      }
    },
    get(name: string): unknown {
      try {
        return gl.getExtension(name);
      } catch {
        return null;
      }
    },
  };
  try {
    const loader = new KTX2Loader().setTranscoderPath("/basis/");
    loader.detectSupport({
      isWebGPURenderer: false,
      extensions,
    } as unknown as THREE.WebGLRenderer);
    return loader;
  } catch (error: unknown) {
    console.warn("KTX2 support probe failed; using compressed fallbacks.", error);
    return null;
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function getKtx2Loader(): Promise<KTX2Loader | null> {
  if (ktx2LoaderPromise === undefined) {
    ktx2LoaderPromise = createKtx2Loader();
  }
  return ktx2LoaderPromise;
}

function countTriangles(scene: THREE.Object3D): number {
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const geometry = (object as THREE.Mesh).geometry;
    const count =
      geometry.index?.count ??
      geometry.getAttribute("position")?.count ??
      0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function countBones(scene: THREE.Object3D): number {
  let bones = 0;
  scene.traverse((object) => {
    if (object instanceof THREE.Bone) {
      bones += 1;
    }
  });
  return bones;
}

function warnBudget(
  kind: AuthoredAssetKind,
  scene: THREE.Object3D,
  delivery: AuthoredDelivery,
  bytes: number | null,
): void {
  const issues = authoredAssetBudgetIssues({
    kind,
    compressedBytes: bytes,
    triangles: countTriangles(scene),
    bones: countBones(scene),
  });
  if (issues.length > 0) {
    console.warn(
      `Authored ${kind} ${delivery} asset exceeds budget:`,
      issues,
    );
  }
}

function parseTemplate(
  gltf: {
    readonly scene: THREE.Group;
    readonly animations: readonly THREE.AnimationClip[];
  },
  kind: AuthoredAssetKind,
  delivery: AuthoredDelivery,
  bytes: number | null,
): AuthoredTemplate {
  const scene = gltf.scene;
  const materials = new Map<string, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const mesh = object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    const source = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const entry of source) {
      materials.set(entry.name, entry);
      if (entry.name === "eye_decal") {
        entry.transparent = true;
        entry.depthWrite = false;
        entry.alphaTest = 0.02;
        entry.side = THREE.DoubleSide;
        entry.polygonOffset = true;
        entry.polygonOffsetFactor = -2;
      }
    }
  });
  const bounds = new THREE.Box3().setFromObject(scene);
  warnBudget(kind, scene, delivery, bytes);
  return {
    scene,
    materials,
    modelBaseY: -bounds.min.y,
    clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
    delivery,
  };
}

async function fetchBytes(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const length = response.headers.get("content-length");
    if (length === null) {
      return null;
    }
    const size = Number.parseInt(length, 10);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

async function loadVariant(
  kind: AuthoredAssetKind,
  variant: TemplateVariant,
): Promise<AuthoredTemplate> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (variant.delivery === "ktx2") {
    const decoder = await getKtx2Loader();
    if (decoder === null) {
      throw new Error("KTX2 transcoding is unavailable in this browser");
    }
    loader.setKTX2Loader(decoder);
  }
  const bytes = await fetchBytes(variant.url);
  const loading = loader.loadAsync(variant.url);
  const gltf =
    variant.delivery === "ktx2"
      ? await withTimeout(
          loading,
          KTX2_LOAD_TIMEOUT_MS,
          "KTX2 template load timed out",
        )
      : await loading;
  return parseTemplate(gltf, kind, variant.delivery, bytes);
}

async function loadArchivedTemplate(
  kind: AuthoredAssetKind,
  variants: readonly TemplateVariant[],
): Promise<AuthoredTemplate | null> {
  for (const variant of variants) {
    try {
      return await loadVariant(kind, variant);
    } catch (error: unknown) {
      console.warn(
        `Authored ${kind} ${variant.delivery} asset unavailable; trying the next variant.`,
        error,
      );
    }
  }
  console.warn(
    `Authored ${kind} assets unavailable; keeping procedural players.`,
  );
  return null;
}

/**
 * Load the KTX2 templates first, then the meshopt geometry templates, then
 * the original WebP templates. The lobby warms all variants during its first
 * paint.
 */
export function loadAuthoredTemplates(): Promise<AuthoredTemplates> {
  if (templates !== null) {
    return Promise.resolve(templates);
  }
  if (templatesPromise !== null) {
    return templatesPromise;
  }
  templatesPromise = Promise.all([
    loadArchivedTemplate("match", [
      { delivery: "ktx2", url: PLAYER_MATCH_KTX2_URL },
      { delivery: "meshopt", url: PLAYER_MATCH_MESHOPT_URL },
      { delivery: "plain", url: PLAYER_MATCH_ASSET_URL },
    ]),
    loadArchivedTemplate("low", [
      { delivery: "ktx2", url: PLAYER_LOW_KTX2_URL },
      { delivery: "meshopt", url: PLAYER_LOW_MESHOPT_URL },
      { delivery: "plain", url: PLAYER_LOW_ASSET_URL },
    ]),
  ]).then(([match, low]) => {
    templates = { match, low };
    return templates;
  });
  return templatesPromise;
}

/** Fire-and-forget warm-up used by the lobby entry point. */
export function preloadAuthoredPlayer(): void {
  void loadAuthoredTemplates();
}
