// packages/client/src/render/three-renderer.ts

import * as THREE from "three";
import { TUNING } from "@fb/shared";
import type { Pitch } from "@fb/sim";
import type { MatchRenderer, ScreenIndicator } from "./renderer";
import { CameraDebugOverlay } from "../camera/CameraDebugOverlay";
import { CameraDirector } from "../camera/CameraDirector";
import { cameraGroundBasis } from "../camera/cameraMath";
import { CAMERA_TUNING } from "../camera/cameraTuning";
import { ContextCameraController } from "../camera/context/ContextCameraController";
import {
  createCameraShot,
  type CameraMode,
} from "../camera/modes";
import type {
  CameraInputBasis,
  CameraPose,
  CameraRenderState,
  CameraShot,
} from "../camera/types";
import { predictLandingPoint } from "./ball-effects";
import { disposeObject } from "./three-dispose";
import { pitchToWorld } from "./three-layout";
import { createPitchVisual, type GoalNetVisual } from "./three-pitch";
import type { StadiumVisual } from "./three-stadium";
import {
  animationStrideFor,
  isNdcPointOnScreen,
  playerDetailForScreenHeight,
  projectedHeightPx,
  shadowCasterIds,
  type PlayerLodEntry,
} from "./player-lod";
import {
  geometryForDetail,
  nextGeometryRequest,
  type PlayerGeometryRequest,
} from "./player-geometry";
import {
  INITIAL_FRAME_BUDGET_STATE,
  updateFrameBudget,
  type FrameBudgetState,
} from "./frame-budget";
import { projectScreenIndicator } from "./screen-indicators";
import { PlayerRig, type MatchPlayerRig } from "./three-player";
import { AuthoredPlayerLibrary } from "./three-authored-player";
import { configureGeometryFadeBudget } from "./geometry-dissolve-pool";
import { TemporalAa, type TemporalMotionSource } from "./temporal-aa";
import { spatializeFootstep, type FootstepSink } from "./footsteps";
import {
  VISUAL_QUALITY,
  VISUAL_TUNING,
  type VisualQuality,
} from "./visualTuning";
import type { MatchView } from "./view";

const BALL_RADIUS_M = 0.16;
const BALL_LANDING_WORLD_HEIGHT_M = 0.025;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Three.js presentation layer. It consumes the same immutable MatchView as the
 * 2D renderer, so simulation and network code remain unaware of the camera,
 * meshes or animation.
 */
export class ThreeMatchRenderer implements MatchRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private readonly onWindowResize = (): void => {
    this.resize();
  };
  private readonly players = new Map<string, MatchPlayerRig>();
  private readonly seenPlayers = new Set<string>();
  private readonly authoredPlayers = new AuthoredPlayerLibrary();
  private usingAuthoredPlayers = false;
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private readonly ballShadowMaterial: THREE.MeshBasicMaterial;
  private readonly backdrop: THREE.CanvasTexture;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly ballTrail: THREE.Line;
  private readonly trailPositions: Float32Array;
  private readonly trailGeometry: THREE.BufferGeometry;
  private trailCount = 0;
  private readonly landingMarker: THREE.Mesh;
  private readonly landingMaterial: THREE.MeshBasicMaterial;
  private readonly pitchGroup = new THREE.Group();
  private stadium: StadiumVisual | null = null;
  private goalNets: readonly GoalNetVisual[] = [];
  private lastScoreHome: number | null = null;
  private lastScoreAway: number | null = null;
  private visualQuality: VisualQuality = "high";
  private lastView: MatchView | null = null;
  private pitch: Pitch | null = null;
  private pitchKey = "";
  private width = 1;
  private height = 1;
  private lastRenderAtMs: number | null = null;
  private lastMatchId: string | null = null;
  private lastFovDegrees = CAMERA_TUNING.broadcast.fovDegrees;
  private lastNearClipM = CAMERA_TUNING.camera.nearClipM;
  private lastFarClipM = CAMERA_TUNING.camera.farClipM;
  private readonly cameraDirector = new CameraDirector();
  private cameraMode: CameraMode = "broadcast";
  private baseShot: CameraShot = createCameraShot(this.cameraMode);
  private lastCameraState: CameraRenderState | null = null;
  private lastCameraPose: CameraPose | null = null;
  private replayActive = false;
  private readonly footstepListener = new THREE.Vector3();
  private readonly footstepForward = new THREE.Vector3();
  private readonly footstepRight = new THREE.Vector3();
  private readonly lodCameraPosition = new THREE.Vector3();
  private readonly lodPlayerPosition = new THREE.Vector3();
  private readonly lodForward = new THREE.Vector3();
  private readonly lodToPlayer = new THREE.Vector3();
  private readonly lodProjected = new THREE.Vector3();
  private readonly lodBufferSize = new THREE.Vector2();
  private readonly lodEntries: PlayerLodEntry[] = [];
  private readonly geometryRequests = new Map<
    string,
    PlayerGeometryRequest
  >();
  private frameBudget: FrameBudgetState = INITIAL_FRAME_BUDGET_STATE;
  private temporalAa: TemporalAa | null;
  private readonly motionSources: TemporalMotionSource[] = [];
  private readonly contextController: ContextCameraController;
  private readonly cameraDebug: CameraDebugOverlay;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        VISUAL_QUALITY[this.visualQuality].maxPixelRatio,
      ),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.temporalAa = temporalAaEnabled()
      ? new TemporalAa(this.renderer)
      : null;

    this.backdrop = createBackdropTexture();
    this.scene.background = this.backdrop;
    this.scene.fog = new THREE.Fog(0x06110b, 135, 260);
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_TUNING.broadcast.fovDegrees,
      1,
      CAMERA_TUNING.camera.nearClipM,
      CAMERA_TUNING.camera.farClipM,
    );

    const hemisphere = new THREE.HemisphereLight(0xc9f7dd, 0x06130d, 1.7);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(35, 72, 26);
    key.castShadow = true;
    const shadowSize = VISUAL_QUALITY[this.visualQuality].shadowMapSize;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -68;
    key.shadow.camera.right = 68;
    key.shadow.camera.top = 56;
    key.shadow.camera.bottom = -56;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 180;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.025;
    this.keyLight = key;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9ed7ff, 0.55);
    fill.position.set(-42, 34, -38);
    this.scene.add(fill);

    this.scene.add(this.pitchGroup);

    const ballAssets = createBallAssets();
    this.ball = ballAssets.mesh;
    this.ballShadowMaterial = ballAssets.shadowMaterial;
    this.ballShadow = ballAssets.shadow;
    this.ball.scale.setScalar(VISUAL_TUNING.ballScale);
    this.scene.add(this.ballShadow);
    this.scene.add(this.ball);

    this.trailPositions = new Float32Array(
      VISUAL_TUNING.trail.maxPoints * 3,
    );
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3),
    );
    this.trailGeometry.setDrawRange(0, 0);
    this.ballTrail = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({
        color: 0xbef8ff,
        transparent: true,
        opacity: VISUAL_TUNING.trail.opacity,
        depthWrite: false,
      }),
    );
    this.ballTrail.name = "ball-trail";
    this.ballTrail.frustumCulled = false;
    this.scene.add(this.ballTrail);

    this.landingMaterial = new THREE.MeshBasicMaterial({
      color: 0x8af6ff,
      transparent: true,
      opacity: VISUAL_TUNING.landing.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.landingMarker = new THREE.Mesh(
      new THREE.RingGeometry(
        VISUAL_TUNING.landing.radiusM,
        VISUAL_TUNING.landing.radiusM * 1.12,
        32,
      ),
      this.landingMaterial,
    );
    this.landingMarker.name = "ball-landing-marker";
    this.landingMarker.rotation.x = -Math.PI / 2;
    this.landingMarker.position.y = BALL_LANDING_WORLD_HEIGHT_M;
    this.landingMarker.visible = false;
    this.scene.add(this.landingMarker);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    const parent = canvas.parentElement;
    if (parent !== null) {
      this.resizeObserver.observe(parent);
    }
    window.addEventListener("resize", this.onWindowResize);
    this.resize();
    this.contextController = new ContextCameraController(this.cameraDirector);
    this.cameraDebug = new CameraDebugOverlay();
    this.applyQuality();
    void this.authoredPlayers.load();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect?.width ?? 1));
    this.height = Math.max(1, Math.floor(rect?.height ?? 1));
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        VISUAL_QUALITY[this.visualQuality].maxPixelRatio,
      ),
    );
    this.renderer.setSize(this.width, this.height, false);
    this.temporalAa?.resize();
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(view: MatchView): void {
    if (this.width <= 1 || this.height <= 1) {
      this.resize();
    }
    if (this.pitch === null || this.pitchKey !== pitchKey(view.pitch)) {
      this.installPitch(view.pitch);
    }
    if (view.matchId !== this.lastMatchId) {
      this.lastMatchId = view.matchId;
      this.cameraDirector.reset();
      this.contextController.reset();
      this.lastCameraPose = null;
      this.lastRenderAtMs = null;
      this.lastScoreHome = null;
      this.lastScoreAway = null;
      for (const net of this.goalNets) {
        net.reset();
      }
      this.stadium?.reset();
    }

    this.syncPlayers(view);
    this.updateBall(view);
    this.updateBallEffects(view);
    this.lastView = view;

    const now = performance.now();
    const dt =
      this.lastRenderAtMs === null
        ? 0
        : Math.max(0, (now - this.lastRenderAtMs) / 1_000);
    this.lastRenderAtMs = now;
    this.updateGoalMoment(view, dt);
    const state: CameraRenderState = {
      view,
      aspect: this.width / Math.max(1, this.height),
      selfSide: view.selfSide,
      half: view.half,
      pitch: view.pitch,
    };
    this.lastCameraState = state;
    if (this.cameraDirector.depth === 0) {
      this.cameraDirector.setBase(this.baseShot, state);
      // Establish the base pose before a context shot can blend away from it.
      this.cameraDirector.update(0, state);
    }
    if (!this.replayActive) {
      this.contextController.update(dt, state);
    }
    const frame = this.cameraDirector.update(dt, state);
    if (frame !== null) {
      this.lastCameraPose = frame.pose;
      this.applyCameraPose(frame.pose);
      this.cameraDebug.update(frame);
    }

    configureGeometryFadeBudget(
      this.frameBudget.pressured
        ? VISUAL_TUNING.authoredPlayer.geometryFadeMaxActiveUnderPressure
        : VISUAL_TUNING.authoredPlayer.geometryFadeMaxActive,
    );
    this.applyPlayerLod();
    for (const rig of this.players.values()) {
      rig.advanceVisualTransition?.(dt);
    }
    if (this.temporalAa !== null) {
      this.motionSources.length = 0;
      this.motionSources.push({ object: this.ball, shape: "ball" });
      for (const rig of this.players.values()) {
        this.motionSources.push({ object: rig.root, shape: "player" });
      }
      this.temporalAa.setMotionSources(this.motionSources);
      this.temporalAa.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (dt > 0) {
      this.frameBudget = updateFrameBudget(
        this.frameBudget,
        dt * 1000,
        VISUAL_TUNING.frameBudget,
      );
    }
  }

  /**
   * Apply screen-space detail and a bounded real-shadow budget after the
   * camera has settled for this frame. The LOD only changes presentation; the
   * simulation and snapshot data remain untouched.
   */
  private applyPlayerLod(): void {
    this.camera.updateMatrixWorld();
    this.renderer.getDrawingBufferSize(this.lodBufferSize);
    this.camera.getWorldPosition(this.lodCameraPosition);
    this.camera.getWorldDirection(this.lodForward);
    const tuning = VISUAL_TUNING.playerLod;
    const verticalFovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    this.lodEntries.length = 0;
    for (const [id, rig] of this.players) {
      const world = rig.root.getWorldPosition(this.lodPlayerPosition);
      this.lodToPlayer.subVectors(world, this.lodCameraPosition);
      const distanceM = this.lodToPlayer.length();
      this.lodProjected.copy(world).project(this.camera);
      const onScreen = isNdcPointOnScreen(
        this.lodProjected.x,
        this.lodProjected.y,
        this.lodProjected.z,
        tuning.screenMarginNdc,
      );
      // Behind or outside the frustum must not become "close" through
      // perspective wrap.
      const screenHeightPx =
        onScreen && this.lodToPlayer.dot(this.lodForward) > 0
          ? projectedHeightPx(
              tuning.referenceHeightM,
              distanceM,
              this.height,
              verticalFovRadians,
            )
          : 0;
      this.lodEntries.push({
        id,
        distanceM,
        screenHeightPx,
        onScreen,
      });
    }
    const shadowCap = this.frameBudget.pressured
      ? Math.min(
          tuning.maxShadowCasters,
          VISUAL_TUNING.frameBudget.pressureShadowCasters,
        )
      : tuning.maxShadowCasters;
    const casters = VISUAL_QUALITY[this.visualQuality].shadows
      ? shadowCasterIds(this.lodEntries, tuning, shadowCap)
      : new Set<string>();
    for (const entry of this.lodEntries) {
      const rig = this.players.get(entry.id);
      if (rig !== undefined) {
        const root = rig.root.getWorldPosition(this.lodPlayerPosition);
        this.lodProjected.copy(root).project(this.camera);
        rig.setDitherAnchor?.(
          (this.lodProjected.x * 0.5 + 0.5) * this.lodBufferSize.x,
          (this.lodProjected.y * 0.5 + 0.5) * this.lodBufferSize.y,
        );
      }
      const detail = playerDetailForScreenHeight(
        entry.screenHeightPx,
        tuning,
      );
      rig?.setDetail?.(detail);
      rig?.setAnimationStride?.(
        animationStrideFor(detail, tuning.animation, entry.onScreen),
      );
      rig?.setMaterialLod?.(detail === "minimal");
      rig?.setShadowCasting?.(casters.has(entry.id));
      const geometryRequest = nextGeometryRequest(
        this.geometryRequests.get(entry.id),
        geometryForDetail(detail),
        tuning.geometrySwitchFrames,
      );
      this.geometryRequests.set(entry.id, geometryRequest);
      rig?.setGeometryDetail?.(geometryRequest.committed);
    }
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) {
      return;
    }
    this.cameraMode = mode;
    this.temporalAa?.reset();
    this.baseShot = createCameraShot(mode);
    if (this.lastCameraState !== null) {
      this.cameraDirector.replaceBase(
        this.baseShot,
        this.lastCameraState,
        CAMERA_TUNING.director.modeSwitchBlendSeconds,
      );
    }
  }

  setReplayActive(active: boolean): void {
    if (active === this.replayActive) {
      return;
    }
    this.replayActive = active;
    this.temporalAa?.reset();
    this.cameraDirector.reset();
    this.contextController.reset();
    this.lastCameraState = null;
    this.lastCameraPose = null;
    this.lastRenderAtMs = null;
  }

  inputBasis(): CameraInputBasis | null {
    return this.lastCameraPose === null
      ? null
      : cameraGroundBasis(this.lastCameraPose);
  }

  setFootstepSink(sink: FootstepSink | null): void {
    this.authoredPlayers.setFootstepSink(
      sink === null
        ? null
        : (event) => {
            this.camera.getWorldDirection(this.footstepForward);
            this.footstepRight
              .crossVectors(this.footstepForward, WORLD_UP)
              .normalize();
            if (this.footstepRight.lengthSq() < 1e-6) {
              this.footstepRight.set(1, 0, 0);
            }
            this.camera.getWorldPosition(this.footstepListener);
            const mixed = spatializeFootstep({
              x: event.x,
              z: event.z,
              listenerX: this.footstepListener.x,
              listenerZ: this.footstepListener.z,
              rightX: this.footstepRight.x,
              rightZ: this.footstepRight.z,
              referenceDistanceM:
                VISUAL_TUNING.audio.footstepReferenceDistanceM,
              maxDistanceM: VISUAL_TUNING.audio.footstepMaxDistanceM,
              panStrength: VISUAL_TUNING.audio.footstepPanStrength,
            });
            sink({ ...event, ...mixed });
          },
    );
  }

  setQuality(quality: VisualQuality): void {
    if (quality === this.visualQuality) {
      return;
    }
    this.visualQuality = quality;
    this.applyQuality();
  }

  setTemporalAa(enabled: boolean): void {
    if (enabled === (this.temporalAa !== null)) {
      return;
    }
    if (enabled) {
      this.temporalAa = new TemporalAa(this.renderer);
      this.temporalAa.resize();
    } else {
      this.temporalAa?.dispose();
      this.temporalAa = null;
    }
  }

  indicatorStates(): readonly ScreenIndicator[] {
    const view = this.lastView;
    if (view === null || this.lastCameraPose === null) {
      return [];
    }
    const points: {
      readonly id: ScreenIndicator["id"];
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }[] = [
      {
        id: "ball",
        x: view.ball.x,
        y: view.ball.y,
        z: Math.max(0, view.ball.z),
      },
    ];
    const controlled = [...view.home.players, ...view.away.players].find(
      (player) => player.controlled && !player.sentOff,
    );
    if (controlled !== undefined) {
      points.push({
        id: "controlled",
        x: controlled.x,
        y: controlled.y,
        z: 0,
      });
    }

    const indicators: ScreenIndicator[] = [];
    for (const point of points) {
      const world = pitchToWorld(view.pitch, point.x, point.y, point.z);
      const indicator = projectScreenIndicator(
        point.id,
        new THREE.Vector3(world.x, world.y, world.z),
        this.camera,
      );
      if (indicator !== null) {
        indicators.push(indicator);
      }
    }
    return indicators;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.contextController.destroy();
    this.cameraDebug.destroy();
    this.clearPlayers();
    this.authoredPlayers.dispose();
    this.temporalAa?.dispose();
    disposeObject(this.scene);
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private applyQuality(): void {
    const profile = VISUAL_QUALITY[this.visualQuality];
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.keyLight.castShadow = profile.shadows;
    this.keyLight.shadow.mapSize.set(
      profile.shadowMapSize,
      profile.shadowMapSize,
    );
    const shadowMap = this.keyLight.shadow.map;
    if (shadowMap !== null) {
      shadowMap.dispose();
      this.keyLight.shadow.map = null;
    }
    if (this.stadium !== null) {
      this.stadium.group.visible = profile.crowd;
    }
    this.ballTrail.visible = profile.ballTrail;
    if (!profile.landingMarker) {
      this.landingMarker.visible = false;
    }
    const stage = this.canvas.parentElement;
    if (stage !== null) {
      stage.dataset.quality = this.visualQuality;
    }
    this.resize();
  }

  private updateBallEffects(view: MatchView): void {
    const profile = VISUAL_QUALITY[this.visualQuality];
    const speed = Math.hypot(view.ball.vx, view.ball.vy, view.ball.vz);
    const trail = VISUAL_TUNING.trail;
    const showTrail =
      profile.ballTrail &&
      speed >= trail.minSpeedMps &&
      this.trailPositions.length >= 3;
    this.ballTrail.visible = showTrail;
    if (showTrail) {
      this.trailPositions.copyWithin(3, 0, trail.maxPoints * 3 - 3);
      this.trailPositions[0] = this.ball.position.x;
      this.trailPositions[1] = this.ball.position.y;
      this.trailPositions[2] = this.ball.position.z;
      this.trailCount = Math.min(trail.maxPoints, this.trailCount + 1);
      this.trailGeometry.setDrawRange(0, this.trailCount);
      const position = this.trailGeometry.getAttribute("position");
      position.needsUpdate = true;
      const material = this.ballTrail.material as THREE.LineBasicMaterial;
      material.opacity = trail.opacity;
    } else {
      this.trailCount = 0;
      this.trailGeometry.setDrawRange(0, 0);
    }

    if (!profile.landingMarker) {
      this.landingMarker.visible = false;
      return;
    }
    const landing = predictLandingPoint(
      view.ball,
      view.pitch,
      TUNING.ball.gravityMps2,
      VISUAL_TUNING.landing.minHeightM,
    );
    if (landing === null) {
      this.landingMarker.visible = false;
      return;
    }
    const world = pitchToWorld(
      view.pitch,
      landing.x,
      landing.y,
      BALL_LANDING_WORLD_HEIGHT_M,
    );
    this.landingMarker.position.set(world.x, world.y, world.z);
    this.landingMarker.visible = true;
    const pulse = 1 + Math.sin(view.tick * 0.16) * 0.08;
    this.landingMarker.scale.setScalar(pulse);
    this.landingMaterial.opacity = VISUAL_TUNING.landing.opacity;
  }

  private updateGoalMoment(view: MatchView, deltaSeconds: number): void {
    const match = view.match;
    if (match === null) {
      this.lastScoreHome = null;
      this.lastScoreAway = null;
    } else if (
      this.lastScoreHome === null ||
      this.lastScoreAway === null
    ) {
      this.lastScoreHome = match.scoreHome;
      this.lastScoreAway = match.scoreAway;
    } else {
      const homeScored = match.scoreHome > this.lastScoreHome;
      const awayScored = match.scoreAway > this.lastScoreAway;
      if (homeScored) {
        this.goalNets.find((net) => net.side === "away")?.trigger();
      }
      if (awayScored) {
        this.goalNets.find((net) => net.side === "home")?.trigger();
      }
      if (homeScored || awayScored) {
        this.stadium?.triggerCelebration();
      }
      this.lastScoreHome = match.scoreHome;
      this.lastScoreAway = match.scoreAway;
    }

    for (const net of this.goalNets) {
      net.update(deltaSeconds);
    }
    this.stadium?.update(deltaSeconds);
  }

  private installPitch(pitch: Pitch): void {
    if (this.pitchGroup.children.length > 0) {
      disposeObject(this.pitchGroup);
      this.pitchGroup.clear();
    }
    const visual = createPitchVisual(pitch);
    this.pitchGroup.add(visual.group);
    this.stadium = visual.stadium;
    this.stadium.group.visible = VISUAL_QUALITY[this.visualQuality].crowd;
    this.goalNets = visual.goalNets;
    this.lastScoreHome = null;
    this.lastScoreAway = null;
    this.pitch = pitch;
    this.pitchKey = pitchKey(pitch);
    this.cameraDirector.reset();
    this.contextController.reset();
    this.lastCameraPose = null;
    this.lastRenderAtMs = null;
  }

  private applyCameraPose(pose: CameraPose): void {
    this.camera.position.set(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    const near = CAMERA_TUNING.camera.nearClipM;
    const far = CAMERA_TUNING.camera.farClipM;
    if (
      pose.fovDegrees !== this.lastFovDegrees ||
      near !== this.lastNearClipM ||
      far !== this.lastFarClipM
    ) {
      this.camera.fov = pose.fovDegrees;
      this.camera.near = near;
      this.camera.far = far;
      this.lastFovDegrees = pose.fovDegrees;
      this.lastNearClipM = near;
      this.lastFarClipM = far;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncPlayers(view: MatchView): void {
    const authored =
      this.authoredPlayers.ready && this.visualQuality !== "low";
    if (authored !== this.usingAuthoredPlayers) {
      this.clearPlayers();
      this.usingAuthoredPlayers = authored;
    }

    if (authored && this.authoredPlayers.lowReady) {
      const lowTemplate = this.authoredPlayers.lowTemplateAsset;
      for (const rig of this.players.values()) {
        rig.attachLowTemplate?.(lowTemplate);
      }
    }

    const seen = this.seenPlayers;
    seen.clear();
    for (const team of [view.away, view.home]) {
      for (const player of team.players) {
        seen.add(player.id);
        let rig = this.players.get(player.id);
        if (rig === undefined) {
          if (authored) {
            rig = this.authoredPlayers.create(player, team.colors) ?? undefined;
          }
          rig ??= new PlayerRig(player, team.colors);
          this.players.set(player.id, rig);
          this.scene.add(rig.root);
        }
        rig.update(view.pitch, player, view.elapsedSeconds, view.tick);
      }
    }
    for (const [id, rig] of this.players) {
      if (seen.has(id)) {
        continue;
      }
      this.scene.remove(rig.root);
      rig.dispose();
      this.players.delete(id);
      this.geometryRequests.delete(id);
    }
  }

  private clearPlayers(): void {
    for (const rig of this.players.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.players.clear();
    this.seenPlayers.clear();
    this.geometryRequests.clear();
  }

  private updateBall(view: MatchView): void {
    const world = pitchToWorld(view.pitch, view.ball.x, view.ball.y, view.ball.z);
    this.ball.position.set(world.x, world.y, world.z);
    this.ball.rotation.x = view.tick * 0.16 + view.ball.spinZ * 0.22;
    this.ball.rotation.z = view.tick * 0.11;

    const ground = pitchToWorld(view.pitch, view.ball.x, view.ball.y, 0.018);
    this.ballShadow.position.set(ground.x, ground.y, ground.z);
    const height = Math.max(0, view.ball.z - BALL_RADIUS_M);
    const scale = 1 + Math.min(1.6, height * 0.12);
    this.ballShadow.scale.set(scale, scale, scale);
    this.ballShadowMaterial.opacity = Math.max(
      0.06,
      0.3 - Math.min(0.22, height * 0.04),
    );
  }
}

export function createThreeRenderer(
  canvas: HTMLCanvasElement,
): MatchRenderer {
  return new ThreeMatchRenderer(canvas);
}

function pitchKey(pitch: Pitch): string {
  return [
    pitch.lengthM,
    pitch.widthM,
    pitch.goalWidthM,
    pitch.goalHeightM,
    pitch.penaltyAreaLengthM,
    pitch.penaltyAreaWidthM,
    pitch.goalAreaLengthM,
    pitch.goalAreaWidthM,
  ].join(":");
}

function createBallAssets(): {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly shadowMaterial: THREE.MeshBasicMaterial;
} {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS_M, 24, 18),
    new THREE.MeshStandardMaterial({
      map: createBallTexture(),
      roughness: 0.56,
      metalness: 0.02,
    }),
  );
  ball.castShadow = true;
  ball.name = "ball";

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS_M * 1.45, 20),
    shadowMaterial,
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.name = "ball-shadow";

  return { mesh: ball, shadow, shadowMaterial };
}

function createBackdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#0c2117");
    gradient.addColorStop(0.55, "#07150d");
    gradient.addColorStop(1, "#040b07");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#f5faf6";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#18211b";
    for (const [x, y, radius] of [
      [128, 58, 24],
      [58, 150, 21],
      [198, 150, 21],
      [128, 210, 18],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(24, 33, 27, 0.45)";
    ctx.lineWidth = 3;
    for (const x of [0, 64, 128, 192, 256]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo((x + 90) % 256, 256);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function temporalAaEnabled(): boolean {
  try {
    const query = new URLSearchParams(window.location.search).get("taa");
    if (query === "1") {
      return true;
    }
    if (query === "0") {
      return false;
    }
  } catch {
    // Fall through to the configured default.
  }
  return VISUAL_TUNING.temporalAa.enabled;
}
