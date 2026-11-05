// packages/client/src/character/main.ts

import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import "./character.css";
import { PLAYER_ASSET_URL } from "./asset";
import { poseFrame, type LabPoseName } from "./pose";

const CHARACTER_HEIGHT_M = 1.82;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

type CameraView = "front" | "three-quarter" | "profile" | "back";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
};

const host = byId<HTMLDivElement>("canvas-host");
const canvas = byId<HTMLCanvasElement>("lab-canvas");
const loadPanel = byId<HTMLDivElement>("loader");
const loadBar = byId<HTMLSpanElement>("load-progress");
const loadStatus = byId<HTMLParagraphElement>("load-status");
const errorPanel = byId<HTMLDivElement>("stage-error");
const errorText = byId<HTMLParagraphElement>("stage-error-text");
const viewLabel = byId<HTMLSpanElement>("view-name");
const poseLabel = byId<HTMLSpanElement>("pose-name");
const triCount = byId<HTMLSpanElement>("tri-count");
const drawCount = byId<HTMLSpanElement>("draw-count");
const ruler = byId<HTMLDivElement>("height-ruler");

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
} catch (error) {
  showError(
    error instanceof Error
      ? error.message
      : "WebGL could not start on this device.",
  );
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07100e, 5.5, 12);

const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
camera.position.set(2.05, 1.45, 3.2);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.98, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 6.2;
controls.minPolarAngle = 0.28;
controls.maxPolarAngle = 1.62;
controls.autoRotate = !reducedMotion;
controls.autoRotateSpeed = 0.52;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xb6d4ce, 0x07100d, 0.7));

const key = new THREE.DirectionalLight(0xffead1, 3.1);
key.position.set(3.2, 5.2, 4.1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -2.4;
key.shadow.camera.right = 2.4;
key.shadow.camera.top = 3.2;
key.shadow.camera.bottom = -1;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.bias = -0.0004;
scene.add(key);

const fill = new THREE.DirectionalLight(0x65b7bd, 1.2);
fill.position.set(-4, 2.4, 1.8);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xf0b25a, 2.4);
rim.position.set(0.4, 3.2, -3.8);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.7, 96),
  new THREE.MeshStandardMaterial({
    color: 0x0b1512,
    roughness: 0.86,
    metalness: 0.02,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002;
ground.receiveShadow = true;
scene.add(ground);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(1.18, 1.2, 96),
  new THREE.MeshBasicMaterial({
    color: 0x4caaa0,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.003;
scene.add(ring);

const axisLine = new THREE.Mesh(
  new THREE.PlaneGeometry(4.4, 0.002),
  new THREE.MeshBasicMaterial({
    color: 0xe9e4d8,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  }),
);
axisLine.rotation.x = -Math.PI / 2;
axisLine.position.y = 0.003;
scene.add(axisLine);

let character: THREE.Group | null = null;
let skeleton: THREE.SkeletonHelper | null = null;
const boneRest = new Map<string, THREE.Quaternion>();
const bones = new Map<string, THREE.Bone>();
let currentPose: LabPoseName = "idle";
let modelBaseY = 0;
let cameraGoal: { position: THREE.Vector3; target: THREE.Vector3 } | null =
  null;

const cameraViews: Record<
  CameraView,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  front: { position: [0, 1.28, 3.45], target: [0, 1.0, 0] },
  "three-quarter": { position: [2.05, 1.45, 3.2], target: [0, 0.98, 0] },
  profile: { position: [3.55, 1.34, 0.22], target: [0, 1.0, 0] },
  back: { position: [0, 1.32, -3.45], target: [0, 1.02, 0] },
};

const loader = new GLTFLoader();
loader.load(
  PLAYER_ASSET_URL,
  (gltf) => {
    character = gltf.scene;
    character.name = "player-01-character";

    character.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.castShadow = true;
      object.receiveShadow = true;
      if (object instanceof THREE.SkinnedMesh) {
        object.frustumCulled = false;
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          continue;
        }
        material.envMapIntensity = 0.82;
        if (material.name === "eye_decal") {
          material.transparent = true;
          material.depthWrite = false;
          material.alphaTest = 0.02;
          material.side = THREE.DoubleSide;
          material.polygonOffset = true;
          material.polygonOffsetFactor = -2;
        }
        // The GLB carries COLOR_0 for skin and cropped hair. GLTFLoader
        // normally enables this, but make the requirement explicit.
        if (material.name === "skin") {
          material.vertexColors = true;
          material.needsUpdate = true;
        }
      }
    });

    const bounds = new THREE.Box3().setFromObject(character);
    modelBaseY = -bounds.min.y;
    character.position.y = modelBaseY;
    scene.add(character);

    character.traverse((object) => {
      if (object instanceof THREE.Bone) {
        const bone = object as THREE.Bone<THREE.Object3DEventMap>;
        bones.set(bone.name, bone);
        boneRest.set(bone.name, bone.quaternion.clone());
      }
    });

    skeleton = new THREE.SkeletonHelper(character);
    skeleton.visible = false;
    (skeleton.material as THREE.LineBasicMaterial).transparent = true;
    (skeleton.material as THREE.LineBasicMaterial).opacity = 0.65;
    (skeleton.material as THREE.LineBasicMaterial).depthTest = false;
    scene.add(skeleton);

    let triangles = 0;
    character.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.BufferGeometry) {
        const geometry = object.geometry as THREE.BufferGeometry;
        const index = geometry.getIndex();
        const position = geometry.getAttribute("position") as
          | THREE.BufferAttribute
          | undefined;
        const vertexCount = index?.count ?? position?.count ?? 0;
        triangles += vertexCount / 3;
      }
    });
    triCount.textContent = `${Math.round(triangles).toLocaleString("en-GB")}`;

    loadStatus.textContent = "Kit fitted. Ready for inspection.";
    loadBar.style.transform = "scaleX(1)";
    window.setTimeout(() => {
      loadPanel.classList.add("is-hidden");
      document.body.classList.add("is-ready");
    }, 220);

    applyPose();
    window.setTimeout(() => {
      drawCount.textContent = String(renderer.info.render.calls);
    }, 120);
  },
  (event) => {
    if (event.total > 0) {
      const progress = Math.min(1, event.loaded / event.total);
      loadBar.style.transform = `scaleX(${progress})`;
      loadStatus.textContent = `Loading kit and rig · ${Math.round(progress * 100)}%`;
    } else {
      loadStatus.textContent = "Loading kit and rig";
    }
  },
  (error) => {
    showError(
      error instanceof Error
        ? error.message
        : "The player asset could not be loaded.",
    );
  },
);

function applyPose(): void {
  applyPoseAt(reducedMotion ? 0 : performance.now() / 1000);
}

function setPose(name: LabPoseName): void {
  currentPose = name;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-pose]",
  )) {
    const active = button.dataset.pose === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  poseLabel.textContent = name;
  applyPose();
}

function setView(name: CameraView): void {
  const goal = cameraViews[name];
  cameraGoal = {
    position: new THREE.Vector3(...goal.position),
    target: new THREE.Vector3(...goal.target),
  };
  controls.autoRotate = false;
  autoRotate.checked = false;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-view]",
  )) {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  viewLabel.textContent = name.replace("-", " ");
}

function setWireframe(enabled: boolean): void {
  character?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.wireframe = enabled;
      }
    }
  });
}

function showError(message: string): void {
  loadPanel.classList.add("is-hidden");
  errorPanel.hidden = false;
  errorText.textContent = message;
}

const autoRotate = byId<HTMLInputElement>("auto-rotate");
autoRotate.checked = controls.autoRotate;
autoRotate.addEventListener("change", () => {
  controls.autoRotate = autoRotate.checked;
});

const skeletonToggle = byId<HTMLInputElement>("show-skeleton");
skeletonToggle.addEventListener("change", () => {
  if (skeleton !== null) {
    skeleton.visible = skeletonToggle.checked;
  }
});

const wireframeToggle = byId<HTMLInputElement>("show-wireframe");
wireframeToggle.addEventListener("change", () => {
  setWireframe(wireframeToggle.checked);
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-pose]",
)) {
  button.addEventListener("click", () => {
    const pose = button.dataset.pose as LabPoseName | undefined;
    if (pose !== undefined) {
      setPose(pose);
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-view]",
)) {
  button.addEventListener("click", () => {
    const view = button.dataset.view as CameraView | undefined;
    if (view !== undefined) {
      setView(view);
    }
  });
}

canvas.addEventListener("pointerdown", () => {
  if (controls.autoRotate) {
    controls.autoRotate = false;
    autoRotate.checked = false;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }
  const poseKeys: Record<string, LabPoseName> = {
    "1": "idle",
    "2": "jog",
    "3": "sprint",
    "4": "strike",
    "5": "leap",
    "6": "celebrate",
  };
  const pose = poseKeys[event.key];
  if (pose !== undefined) {
    setPose(pose);
    return;
  }
  const viewKeys: Record<string, CameraView> = {
    f: "front",
    s: "profile",
    b: "back",
    t: "three-quarter",
  };
  const view = viewKeys[event.key.toLowerCase()];
  if (view !== undefined) {
    setView(view);
    return;
  }
  if (event.key.toLowerCase() === "r") {
    autoRotate.checked = !autoRotate.checked;
    controls.autoRotate = autoRotate.checked;
  }
});

function resize(): void {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(host);
resize();

const headWorld = new THREE.Vector3();
const footWorld = new THREE.Vector3();

function updateRuler(): void {
  if (character === null) {
    return;
  }
  const width = host.clientWidth;
  const height = host.clientHeight;
  headWorld.set(0, CHARACTER_HEIGHT_M, 0).project(camera);
  footWorld.set(0, 0, 0).project(camera);
  const headY = ((1 - headWorld.y) / 2) * height;
  const footY = ((1 - footWorld.y) / 2) * height;
  const top = Math.min(headY, footY);
  const span = Math.max(12, Math.abs(footY - headY));
  ruler.style.top = `${top}px`;
  ruler.style.height = `${span}px`;
  ruler.style.left = `${Math.max(10, width * 0.075)}px`;
  for (const label of ruler.querySelectorAll<HTMLElement>("[data-metres]")) {
    const metres = Number(label.dataset.metres);
    const fraction = Math.min(1, Math.max(0, metres / CHARACTER_HEIGHT_M));
    label.style.top = `${(1 - fraction) * 100}%`;
  }
}

let lastFrame = performance.now();
let elapsed = 0;
let firstRender = true;

function render(): void {
  requestAnimationFrame(render);
  const now = performance.now();
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  elapsed += delta;

  if (cameraGoal !== null) {
    const ease = 1 - Math.exp(-delta * 9);
    camera.position.lerp(cameraGoal.position, ease);
    controls.target.lerp(cameraGoal.target, ease);
    if (camera.position.distanceTo(cameraGoal.position) < 0.004) {
      camera.position.copy(cameraGoal.position);
      controls.target.copy(cameraGoal.target);
      cameraGoal = null;
    }
  }

  controls.update();

  if (character !== null) {
    const animationTime = reducedMotion ? 0 : elapsed;
    applyPoseAt(animationTime);
  }
  renderer.render(scene, camera);
  updateRuler();
  if (firstRender) {
    firstRender = false;
    drawCount.textContent = String(renderer.info.render.calls);
  }
}

function applyPoseAt(time: number): void {
  if (character === null) {
    return;
  }
  const frame = poseFrame(currentPose, time);
  for (const [name, quaternion] of boneRest) {
    const bone = bones.get(name);
    if (bone !== undefined) {
      bone.quaternion.copy(quaternion);
    }
  }
  const delta = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const [name, rotation] of Object.entries(frame.rotations)) {
    const bone = bones.get(name);
    const rest = boneRest.get(name);
    if (bone === undefined || rest === undefined) {
      continue;
    }
    euler.set(rotation.x, rotation.y, rotation.z, "XYZ");
    delta.setFromEuler(euler);
    bone.quaternion.copy(rest).multiply(delta);
  }
  character.position.y = modelBaseY + frame.rootLift;
}

setPose("idle");
setView("three-quarter");
render();
