// packages/client/src/render/visualTuning.test.ts

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_QUALITY,
  VISUAL_QUALITY,
  VISUAL_TUNING,
  parseTemporalAa,
  parseVisualQuality,
} from "./visualTuning";

describe("visual quality presets", () => {
  it("falls back to high for invalid values", () => {
    expect(parseVisualQuality("low")).toBe("low");
    expect(parseVisualQuality("medium")).toBe("medium");
    expect(parseVisualQuality("high")).toBe("high");
    expect(parseVisualQuality("ultra")).toBe(DEFAULT_VISUAL_QUALITY);
    expect(parseVisualQuality(null)).toBe(DEFAULT_VISUAL_QUALITY);
  });

  it("parses temporal AA switches and keeps a caller fallback", () => {
    expect(parseTemporalAa("1")).toBe(true);
    expect(parseTemporalAa("0")).toBe(false);
    expect(parseTemporalAa(true)).toBe(true);
    expect(parseTemporalAa(false)).toBe(false);
    expect(parseTemporalAa("yes", true)).toBe(true);
    expect(parseTemporalAa(null, false)).toBe(false);
    expect(VISUAL_TUNING.temporalAa.disocclusionDepthM).toBeGreaterThan(0);
  });

  it("increases resolution and shadow resolution with quality", () => {
    expect(VISUAL_QUALITY.low.maxPixelRatio).toBeLessThan(
      VISUAL_QUALITY.medium.maxPixelRatio,
    );
    expect(VISUAL_QUALITY.medium.maxPixelRatio).toBeLessThanOrEqual(
      VISUAL_QUALITY.high.maxPixelRatio,
    );
    expect(VISUAL_QUALITY.low.shadowMapSize).toBeLessThan(
      VISUAL_QUALITY.medium.shadowMapSize,
    );
    expect(VISUAL_QUALITY.medium.shadowMapSize).toBeLessThanOrEqual(
      VISUAL_QUALITY.high.shadowMapSize,
    );
  });

  it("keeps foot contacts sticky but releases them above the lift threshold", () => {
    const ik = VISUAL_TUNING.authoredPlayer.footIk;
    expect(ik.contactEnterM).toBeGreaterThan(0);
    expect(ik.contactExitM).toBeGreaterThan(ik.contactEnterM);
    expect(ik.maxPlantTravelM).toBeGreaterThan(0);
    expect(ik.teleportResetM).toBeGreaterThan(ik.maxPlantTravelM);
  });

  it("keeps stride calibration ordered and neutral at the reference", () => {
    const stride = VISUAL_TUNING.authoredPlayer.stride;
    expect(stride.minRating).toBeLessThan(stride.neutralRating);
    expect(stride.neutralRating).toBeLessThan(stride.maxRating);
    expect(stride.minScale).toBeLessThan(1);
    expect(stride.maxScale).toBeGreaterThan(1);
  });

  it("keeps gait reference speeds inside the simulation's player range", () => {
    const gait = VISUAL_TUNING.authoredPlayer.gait;
    expect(gait.referenceSpeedMps.jog).toBeGreaterThan(0);
    expect(gait.referenceSpeedMps.jog).toBeLessThan(
      gait.referenceSpeedMps.sprint ?? 0,
    );
    expect(gait.minPlaybackScale).toBeLessThan(1);
    expect(gait.maxPlaybackScale).toBeGreaterThan(1);
    expect(gait.speedCapMps).toBeGreaterThan(
      gait.referenceSpeedMps.sprint ?? 0,
    );
  });

  it("keeps screen detail and shadow budgets ordered", () => {
    const lod = VISUAL_TUNING.playerLod;
    expect(lod.fullDetailScreenPx).toBeGreaterThan(lod.reducedDetailScreenPx);
    expect(lod.reducedDetailScreenPx).toBeGreaterThan(lod.shadowMinScreenPx);
    expect(lod.shadowDistanceM).toBeGreaterThan(0);
    expect(lod.maxShadowCasters).toBeGreaterThan(0);
    expect(lod.referenceHeightM).toBeGreaterThan(1);
    expect(lod.screenMarginNdc).toBeGreaterThanOrEqual(0);
    expect(lod.geometrySwitchFrames).toBeGreaterThan(1);
    expect(lod.animation.fullStride).toBe(1);
    expect(lod.animation.reducedStride).toBeGreaterThan(
      lod.animation.fullStride,
    );
    expect(lod.animation.minimalStride).toBeGreaterThan(
      lod.animation.reducedStride,
    );
    expect(lod.animation.hiddenStride).toBeGreaterThan(
      lod.animation.minimalStride,
    );
  });

  it("keeps the adaptive frame budget hysteretic", () => {
    const budget = VISUAL_TUNING.frameBudget;
    expect(budget.targetFrameMs).toBeGreaterThan(0);
    expect(budget.slowFrameRatio).toBeGreaterThan(1);
    expect(budget.recoverFrameRatio).toBeLessThan(1);
    expect(budget.slowStreak).toBeGreaterThan(0);
    expect(budget.recoverStreak).toBeGreaterThan(0);
    expect(budget.pressureShadowCasters).toBeGreaterThanOrEqual(0);
    expect(budget.pressureShadowCasters).toBeLessThan(
      VISUAL_TUNING.playerLod.maxShadowCasters,
    );
  });

  it("keeps footstep attenuation ranges ordered", () => {
    const audio = VISUAL_TUNING.audio;
    expect(audio.footstepReferenceDistanceM).toBeGreaterThan(0);
    expect(audio.footstepMaxDistanceM).toBeGreaterThan(
      audio.footstepReferenceDistanceM,
    );
    expect(audio.footstepPanStrength).toBeGreaterThan(0);
    expect(audio.footstepPanStrength).toBeLessThanOrEqual(1);
  });

  it("keeps render-only scale values separate from physics", () => {
    expect(VISUAL_TUNING.playerScale).toBeGreaterThanOrEqual(1.1);
    expect(VISUAL_TUNING.playerScale).toBeLessThanOrEqual(1.25);
    expect(VISUAL_TUNING.ballScale).toBeGreaterThanOrEqual(1.3);
    expect(VISUAL_TUNING.ballScale).toBeLessThanOrEqual(1.6);
  });
});
