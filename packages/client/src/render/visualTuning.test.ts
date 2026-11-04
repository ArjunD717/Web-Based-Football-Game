// packages/client/src/render/visualTuning.test.ts

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_QUALITY,
  VISUAL_QUALITY,
  VISUAL_TUNING,
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

  it("keeps render-only scale values separate from physics", () => {
    expect(VISUAL_TUNING.playerScale).toBeGreaterThanOrEqual(1.1);
    expect(VISUAL_TUNING.playerScale).toBeLessThanOrEqual(1.25);
    expect(VISUAL_TUNING.ballScale).toBeGreaterThanOrEqual(1.3);
    expect(VISUAL_TUNING.ballScale).toBeLessThanOrEqual(1.6);
  });
});
