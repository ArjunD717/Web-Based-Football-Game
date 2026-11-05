// packages/client/src/render/three-authored-player.ts

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { Pitch } from "@fb/sim";
import { PLAYER_MATCH_ASSET_URL } from "../character/asset";
import { computeCharacterPose } from "./character-animation";
import { disposeObject } from "./three-dispose";
import {
  createControlledMarker,
  createNumberSprite,
  type MatchPlayerRig,
} from "./three-player";
import {
  facingToRotationY,
  pitchToWorld,
} from "./three-layout";
import { VISUAL_TUNING } from "./visualTuning";
import type { RenderPlayer, RenderTeamColors } from "./view";

const HIDDEN_DETAIL_MESH = /^(?:boot_sole|sock_trim|kit_cuff)/;

interface AuthoredTemplate {
  readonly scene: THREE.Group;
  readonly materials: ReadonlyMap<string, THREE.Material>;
  readonly modelBaseY: number;
}

interface AuthoredPalette {
  readonly materials: ReadonlyMap<string, THREE.Material>;
}

/**
 * Loads the authored GLB once. Match players are SkeletonUtils clones that
 * share geometry and texture memory but receive their own skeleton and team
 * palette.
 */
export class AuthoredPlayerLibrary {
  private template: AuthoredTemplate | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private readonly palettes = new Map<string, AuthoredPalette>();
  private disposed = false;

  get ready(): boolean {
    return this.template !== null;
  }

  load(): Promise<boolean> {
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }
    this.loadPromise = new GLTFLoader()
      .loadAsync(PLAYER_MATCH_ASSET_URL)
      .then((gltf) => {
        if (this.disposed) {
          disposeObject(gltf.scene);
          return false;
        }
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
        this.template = {
          scene,
          materials,
          modelBaseY: -bounds.min.y,
        };
        return true;
      })
      .catch((error: unknown) => {
        console.warn(
          "Authored player asset unavailable; keeping procedural match rigs.",
          error,
        );
        return false;
      });
    return this.loadPromise;
  }

  create(
    player: RenderPlayer,
    colors: RenderTeamColors,
  ): AuthoredPlayerRig | null {
    const template = this.template;
    if (template === null) {
      return null;
    }
    const palette = this.paletteFor(
      template,
      colors,
      player.goalkeeper,
    );
    return new AuthoredPlayerRig(template, palette, player);
  }

  dispose(): void {
    this.disposed = true;
    if (this.template !== null) {
      disposeObject(this.template.scene);
      this.template = null;
    }
    for (const palette of this.palettes.values()) {
      for (const material of palette.materials.values()) {
        material.dispose();
      }
    }
    this.palettes.clear();
  }

  private paletteFor(
    template: AuthoredTemplate,
    colors: RenderTeamColors,
    goalkeeper: boolean,
  ): AuthoredPalette {
    const key = [
      colors.primary,
      colors.secondary,
      colors.keeper,
      goalkeeper ? 1 : 0,
    ].join("|");
    const cached = this.palettes.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const shirtBase = material(template.materials, "kit_shirt");
    const shortsBase = material(template.materials, "kit_shorts");
    const socksBase = material(template.materials, "socks_solid");
    const materials = new Map<string, THREE.Material>();
    const shirtColor = goalkeeper ? colors.keeper : colors.primary;
    const shortsColor = goalkeeper ? "#101817" : colors.secondary;
    const socksColor = goalkeeper ? colors.keeper : colors.primary;
    const collarColor = goalkeeper ? "#0c1a18" : colors.secondary;

    materials.set(
      "kit_shirt",
      fabricMaterial(shirtColor, shirtBase),
    );
    materials.set(
      "kit_shorts",
      fabricMaterial(shortsColor, shortsBase),
    );
    materials.set(
      "socks_solid",
      fabricMaterial(socksColor, socksBase),
    );
    materials.set("kit_collar", solidMaterial(collarColor));

    const palette = { materials };
    this.palettes.set(key, palette);
    return palette;
  }
}

export class AuthoredPlayerRig implements MatchPlayerRig {
  readonly root = new THREE.Group();

  private readonly visual = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly overlays = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly switchRing: THREE.Mesh;
  private readonly marker: THREE.Sprite;
  private readonly card: THREE.Mesh;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly boneRest = new Map<string, THREE.Quaternion>();
  private readonly workingQuaternion = new THREE.Quaternion();
  private readonly deltaQuaternion = new THREE.Quaternion();
  private readonly workingEuler = new THREE.Euler();
  private lastState: RenderPlayer["state"] | null = null;
  private stateStartedElapsed = 0;
  private lastElapsed: number | null = null;
  private stridePhase = 0;

  constructor(
    template: AuthoredTemplate,
    palette: AuthoredPalette,
    player: RenderPlayer,
  ) {
    this.root.name = `authored-player-${player.id}`;
    this.root.scale.setScalar(VISUAL_TUNING.playerScale);

    // glTF +Z is the character's forward. The existing pitch contract uses
    // local +X forward, so this wrapper preserves facingToRotationY.
    this.visual.rotation.y = Math.PI / 2;
    this.root.add(this.visual);
    this.visual.add(this.tilt);

    const model = cloneSkeleton(template.scene) as THREE.Group;
    model.position.y = template.modelBaseY;
    this.tilt.add(model);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const mesh = object as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(
            (entry) => palette.materials.get(entry.name) ?? entry,
          )
        : palette.materials.get(mesh.material.name) ?? mesh.material;
      mesh.visible = !HIDDEN_DETAIL_MESH.test(mesh.name);
      // The blob shadow is the authored player's shadow. Casting the full
      // skinned mesh into the 2K shadow map costs more than the main pass.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (mesh instanceof THREE.SkinnedMesh) {
        mesh.frustumCulled = false;
      }
    });
    model.traverse((object) => {
      if (object instanceof THREE.Bone) {
        const bone = object as THREE.Bone<THREE.Object3DEventMap>;
        this.bones.set(bone.name, bone);
        this.boneRest.set(bone.name, bone.quaternion.clone());
      }
    });

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.overlays.add(this.shadow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.08, 36),
      new THREE.MeshBasicMaterial({
        color: 0x62f6ff,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.028;
    this.overlays.add(this.ring);

    this.switchRing = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.12, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffbd5f,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.switchRing.rotation.x = -Math.PI / 2;
    this.switchRing.position.y = 0.026;
    this.switchRing.visible = false;
    this.overlays.add(this.switchRing);

    this.marker = createControlledMarker();
    this.marker.position.y = 2.75;
    this.marker.scale.set(0.9, 0.9, 0.9);
    this.overlays.add(this.marker);

    const number = createNumberSprite(player.number);
    number.position.y = 2.22;
    this.overlays.add(number);

    this.card = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.22, 0.035),
      new THREE.MeshBasicMaterial({ color: 0xf1c45c }),
    );
    this.card.position.set(0.08, 2.02, 0.2);
    this.card.visible = false;
    this.overlays.add(this.card);

    this.root.add(this.overlays);
  }

  update(
    pitch: Pitch,
    player: RenderPlayer,
    elapsed: number,
    tick: number,
  ): void {
    if (player.sentOff) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const world = pitchToWorld(pitch, player.x, player.y);
    this.root.position.set(world.x, world.y, world.z);
    this.root.rotation.y = facingToRotationY(player.facing);
    this.ring.visible = player.controlled;
    this.ring.scale.setScalar(1 + Math.sin(tick * 0.14) * 0.08);
    this.switchRing.visible = player.switchTarget && !player.controlled;
    this.switchRing.scale.setScalar(1 + Math.sin(tick * 0.1 + 1.3) * 0.05);
    this.marker.visible = player.controlled;
    this.marker.position.y = 2.75 + Math.sin(tick * 0.12) * 0.09;
    this.card.visible = player.yellowCards > 0;

    const previousElapsed = this.lastElapsed;
    const rewound = previousElapsed !== null && elapsed < previousElapsed;
    if (rewound) {
      this.lastState = null;
      this.lastElapsed = null;
    }
    if (player.state !== this.lastState) {
      this.lastState = player.state;
      this.stateStartedElapsed = elapsed;
    }
    this.lastElapsed = elapsed;
    const stateAge = Math.max(0, elapsed - this.stateStartedElapsed);
    const deltaSeconds =
      previousElapsed === null || rewound
        ? 0
        : Math.max(0, elapsed - previousElapsed);

    const cadence = cadenceFor(player.state);
    if (previousElapsed === null || rewound) {
      this.stridePhase = elapsed * cadence + player.number * 0.63;
    } else {
      this.stridePhase += deltaSeconds * cadence;
    }

    const target = computeCharacterPose(
      player.state,
      this.stridePhase,
      player.stamina,
      stateAge,
    );
    const blend =
      deltaSeconds === 0
        ? 1
        : 1 - Math.exp(-deltaSeconds * VISUAL_TUNING.authoredPlayer.poseBlendRate);

    for (const [name, rest] of this.boneRest) {
      const bone = this.bones.get(name);
      if (bone === undefined) {
        continue;
      }
      const rotation = target.rotations[name];
      this.workingQuaternion.copy(rest);
      if (rotation !== undefined) {
        this.workingEuler.set(rotation.x, rotation.y, rotation.z, "XYZ");
        this.deltaQuaternion.setFromEuler(this.workingEuler);
        this.workingQuaternion.multiply(this.deltaQuaternion);
      }
      bone.quaternion.slerp(this.workingQuaternion, blend);
    }

    this.tilt.position.y =
      deltaSeconds === 0
        ? target.rootLift
        : dampValue(this.tilt.position.y, target.rootLift, deltaSeconds);
    this.tilt.rotation.x =
      deltaSeconds === 0
        ? target.bodyTilt
        : dampValue(this.tilt.rotation.x, target.bodyTilt, deltaSeconds);
    this.tilt.rotation.z =
      deltaSeconds === 0
        ? target.bodyLean
        : dampValue(this.tilt.rotation.z, target.bodyLean, deltaSeconds);

    this.shadow.scale.setScalar(
      1 - Math.min(0.18, player.state === "slide" ? 0.18 : 0),
    );
  }

  dispose(): void {
    disposeObject(this.overlays);
  }
}

function dampValue(current: number, goal: number, deltaSeconds: number): number {
  return THREE.MathUtils.damp(
    current,
    goal,
    VISUAL_TUNING.authoredPlayer.poseBlendRate,
    deltaSeconds,
  );
}

function cadenceFor(state: RenderPlayer["state"]): number {
  switch (state) {
    case "sprint":
      return 11;
    case "jog":
      return 7;
    case "dribble":
      return 8;
    case "celebrate":
      return 4;
    default:
      return 3;
  }
}

function material(
  materials: ReadonlyMap<string, THREE.Material>,
  name: string,
): THREE.MeshStandardMaterial | null {
  const found = materials.get(name);
  return found instanceof THREE.MeshStandardMaterial ? found : null;
}

function fabricMaterial(
  color: string,
  source: THREE.MeshStandardMaterial | null,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: source?.roughness ?? 0.76,
    metalness: 0,
    normalMap: source?.normalMap ?? null,
    normalScale: source?.normalScale.clone() ?? new THREE.Vector2(1, 1),
    side: THREE.FrontSide,
  });
}

function solidMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0,
  });
}
