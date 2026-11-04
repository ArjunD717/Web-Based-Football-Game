// packages/client/src/render/visualTuning.ts

/**
 * Presentation-only scale and effect settings. None of these values are read
 * by the simulation; they change what the renderer draws, never collisions,
 * physics or the network snapshot.
 */

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
