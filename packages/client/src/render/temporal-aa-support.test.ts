// packages/client/src/render/temporal-aa-support.test.ts

import { describe, expect, it } from "vitest";
import {
  TEMPORAL_AA_MIN_TEXTURE_SIZE,
  temporalAaSupport,
} from "./temporal-aa-support";

describe("temporal AA capability probe", () => {
  it("accepts WebGL 2 with a float color attachment", () => {
    expect(
      temporalAaSupport({
        isWebGL2: true,
        colorBufferFloat: true,
        colorBufferHalfFloat: false,
        maxTextureSize: 8192,
      }).supported,
    ).toBe(true);
  });

  it("accepts WebGL 2 with only the half-float extension", () => {
    expect(
      temporalAaSupport({
        isWebGL2: true,
        colorBufferFloat: false,
        colorBufferHalfFloat: true,
        maxTextureSize: 4096,
      }).supported,
    ).toBe(true);
  });

  it("rejects WebGL 1, missing color buffers and small textures", () => {
    expect(
      temporalAaSupport({
        isWebGL2: false,
        colorBufferFloat: true,
        colorBufferHalfFloat: true,
        maxTextureSize: 8192,
      }).supported,
    ).toBe(false);
    expect(
      temporalAaSupport({
        isWebGL2: true,
        colorBufferFloat: false,
        colorBufferHalfFloat: false,
        maxTextureSize: 8192,
      }).supported,
    ).toBe(false);
    expect(
      temporalAaSupport({
        isWebGL2: true,
        colorBufferFloat: true,
        colorBufferHalfFloat: true,
        maxTextureSize: TEMPORAL_AA_MIN_TEXTURE_SIZE - 1,
      }).supported,
    ).toBe(false);
  });
});
