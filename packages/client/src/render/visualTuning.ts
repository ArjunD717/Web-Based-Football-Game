// packages/client/src/render/visualTuning.ts

/**
 * Presentation-only scale and effect settings. None of these values are read
 * by the simulation; they change what the renderer draws, never collisions,
 * physics or the network snapshot.
 */

import type { PlayerStateName } from "@fb/sim";

export type VisualQuality = "low" | "medium" | "high";

export interface VisualQualityProfile {
  /** Upper bound applied to window.devicePixelRatio. */
  readonly maxPixelRatio: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Draw the procedural stand/crowd surround. */
  readonly crowd: boolean;
  /** Draw the fast-ball motion trail. */
  readonly ballTrail: boolean;
  /** Draw the predicted landing ring for aerial balls. */
  readonly landingMarker: boolean;
  /** Add the CSS edge vignette to the match stage. */
  readonly vignette: boolean;
}

export const DEFAULT_VISUAL_QUALITY: VisualQuality = "high";
export const VISUAL_QUALITY_STORAGE_KEY = "fb.visualQuality";

export const VISUAL_QUALITY: Readonly<
  Record<VisualQuality, VisualQualityProfile>
> = {
  low: {
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    crowd: false,
    ballTrail: false,
    landingMarker: false,
    vignette: false,
  },
  medium: {
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    crowd: true,
    ballTrail: true,
    landingMarker: true,
    vignette: true,
  },
  high: {
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    crowd: true,
    ballTrail: true,
    landingMarker: true,
    vignette: true,
  },
};

export interface VisualTuning {
  /** Render-only player model scale; physics stays at the real capsule size. */
  readonly playerScale: number;
  /** Render-only ball model scale; physics stays at the real 0.22 m diameter. */
  readonly ballScale: number;
  readonly authoredPlayer: {
    /** Base shoulder drop applied to the glTF A-pose in every grounded pose. */
    readonly armDownRadians: number;
    /** Exponential quaternion blend rate between animation targets. */
    readonly poseBlendRate: number;
    /** Seconds used to cross-fade between baked animation clips. */
    readonly clipFadeSeconds: number;
    /** Action time multiplier at empty stamina; 1 at full stamina. */
    readonly clipStaminaTimeScaleMin: number;
    readonly footPlant: {
      /** Highest root correction allowed for a single foot-plant pass. */
      readonly maxCorrectionM: number;
      /** Exponential rate at which the root approaches the planted height. */
      readonly rate: number;
      /** Intended ankle lift for states that keep a foot on the pitch. */
      readonly groundLiftM: Partial<Record<PlayerStateName, number>>;
    };
    readonly footIk: {
      /** Ankle height below which a stance foot acquires a world anchor. */
      readonly contactEnterM: number;
      /** Ankle height above which the stance anchor is released. */
      readonly contactExitM: number;
      /** Release a plant once the hip has moved this far from it. */
      readonly maxPlantTravelM: number;
      /** Exponential rate at which the leg approaches the IK solution. */
      readonly blendRate: number;
      /** Keep the knee just short of a fully straight singular chain. */
      readonly reachMarginM: number;
      /** A root jump larger than this resets all foot anchors. */
      readonly teleportResetM: number;
    };
    readonly stride: {
      readonly minRating: number;
      readonly neutralRating: number;
      readonly maxRating: number;
      /** Reference-speed multiplier at minRating. */
      readonly minScale: number;
      /** Reference-speed multiplier at maxRating. */
      readonly maxScale: number;
    };
    readonly gait: {
      /** Nominal movement speed for each locomotion animation, m/s. */
      readonly referenceSpeedMps: Partial<Record<PlayerStateName, number>>;
      /** Slowest playback when the player is nearly stationary. */
      readonly minPlaybackScale: number;
      /** Fastest playback for an over-speed state. */
      readonly maxPlaybackScale: number;
      /** Exponential smoothing rate for measured root speed. */
      readonly speedSmoothingRate: number;
      /** Ignore frame samples above this as network teleports. */
      readonly speedCapMps: number;
    };
    readonly footsteps: {
      /** Below this measured speed a contact should stay silent. */
      readonly minSpeedMps: number;
      /** Debounce repeated stride crossings. */
      readonly minIntervalSeconds: number;
    };
    readonly appearance: {
      /** Skin tones are multipliers over the authored pore/vertex map. */
      readonly skinTones: readonly string[];
      readonly bootColors: readonly string[];
    };
  };
  readonly crowd: {
    /** Stand distance outside the touchlines / goal lines. */
    readonly sideInsetM: number;
    readonly endInsetM: number;
    readonly heightM: number;
    /** Extra stand length beyond the pitch at each end. */
    readonly lengthPadM: number;
    /** Crowd texture repeat across the stand face. */
    readonly textureRepeatX: number;
  };
  readonly trail: {
    readonly maxPoints: number;
    readonly minSpeedMps: number;
    readonly opacity: number;
  };
  readonly playerLod: {
    /** Reference standing height used for the screen-size estimate. */
    readonly referenceHeightM: number;
    /** Full overlays above this vertical projected height. */
    readonly fullDetailScreenPx: number;
    /** Reduced overlays above this vertical projected height. */
    readonly reducedDetailScreenPx: number;
    /** Players shorter than this do not cast real shadows. */
    readonly shadowMinScreenPx: number;
    /** Only players inside this distance may cast a real shadow. */
    readonly shadowDistanceM: number;
    /** Hard budget for simultaneous skinned shadow casters. */
    readonly maxShadowCasters: number;
    /** NDC margin before off-screen players lose detail and shadows. */
    readonly screenMarginNdc: number;
    readonly animation: {
      /** Update every frame while at full detail. */
      readonly fullStride: number;
      /** Update every second frame at reduced detail. */
      readonly reducedStride: number;
      /** Update every fourth frame at minimal detail. */
      readonly minimalStride: number;
      /** Even slower cadence while outside the camera frustum. */
      readonly hiddenStride: number;
    };
  };
  readonly audio: {
    /** Footsteps at or inside this listener distance play at full gain. */
    readonly footstepReferenceDistanceM: number;
    /** Footsteps at or beyond this distance are silent. */
    readonly footstepMaxDistanceM: number;
    /** Maximum hard-left/right pan applied at 90 degrees. */
    readonly footstepPanStrength: number;
  };
  readonly landing: {
    readonly minHeightM: number;
    readonly radiusM: number;
    readonly opacity: number;
  };
  readonly goalMoment: {
    /** Seconds the net keeps moving after a goal. */
    readonly netDurationSeconds: number;
    /** Maximum local net displacement in metres. */
    readonly netAmplitudeM: number;
    /** Seconds the crowd remains lit after a goal. */
    readonly crowdDurationSeconds: number;
    /** Extra material brightness at the peak. */
    readonly crowdBrightness: number;
  };
  readonly cornerFlag: {
    readonly poleHeightM: number;
    readonly flagWidthM: number;
    readonly flagHeightM: number;
    readonly poleRadiusM: number;
  };
}

export const VISUAL_TUNING: VisualTuning = {
  playerScale: 1.22,
  ballScale: 1.45,
  authoredPlayer: {
    armDownRadians: -0.58,
    poseBlendRate: 20,
    clipFadeSeconds: 0.14,
    clipStaminaTimeScaleMin: 0.86,
    footPlant: {
      maxCorrectionM: 0.12,
      rate: 16,
      groundLiftM: {
        idle: 0,
        jog: 0.008,
        sprint: 0.018,
        dribble: 0.004,
        pass: 0.004,
        shoot: 0.004,
        volley: 0.008,
        tackle: 0,
      },
    },
    footIk: {
      contactEnterM: 0.035,
      contactExitM: 0.08,
      maxPlantTravelM: 1.25,
      blendRate: 24,
      reachMarginM: 0.008,
      teleportResetM: 1.5,
    },
    stride: {
      minRating: 40,
      neutralRating: 75,
      maxRating: 99,
      minScale: 0.9,
      maxScale: 1.12,
    },
    gait: {
      referenceSpeedMps: {
        jog: 4.2,
        sprint: 8.6,
        dribble: 3.1,
      },
      minPlaybackScale: 0.55,
      maxPlaybackScale: 1.45,
      speedSmoothingRate: 9,
      speedCapMps: 13,
    },
    footsteps: {
      minSpeedMps: 1.1,
      minIntervalSeconds: 0.26,
    },
    appearance: {
      skinTones: [
        "#f0c8a8",
        "#d9a477",
        "#b77b52",
        "#8d5b3a",
        "#633d28",
        "#412617",
      ],
      bootColors: ["#f2efe4", "#111715", "#d52632", "#1d4ed8", "#e3b341"],
    },
  },
  crowd: {
    sideInsetM: 5,
    endInsetM: 7,
    heightM: 8,
    lengthPadM: 14,
    textureRepeatX: 3,
  },
  trail: {
    maxPoints: 24,
    minSpeedMps: 13,
    opacity: 0.5,
  },
  playerLod: {
    referenceHeightM: 1.8,
    fullDetailScreenPx: 42,
    reducedDetailScreenPx: 14,
    shadowMinScreenPx: 8,
    shadowDistanceM: 80,
    maxShadowCasters: 4,
    screenMarginNdc: 0.08,
    animation: {
      fullStride: 1,
      reducedStride: 2,
      minimalStride: 4,
      hiddenStride: 8,
    },
  },
  audio: {
    footstepReferenceDistanceM: 4,
    footstepMaxDistanceM: 60,
    footstepPanStrength: 0.7,
  },
  landing: {
    minHeightM: 1.2,
    radiusM: 1.15,
    opacity: 0.7,
  },
  goalMoment: {
    netDurationSeconds: 1.4,
    netAmplitudeM: 0.24,
    crowdDurationSeconds: 2.8,
    crowdBrightness: 0.65,
  },
  cornerFlag: {
    poleHeightM: 1.5,
    flagWidthM: 0.55,
    flagHeightM: 0.34,
    poleRadiusM: 0.025,
  },
};

export function parseVisualQuality(value: unknown): VisualQuality {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_VISUAL_QUALITY;
}

export function loadVisualQuality(): VisualQuality {
  try {
    return parseVisualQuality(
      window.localStorage.getItem(VISUAL_QUALITY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_VISUAL_QUALITY;
  }
}

export function saveVisualQuality(quality: VisualQuality): void {
  try {
    window.localStorage.setItem(VISUAL_QUALITY_STORAGE_KEY, quality);
  } catch {
    // The current session still uses the selected quality.
  }
}
