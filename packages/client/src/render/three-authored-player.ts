// packages/client/src/render/three-authored-player.ts

import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { Pitch } from "@fb/sim";
import { appearanceFor } from "./character-appearance";
import { computeCharacterPose } from "./character-animation";
import {
  AUTHORED_CLIP_PLAN,
  clipSpecFor,
} from "./character-clip-plan";
import {
  loadAuthoredTemplates,
  type AuthoredTemplate,
} from "./authored-asset";
import { cheapMaterialFor } from "./authored-material-lod";
import {
  createDissolveMaterial,
  type DissolveMaterial,
} from "./geometry-dissolve";
import {
  geometryFadeBudgetAvailable,
  geometryFadeProgress,
  type PlayerGeometry,
} from "./player-geometry";
import {
  footPlantOffset,
  groundedLiftFor,
} from "./character-grounding";
import {
  createFootLockState,
  resetFootLock,
  solveTwoBoneIk,
  updateFootLock,
  type FootLockState,
} from "./foot-ik";
import {
  createFootstepClock,
  resetFootstepClock,
  updateFootstepClock,
  type FootstepSink,
} from "./footsteps";
import {
  gaitPlaybackScale,
  strideReferenceScale,
  updateGaitSpeed,
} from "./gait";
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
import { shouldAnimateAtTick, type PlayerDetail } from "./player-lod";
import type { RenderPlayer, RenderTeamColors } from "./view";

const HIDDEN_DETAIL_MESH = /^(?:boot_sole|sock_trim|kit_cuff)/;

interface LegRig {
  readonly thigh: THREE.Bone;
  readonly calf: THREE.Bone;
  readonly foot: THREE.Bone;
  readonly upperLengthM: number;
  readonly lowerLengthM: number;
  readonly lock: FootLockState;
  readonly target: THREE.Vector3;
  hasTarget: boolean;
  weight: number;
}

interface AuthoredPalette {
  readonly materials: ReadonlyMap<string, THREE.Material>;
}

type MaterialLike = THREE.Material | THREE.Material[];

interface GeometrySlot {
  readonly mesh: THREE.Mesh;
  readonly highGeometry: THREE.BufferGeometry;
  readonly highVisible: boolean;
  lowGeometry: THREE.BufferGeometry | null;
  readonly baseMaterial: MaterialLike;
  readonly cheapMaterial: MaterialLike | null;
}

interface GeometryFadeEntry {
  readonly slot: GeometrySlot;
  readonly source: readonly DissolveMaterial[];
  readonly targetMesh: THREE.SkinnedMesh | null;
  readonly target: readonly DissolveMaterial[];
}

interface GeometryFade {
  readonly from: PlayerGeometry;
  readonly to: PlayerGeometry;
  elapsed: number;
  readonly duration: number;
  readonly entries: readonly GeometryFadeEntry[];
}

/**
 * Loads the authored GLB once. Match players are SkeletonUtils clones that
 * share geometry and texture memory but receive their own skeleton and team
 * palette.
 */
export class AuthoredPlayerLibrary {
  private template: AuthoredTemplate | null = null;
  private lowTemplate: AuthoredTemplate | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private readonly palettes = new Map<string, AuthoredPalette>();
  private footstepSink: FootstepSink | null = null;
  private disposed = false;

  get ready(): boolean {
    return this.template !== null;
  }

  get lowReady(): boolean {
    return this.lowTemplate !== null;
  }

  get lowTemplateAsset(): AuthoredTemplate | null {
    return this.lowTemplate;
  }

  load(): Promise<boolean> {
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }
    this.loadPromise = loadAuthoredTemplates().then((templates) => {
      if (this.disposed) {
        return false;
      }
      this.template = templates.match;
      this.lowTemplate = templates.low;
      return templates.match !== null;
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
    const rig = new AuthoredPlayerRig(
      template,
      this.lowTemplate,
      palette,
      player,
    );
    rig.setFootstepSink(this.footstepSink);
    return rig;
  }

  setFootstepSink(sink: FootstepSink | null): void {
    this.footstepSink = sink;
  }

  dispose(): void {
    this.disposed = true;
    this.template = null;
    this.lowTemplate = null;
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
      template === this.lowTemplate ? "low" : "high",
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
  private static activeGeometryFades = 0;

  readonly root = new THREE.Group();

  get geometry(): PlayerGeometry {
    return this.lowAttached ? this.visualGeometry : "high";
  }

  private readonly visual = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly overlays = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadowMeshes: THREE.Mesh[] = [];
  private readonly ring: THREE.Mesh;
  private readonly switchRing: THREE.Mesh;
  private readonly marker: THREE.Sprite;
  private readonly card: THREE.Mesh;
  private readonly numberSprite: THREE.Sprite;
  private detail: PlayerDetail = "full";
  private shadowCasting = false;
  private materialLod = false;
  private geometryLevel: PlayerGeometry = "high";
  private visualGeometry: PlayerGeometry = "high";
  private geometryFade: GeometryFade | null = null;
  private lowAttached = false;
  private readonly geometrySlots: GeometrySlot[] = [];
  private readonly outgoingFadeMaterials = new Map<
    THREE.Material,
    DissolveMaterial
  >();
  private readonly incomingFadeMaterials = new Map<
    THREE.Material,
    DissolveMaterial
  >();
  private readonly fadeTargets = new Map<
    GeometrySlot,
    THREE.SkinnedMesh
  >();
  private animationStride = 1;
  private readonly animationPhase: number;
  private forceAnimation = true;
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly boneRest = new Map<string, THREE.Quaternion>();
  private readonly footBones: THREE.Bone[] = [];
  private readonly legs: LegRig[] = [];
  private readonly rootWorld = new THREE.Vector3();
  private readonly footWorld = new THREE.Vector3();
  private readonly lastRootPosition = new THREE.Vector3();
  private readonly lastGaitPosition = new THREE.Vector3();
  private hasLastRootPosition = false;
  private hasLastGaitPosition = false;
  private gaitSpeedMps = 0;
  private readonly strideScale: number;
  private lastFootIkState: RenderPlayer["state"] | null = null;
  private lastFootstepElapsed = Number.NEGATIVE_INFINITY;
  private readonly footstepClock = createFootstepClock();
  private footstepSink: FootstepSink | null = null;
  private restAnkleY = Number.POSITIVE_INFINITY;
  private groundOffset = 0;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly useClips: boolean;
  private readonly clipActions = new Map<
    RenderPlayer["state"],
    THREE.AnimationAction
  >();
  private activeClipState: RenderPlayer["state"] | null = null;
  private activeClipAction: THREE.AnimationAction | null = null;
  private readonly clipPhaseOffset: number;
  private readonly workingQuaternion = new THREE.Quaternion();
  private readonly deltaQuaternion = new THREE.Quaternion();
  private readonly workingEuler = new THREE.Euler();
  private readonly ikHip = new THREE.Vector3();
  private readonly ikKnee = new THREE.Vector3();
  private readonly ikAnkle = new THREE.Vector3();
  private readonly ikPole = new THREE.Vector3();
  private readonly ikSolvedKnee = new THREE.Vector3();
  private readonly ikSolvedAnkle = new THREE.Vector3();
  private readonly ikCurrentDirection = new THREE.Vector3();
  private readonly ikDesiredDirection = new THREE.Vector3();
  private readonly ikDeltaQuaternion = new THREE.Quaternion();
  private readonly ikWorldQuaternion = new THREE.Quaternion();
  private readonly ikParentQuaternion = new THREE.Quaternion();
  private readonly ikRootQuaternion = new THREE.Quaternion();
  private lastState: RenderPlayer["state"] | null = null;
  private stateStartedElapsed = 0;
  private lastElapsed: number | null = null;
  private stridePhase = 0;

  constructor(
    template: AuthoredTemplate,
    lowTemplate: AuthoredTemplate | null,
    palette: AuthoredPalette,
    player: RenderPlayer,
  ) {
    this.root.name = `authored-player-${player.id}`;
    this.root.scale.setScalar(VISUAL_TUNING.playerScale);
    this.animationPhase = player.number % 4;
    this.strideScale = strideReferenceScale(
      player.sprintSpeed ?? VISUAL_TUNING.authoredPlayer.stride.neutralRating,
      VISUAL_TUNING.authoredPlayer.stride,
    );

    // glTF +Z is the character's forward. The existing pitch contract uses
    // local +X forward, so this wrapper preserves facingToRotationY.
    this.visual.rotation.y = Math.PI / 2;
    this.root.add(this.visual);
    this.visual.add(this.tilt);

    const appearance = appearanceFor(
      `${player.team}:${player.id}:${player.number}`,
    );
    const materials = new Map(palette.materials);
    for (const [name, color] of [
      ["skin", appearance.skin],
      ["kit_boots", appearance.boots],
    ] as const) {
      const source = template.materials.get(name);
      if (source instanceof THREE.MeshStandardMaterial) {
        const tinted = source.clone();
        tinted.color.set(color);
        this.ownedMaterials.push(tinted);
        materials.set(name, tinted);
      }
    }

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
            (entry) => materials.get(entry.name) ?? entry,
          )
        : materials.get(mesh.material.name) ?? mesh.material;
      mesh.visible = !HIDDEN_DETAIL_MESH.test(mesh.name);
      if (mesh.visible) {
        const original = mesh.material;
        const cheap = Array.isArray(original)
          ? original.map((entry) => cheapMaterialFor(entry))
          : cheapMaterialFor(original);
        const changed = Array.isArray(original)
          ? (cheap as THREE.Material[]).some(
              (entry, index) => entry !== original[index],
            )
          : cheap !== original;
        this.geometrySlots.push({
          mesh,
          highGeometry: mesh.geometry,
          highVisible: mesh.visible,
          lowGeometry: null,
          baseMaterial: original,
          cheapMaterial: changed ? cheap : null,
        });
        if (changed) {
          const cheapMaterials = Array.isArray(cheap) ? cheap : [cheap];
          for (const cheapMaterial of cheapMaterials) {
            if (!this.ownedMaterials.includes(cheapMaterial)) {
              this.ownedMaterials.push(cheapMaterial);
            }
          }
        }
      }
      // The blob shadow is the authored player's shadow. Casting the full
      // skinned mesh into the 2K shadow map costs more than the main pass.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (mesh.visible) {
        this.shadowMeshes.push(mesh);
      }
      if (mesh instanceof THREE.SkinnedMesh) {
        mesh.frustumCulled = false;
      }
    });
    if (lowTemplate !== null) {
      this.attachLowTemplate(lowTemplate);
    }
    model.traverse((object) => {
      if (object instanceof THREE.Bone) {
        const bone = object as THREE.Bone<THREE.Object3DEventMap>;
        this.bones.set(bone.name, bone);
        this.boneRest.set(bone.name, bone.quaternion.clone());
      }
    });
    for (const name of ["foot_l", "foot_r"]) {
      const foot = this.bones.get(name);
      if (foot !== undefined) {
        this.footBones.push(foot);
      }
    }
    if (this.footBones.length > 0) {
      this.root.updateMatrixWorld(true);
      const rootY = this.root.getWorldPosition(this.rootWorld).y;
      this.restAnkleY = Math.min(
        ...this.footBones.map((foot) => {
          foot.updateWorldMatrix(true, false);
          return foot.getWorldPosition(this.footWorld).y - rootY;
        }),
      );
    }
    for (const side of ["l", "r"] as const) {
      const thigh = this.bones.get(`thigh_${side}`);
      const calf = this.bones.get(`calf_${side}`);
      const foot = this.bones.get(`foot_${side}`);
      if (thigh === undefined || calf === undefined || foot === undefined) {
        continue;
      }
      thigh.getWorldPosition(this.ikHip);
      calf.getWorldPosition(this.ikKnee);
      foot.getWorldPosition(this.ikAnkle);
      this.legs.push({
        thigh,
        calf,
        foot,
        upperLengthM: this.ikHip.distanceTo(this.ikKnee),
        lowerLengthM: this.ikKnee.distanceTo(this.ikAnkle),
        lock: createFootLockState(),
        target: new THREE.Vector3(),
        hasTarget: false,
        weight: 0,
      });
    }

    this.useClips =
      template.clips.size > 0 &&
      AUTHORED_CLIP_PLAN.every((spec) => template.clips.has(spec.state));
    if (this.useClips) {
      this.mixer = new THREE.AnimationMixer(model);
      for (const spec of AUTHORED_CLIP_PLAN) {
        const clip = template.clips.get(spec.state);
        if (clip === undefined) {
          continue;
        }
        const action = this.mixer.clipAction(clip);
        action.setLoop(
          spec.loop ? THREE.LoopRepeat : THREE.LoopOnce,
          spec.loop ? Number.POSITIVE_INFINITY : 1,
        );
        action.clampWhenFinished = !spec.loop;
        this.clipActions.set(spec.state, action);
      }
      this.clipPhaseOffset = (player.number * 0.173) % 1;
    } else {
      this.mixer = null;
      this.clipPhaseOffset = 0;
    }

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 20),
      this.shadowMaterial,
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

    this.numberSprite = createNumberSprite(player.number);
    this.numberSprite.position.y = 2.22;
    this.overlays.add(this.numberSprite);

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
    this.switchRing.visible =
      player.switchTarget &&
      !player.controlled &&
      this.detail !== "minimal";
    this.switchRing.scale.setScalar(1 + Math.sin(tick * 0.1 + 1.3) * 0.05);
    this.marker.visible = player.controlled && this.detail !== "minimal";
    this.marker.position.y = 2.75 + Math.sin(tick * 0.12) * 0.09;
    this.numberSprite.visible = this.detail !== "minimal";
    this.card.visible = player.yellowCards > 0 && this.detail === "full";

    const previousElapsed = this.lastElapsed;
    const rewound = previousElapsed !== null && elapsed < previousElapsed;
    const stateChanged = player.state !== this.lastState;
    const rootJumped =
      this.hasLastRootPosition &&
      this.root.position.distanceTo(this.lastRootPosition) >
        VISUAL_TUNING.authoredPlayer.footIk.teleportResetM;
    const animationDue = shouldAnimateAtTick(
      tick,
      this.animationStride,
      this.animationPhase,
    );
    // The root still follows every snapshot frame above. Only the expensive
    // skeleton, IK and audio clock can skip; state changes and teleports force
    // an immediate update so a one-shot never starts several frames late.
    if (
      !this.forceAnimation &&
      !rewound &&
      !stateChanged &&
      !rootJumped &&
      !animationDue
    ) {
      return;
    }
    this.forceAnimation = false;
    if (rewound) {
      this.lastState = null;
      this.lastElapsed = null;
    }
    if (stateChanged) {
      this.lastState = player.state;
      this.stateStartedElapsed = elapsed;
    }
    if (
      rewound ||
      rootJumped ||
      player.state !== this.lastFootIkState
    ) {
      this.resetFootLocks();
    }
    if (rewound || rootJumped || player.state !== this.lastFootIkState) {
      this.lastFootstepElapsed = Number.NEGATIVE_INFINITY;
      resetFootstepClock(this.footstepClock);
    }
    this.lastFootIkState = player.state;
    this.lastRootPosition.copy(this.root.position);
    this.hasLastRootPosition = true;
    this.lastElapsed = elapsed;
    const stateAge = Math.max(0, elapsed - this.stateStartedElapsed);
    const deltaSeconds =
      previousElapsed === null || rewound
        ? 0
        : Math.max(0, elapsed - previousElapsed);

    const movedDistance = this.hasLastGaitPosition
      ? this.root.position.distanceTo(this.lastGaitPosition)
      : 0;
    if (
      !this.hasLastGaitPosition ||
      rewound ||
      rootJumped
    ) {
      this.gaitSpeedMps = 0;
    } else if (deltaSeconds > 0) {
      this.gaitSpeedMps = updateGaitSpeed(
        this.gaitSpeedMps,
        movedDistance,
        deltaSeconds,
        VISUAL_TUNING.authoredPlayer.gait,
      );
    }
    this.lastGaitPosition.copy(this.root.position);
    this.hasLastGaitPosition = true;
    const gaitScale = gaitPlaybackScale(
      player.state,
      this.gaitSpeedMps,
      VISUAL_TUNING.authoredPlayer.gait,
      this.strideScale,
    );

    const cadence = cadenceFor(player.state) * gaitScale;
    if (previousElapsed === null || rewound) {
      this.stridePhase = elapsed * cadence + player.number * 0.63;
    } else {
      this.stridePhase += deltaSeconds * cadence;
    }
    this.updateFootsteps(player.state, elapsed);

    const target = computeCharacterPose(
      player.state,
      this.stridePhase,
      player.stamina,
      stateAge,
    );
    const clipped = this.updateClipPose(
      player.state,
      stateAge,
      deltaSeconds,
      rewound,
      player.stamina,
      gaitScale,
    );
    if (!clipped) {
      const blend =
        deltaSeconds === 0
          ? 1
          : 1 - Math.exp(
              -deltaSeconds * VISUAL_TUNING.authoredPlayer.poseBlendRate,
            );
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
    }

    const groundLift = groundedLiftFor(player.state);
    const baseLift = groundLift ?? target.rootLift;
    this.tilt.position.y = baseLift + this.groundOffset;
    this.tilt.rotation.x =
      deltaSeconds === 0
        ? target.bodyTilt
        : dampValue(this.tilt.rotation.x, target.bodyTilt, deltaSeconds);
    this.tilt.rotation.z =
      deltaSeconds === 0
        ? target.bodyLean
        : dampValue(this.tilt.rotation.z, target.bodyLean, deltaSeconds);

    if (
      groundLift !== null &&
      this.footBones.length > 0 &&
      Number.isFinite(this.restAnkleY)
    ) {
      this.root.updateWorldMatrix(true, false);
      const rootY = this.root.getWorldPosition(this.rootWorld).y;
      let lowestAnkleY = Number.POSITIVE_INFINITY;
      for (const foot of this.footBones) {
        foot.updateWorldMatrix(true, false);
        lowestAnkleY = Math.min(
          lowestAnkleY,
          foot.getWorldPosition(this.footWorld).y - rootY,
        );
      }
      const goalOffset = footPlantOffset({
        currentAnkleY: lowestAnkleY,
        restAnkleY: this.restAnkleY,
        desiredLiftM: baseLift,
        currentOffsetM: this.groundOffset,
        maxCorrectionM: VISUAL_TUNING.authoredPlayer.footPlant.maxCorrectionM,
      });
      this.groundOffset =
        deltaSeconds === 0
          ? goalOffset
          : dampWithRate(
              this.groundOffset,
              goalOffset,
              VISUAL_TUNING.authoredPlayer.footPlant.rate,
              deltaSeconds,
            );
    } else {
      this.groundOffset =
        deltaSeconds === 0
          ? 0
          : dampWithRate(
              this.groundOffset,
              0,
              VISUAL_TUNING.authoredPlayer.footPlant.rate,
              deltaSeconds,
            );
    }
    this.tilt.position.y = baseLift + this.groundOffset;
    if (groundLift !== null) {
      this.root.updateMatrixWorld(true);
      this.updateFootIk(player.state, groundLift, deltaSeconds);
    } else {
      this.resetFootLocks();
    }

    this.shadow.scale.setScalar(
      1 - Math.min(0.18, player.state === "slide" ? 0.18 : 0),
    );
  }

  /**
   * Late binding keeps already-created rigs useful if the low template
   * finishes loading after the first match frame. Geometry objects are shared
   * from the template and are never disposed by an individual rig.
   */
  attachLowTemplate(template: {
    readonly scene: THREE.Object3D;
  } | null): void {
    if (this.lowAttached || template === null) {
      return;
    }
    const lowGeometries = new Map<string, THREE.BufferGeometry>();
    template.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const mesh = object as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.Material | THREE.Material[]
        >;
        lowGeometries.set(object.name, mesh.geometry);
      }
    });
    for (const slot of this.geometrySlots) {
      slot.lowGeometry = lowGeometries.get(slot.mesh.name) ?? null;
    }
    this.lowAttached = true;
    if (
      this.geometryLevel === "low" &&
      this.visualGeometry !== "low" &&
      !this.startGeometryFade("low")
    ) {
      this.geometryLevel = this.visualGeometry;
    }
  }

  setGeometryDetail(detail: PlayerGeometry): void {
    if (detail === this.geometryLevel) {
      return;
    }
    if (this.geometryFade !== null) {
      this.finishGeometryFade();
    }
    this.geometryLevel = detail;
    if (detail === "low" && !this.lowAttached) {
      return;
    }
    if (detail !== this.visualGeometry) {
      if (!this.startGeometryFade(detail)) {
        // The global budget can defer a dissolve. Keep the committed target
        // distinct so the next LOD pass retries instead of leaving a mismatch.
        this.geometryLevel = this.visualGeometry;
      }
    }
  }

  /**
   * Dissolve both geometry levels together. Both surfaces use a shared
   * screen-space dither pattern with complementary cutoffs, so each pixel is
   * drawn by exactly one level. Unlike an alpha blend this keeps opaque
   * materials opaque and depth-writing, avoiding transparent sorting and
   * ghosting. No mixer, pose, gait phase or foot lock is touched.
   */
  private startGeometryFade(to: PlayerGeometry): boolean {
    if (to === this.visualGeometry) {
      return false;
    }
    if (to === "low" && !this.lowAttached) {
      return false;
    }
    if (
      !geometryFadeBudgetAvailable(
        AuthoredPlayerRig.activeGeometryFades,
        VISUAL_TUNING.authoredPlayer.geometryFadeMaxActive,
      )
    ) {
      return false;
    }
    const from = this.visualGeometry;
    const duration = VISUAL_TUNING.authoredPlayer.geometryFadeSeconds;
    const entries: GeometryFadeEntry[] = [];
    for (const slot of this.geometrySlots) {
      const sourceVisible =
        from === "high" ? slot.highVisible : slot.lowGeometry !== null;
      slot.mesh.geometry =
        from === "high"
          ? slot.highGeometry
          : (slot.lowGeometry ?? slot.highGeometry);
      slot.mesh.visible = sourceVisible;
      const currentMaterial = slot.mesh.material;
      const currentWasArray = Array.isArray(currentMaterial);
      const source = sourceVisible
        ? this.dissolveMaterialsFor(currentMaterial, false)
        : [];
      if (sourceVisible) {
        slot.mesh.material = currentWasArray
          ? source.map((entry) => entry.material)
          : source[0]!.material;
      }
      for (const entry of source) {
        entry.progress.value = 0;
      }

      const targetGeometry =
        to === "low" ? slot.lowGeometry : slot.highGeometry;
      const targetVisible =
        targetGeometry !== null &&
        (to === "high" ? slot.highVisible : true);
      let targetMesh: THREE.SkinnedMesh | null = null;
      let target: DissolveMaterial[] = [];
      if (targetVisible && targetGeometry !== null) {
        const targetBase = this.baseMaterialFor(slot);
        target = this.dissolveMaterialsFor(targetBase, true);
        for (const entry of target) {
          entry.progress.value = 0;
        }
        const targetMaterial: MaterialLike = Array.isArray(targetBase)
          ? target.map((entry) => entry.material)
          : target[0]!.material;
        targetMesh = this.fadeTargetFor(
          slot,
          targetGeometry,
          targetMaterial,
        );
      }
      entries.push({
        slot,
        source,
        targetMesh,
        target,
      });
    }
    this.geometryFade = {
      from,
      to,
      elapsed: 0,
      duration,
      entries,
    };
    AuthoredPlayerRig.activeGeometryFades += 1;
    return true;
  }

  advanceVisualTransition(deltaSeconds: number): void {
    const fade = this.geometryFade;
    if (fade === null || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    fade.elapsed = Math.min(fade.duration, fade.elapsed + deltaSeconds);
    const progress = geometryFadeProgress(fade.elapsed, fade.duration);
    for (const entry of fade.entries) {
      for (const source of entry.source) {
        source.progress.value = progress;
      }
      for (const target of entry.target) {
        target.progress.value = progress;
      }
    }
    if (fade.elapsed >= fade.duration) {
      this.finishGeometryFade();
    }
  }

  private finishGeometryFade(): void {
    const fade = this.geometryFade;
    if (fade === null) {
      return;
    }
    for (const entry of fade.entries) {
      const { slot, targetMesh } = entry;
      const useLow = fade.to === "low";
      slot.mesh.geometry = useLow
        ? (slot.lowGeometry ?? slot.highGeometry)
        : slot.highGeometry;
      slot.mesh.visible = useLow
        ? slot.lowGeometry !== null
        : slot.highVisible;
      slot.mesh.material = this.baseMaterialFor(slot);
      targetMesh?.parent?.remove(targetMesh);
      if (targetMesh !== null) {
        targetMesh.visible = false;
      }
    }
    AuthoredPlayerRig.activeGeometryFades = Math.max(
      0,
      AuthoredPlayerRig.activeGeometryFades - 1,
    );
    this.visualGeometry = fade.to;
    this.geometryLevel = fade.to;
    this.geometryFade = null;
  }

  private dissolveMaterialsFor(
    source: MaterialLike,
    incoming: boolean,
  ): DissolveMaterial[] {
    const pool = incoming
      ? this.incomingFadeMaterials
      : this.outgoingFadeMaterials;
    const sourceMaterials = Array.isArray(source) ? source : [source];
    return sourceMaterials.map((material) => {
      const cached = pool.get(material);
      if (cached !== undefined) {
        return cached;
      }
      const created = createDissolveMaterial(material, incoming);
      pool.set(material, created);
      return created;
    });
  }

  private fadeTargetFor(
    slot: GeometrySlot,
    geometry: THREE.BufferGeometry,
    material: MaterialLike,
  ): THREE.SkinnedMesh {
    let target = this.fadeTargets.get(slot);
    if (target === undefined) {
      target = new THREE.SkinnedMesh(geometry, material);
      target.name = `${slot.mesh.name}:fade`;
      target.castShadow = false;
      target.receiveShadow = false;
      this.fadeTargets.set(slot, target);
    } else {
      target.geometry = geometry;
      target.material = material;
    }
    target.position.copy(slot.mesh.position);
    target.quaternion.copy(slot.mesh.quaternion);
    target.scale.copy(slot.mesh.scale);
    target.matrixAutoUpdate = slot.mesh.matrixAutoUpdate;
    if (!target.matrixAutoUpdate) {
      target.matrix.copy(slot.mesh.matrix);
    }
    target.frustumCulled = slot.mesh.frustumCulled;
    target.renderOrder = slot.mesh.renderOrder + 1;
    target.visible = true;
    if (slot.mesh instanceof THREE.SkinnedMesh) {
      target.bind(slot.mesh.skeleton, slot.mesh.bindMatrix);
      target.bindMode = slot.mesh.bindMode;
    }
    slot.mesh.parent?.add(target);
    return target;
  }

  private disposeFadeResources(): void {
    for (const pool of [
      this.outgoingFadeMaterials,
      this.incomingFadeMaterials,
    ]) {
      for (const entry of pool.values()) {
        entry.material.dispose();
      }
      pool.clear();
    }
    this.fadeTargets.clear();
  }

  private baseMaterialFor(slot: GeometrySlot): MaterialLike {
    return this.materialLod && slot.cheapMaterial !== null
      ? slot.cheapMaterial
      : slot.baseMaterial;
  }

  setFootstepSink(sink: FootstepSink | null): void {
    this.footstepSink = sink;
  }

  setDetail(detail: PlayerDetail): void {
    if (detail === this.detail) {
      return;
    }
    this.detail = detail;
    this.numberSprite.visible = detail !== "minimal";
    if (detail === "minimal") {
      this.marker.visible = false;
      this.switchRing.visible = false;
      this.card.visible = false;
    }
  }

  setShadowCasting(enabled: boolean): void {
    if (enabled === this.shadowCasting) {
      return;
    }
    this.shadowCasting = enabled;
    for (const mesh of this.shadowMeshes) {
      mesh.castShadow = enabled;
    }
    this.shadowMaterial.opacity = enabled ? 0.14 : 0.28;
  }

  setAnimationStride(stride: number): void {
    const next = Number.isFinite(stride)
      ? Math.max(1, Math.floor(stride))
      : 1;
    if (next === this.animationStride) {
      return;
    }
    this.animationStride = next;
    this.forceAnimation = true;
  }

  setMaterialLod(active: boolean): void {
    if (active === this.materialLod) {
      return;
    }
    this.materialLod = active;
    if (this.geometryFade !== null) {
      this.finishGeometryFade();
    }
    for (const slot of this.geometrySlots) {
      slot.mesh.material = this.baseMaterialFor(slot);
    }
  }

  private updateFootsteps(
    state: RenderPlayer["state"],
    elapsedSeconds: number,
  ): void {
    const tuning = VISUAL_TUNING.authoredPlayer;
    const event = updateFootstepClock(
      this.footstepClock,
      state,
      this.stridePhase,
      this.gaitSpeedMps,
      elapsedSeconds,
      this.lastFootstepElapsed,
      tuning.footsteps,
      tuning.gait,
    );
    if (event === null) {
      return;
    }
    this.lastFootstepElapsed = elapsedSeconds;
    const leg = this.legs.find(
      (entry) =>
        (entry.foot.name.endsWith("_l") ? "left" : "right") === event.side,
    );
    if (leg === undefined) {
      this.footstepSink?.({
        ...event,
        x: this.root.position.x,
        z: this.root.position.z,
      });
      return;
    }
    leg.foot.getWorldPosition(this.footWorld);
    this.footstepSink?.({
      ...event,
      x: this.footWorld.x,
      z: this.footWorld.z,
    });
  }

  private resetFootLocks(): void {
    for (const leg of this.legs) {
      resetFootLock(leg.lock);
      leg.hasTarget = false;
      leg.weight = 0;
    }
  }

  /**
   * The clip provides the gait; this pass only corrects feet that are already
   * close to the pitch. Correcting a swing foot would cancel the step, so the
   * lock acquires contact at the bottom of the stride and releases on lift.
   */
  private updateFootIk(
    state: RenderPlayer["state"],
    groundLift: number,
    deltaSeconds: number,
  ): void {
    if (
      this.legs.length === 0 ||
      !Number.isFinite(this.restAnkleY)
    ) {
      return;
    }
    const tuning = VISUAL_TUNING.authoredPlayer.footIk;
    const rootY = this.root.getWorldPosition(this.rootWorld).y;
    const targetY = rootY + this.restAnkleY + groundLift;
    this.root.getWorldQuaternion(this.ikRootQuaternion);
    this.ikPole
      .set(0, 0, 1)
      .applyQuaternion(this.ikRootQuaternion)
      .normalize();

    const contacts: Array<{
      readonly leg: LegRig;
      readonly height: number;
      hasContact: boolean;
    }> = [];
    for (const leg of this.legs) {
      leg.thigh.getWorldPosition(this.ikHip);
      leg.foot.getWorldPosition(this.ikAnkle);
      const height = this.ikAnkle.y - targetY;
      const contact = updateFootLock(
        leg.lock,
        {
          ankle: this.ikAnkle,
          hip: this.ikHip,
          targetY,
          maxReachM:
            leg.upperLengthM + leg.lowerLengthM - tuning.reachMarginM,
          grounded: true,
        },
        tuning,
        leg.target,
      );
      contacts.push({
        leg,
        height,
        hasContact: contact !== null && !contact.justReleased,
      });
    }

    // A sprint can briefly put both ankles below the contact threshold. Only
    // the lower foot gets the stance solve; two simultaneous world anchors
    // would fight the moving hips and force a split stance.
    if (state !== "idle") {
      const locked = contacts.filter((entry) => entry.hasContact);
      if (locked.length > 1) {
        const keep = locked.reduce((lowest, entry) =>
          entry.height < lowest.height ? entry : lowest,
        );
        for (const entry of locked) {
          if (entry === keep) {
            continue;
          }
          resetFootLock(entry.leg.lock);
          entry.hasContact = false;
        }
      }
    }

    for (const entry of contacts) {
      if (entry.hasContact) {
        entry.leg.hasTarget = true;
      }
      const goalWeight = entry.hasContact ? 1 : 0;
      entry.leg.weight =
        deltaSeconds === 0
          ? goalWeight
          : THREE.MathUtils.damp(
              entry.leg.weight,
              goalWeight,
              tuning.blendRate,
              deltaSeconds,
            );
      if (
        !entry.leg.hasTarget ||
        entry.leg.weight <= 1e-4
      ) {
        continue;
      }
      // A released foot keeps blending toward its last anchor while the
      // weight decays, so the clip takes over instead of snapping.
      this.applyLegIk(
        entry.leg,
        entry.leg.target,
        this.ikPole,
        entry.leg.weight,
        tuning,
      );
    }
  }

  private applyLegIk(
    leg: LegRig,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    weight: number,
    tuning: typeof VISUAL_TUNING.authoredPlayer.footIk,
  ): void {
    leg.thigh.getWorldPosition(this.ikHip);
    leg.calf.getWorldPosition(this.ikKnee);
    leg.foot.getWorldPosition(this.ikAnkle);
    solveTwoBoneIk(
      {
        hip: this.ikHip,
        target,
        pole,
        upperLengthM: leg.upperLengthM,
        lowerLengthM: leg.lowerLengthM,
        reachMarginM: tuning.reachMarginM,
      },
      this.ikSolvedKnee,
      this.ikSolvedAnkle,
    );
    this.rotateBoneToward(
      leg.thigh,
      this.ikHip,
      this.ikKnee,
      this.ikSolvedKnee,
      weight,
    );
    leg.thigh.updateMatrixWorld(true);

    // The thigh moved the knee and ankle, so re-read them before solving the
    // lower bone instead of changing the chain's lengths.
    leg.calf.getWorldPosition(this.ikKnee);
    leg.foot.getWorldPosition(this.ikAnkle);
    this.rotateBoneToward(
      leg.calf,
      this.ikKnee,
      this.ikAnkle,
      this.ikSolvedAnkle,
      weight,
    );
    leg.calf.updateMatrixWorld(true);
  }

  private rotateBoneToward(
    bone: THREE.Bone,
    origin: THREE.Vector3,
    currentEnd: THREE.Vector3,
    desiredEnd: THREE.Vector3,
    weight: number,
  ): void {
    const currentLength = currentEnd.distanceTo(origin);
    const desiredLength = desiredEnd.distanceTo(origin);
    if (currentLength < 1e-6 || desiredLength < 1e-6) {
      return;
    }
    this.ikCurrentDirection
      .subVectors(currentEnd, origin)
      .multiplyScalar(1 / currentLength);
    this.ikDesiredDirection
      .subVectors(desiredEnd, origin)
      .multiplyScalar(1 / desiredLength);
    this.ikDeltaQuaternion.setFromUnitVectors(
      this.ikCurrentDirection,
      this.ikDesiredDirection,
    );
    bone.getWorldQuaternion(this.ikWorldQuaternion);
    this.ikWorldQuaternion.premultiply(this.ikDeltaQuaternion);
    if (bone.parent === null) {
      this.ikParentQuaternion.identity();
    } else {
      bone.parent.getWorldQuaternion(this.ikParentQuaternion);
      this.ikParentQuaternion.invert();
    }
    this.ikParentQuaternion.multiply(this.ikWorldQuaternion);
    bone.quaternion.slerp(this.ikParentQuaternion, weight);
  }

  private updateClipPose(
    state: RenderPlayer["state"],
    stateAgeSeconds: number,
    deltaSeconds: number,
    rewound: boolean,
    stamina: number,
    gaitScale: number,
  ): boolean {
    const mixer = this.mixer;
    const spec = clipSpecFor(state);
    const action = this.clipActions.get(state);
    if (mixer === null || spec === undefined || action === undefined) {
      return false;
    }
    if (rewound) {
      mixer.stopAllAction();
      this.activeClipState = null;
      this.activeClipAction = null;
    }
    if (state !== this.activeClipState) {
      const previous = this.activeClipAction;
      action.reset();
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      action.play();
      if (previous !== null && previous !== action && deltaSeconds > 0) {
        action.crossFadeFrom(
          previous,
          VISUAL_TUNING.authoredPlayer.clipFadeSeconds,
          false,
        );
      } else if (previous !== null && previous !== action) {
        previous.stop();
      }
      this.activeClipState = state;
      this.activeClipAction = action;
      const duration = Math.max(0.001, action.getClip().duration);
      action.time = spec.loop
        ? (stateAgeSeconds + this.clipPhaseOffset) % duration
        : Math.min(stateAgeSeconds, duration);
    }
    const staminaScale =
      VISUAL_TUNING.authoredPlayer.clipStaminaTimeScaleMin +
      (1 - VISUAL_TUNING.authoredPlayer.clipStaminaTimeScaleMin) *
        Math.max(0, Math.min(1, stamina));
    action.setEffectiveTimeScale(staminaScale * gaitScale);
    mixer.update(Math.max(0, deltaSeconds));
    return true;
  }

  dispose(): void {
    if (this.geometryFade !== null) {
      for (const entry of this.geometryFade.entries) {
        entry.targetMesh?.parent?.remove(entry.targetMesh);
        if (entry.targetMesh !== null) {
          entry.targetMesh.visible = false;
        }
      }
      this.geometryFade = null;
      AuthoredPlayerRig.activeGeometryFades = Math.max(
        0,
        AuthoredPlayerRig.activeGeometryFades - 1,
      );
    }
    this.disposeFadeResources();
    this.mixer?.stopAllAction();
    this.clipActions.clear();
    this.activeClipAction = null;
    disposeObject(this.overlays);
    for (const material of this.ownedMaterials) {
      material.dispose();
    }
  }
}

function dampValue(current: number, goal: number, deltaSeconds: number): number {
  return dampWithRate(
    current,
    goal,
    VISUAL_TUNING.authoredPlayer.poseBlendRate,
    deltaSeconds,
  );
}

function dampWithRate(
  current: number,
  goal: number,
  rate: number,
  deltaSeconds: number,
): number {
  return THREE.MathUtils.damp(current, goal, rate, deltaSeconds);
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
