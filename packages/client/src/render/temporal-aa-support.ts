// packages/client/src/render/temporal-aa-support.ts

/** Minimum drawing-buffer width/height usable for TAA history and depth. */
export const TEMPORAL_AA_MIN_TEXTURE_SIZE = 1024;

export interface TemporalAaContextCapabilities {
  readonly isWebGL2: boolean;
  readonly colorBufferFloat: boolean;
  readonly colorBufferHalfFloat: boolean;
  readonly maxTextureSize: number;
}

export interface TemporalAaSupport {
  readonly supported: boolean;
  /** User-facing reason when the context cannot host the resolve. */
  readonly reason: string;
}

/**
 * Half-float color attachments carry the velocity and previous-depth history.
 * WebGL 1 cannot provide the required formats; WebGL 2 still needs a float or
 * half-float color-buffer extension before allocating the history pair.
 */
export function temporalAaSupport(
  capabilities: TemporalAaContextCapabilities,
): TemporalAaSupport {
  if (!capabilities.isWebGL2) {
    return {
      supported: false,
      reason: "Temporal antialiasing requires WebGL 2",
    };
  }
  if (
    !capabilities.colorBufferFloat &&
    !capabilities.colorBufferHalfFloat
  ) {
    return {
      supported: false,
      reason: "This GPU cannot render half-float history buffers",
    };
  }
  if (
    !Number.isFinite(capabilities.maxTextureSize) ||
    capabilities.maxTextureSize < TEMPORAL_AA_MIN_TEXTURE_SIZE
  ) {
    return {
      supported: false,
      reason: "This GPU cannot allocate full-resolution history buffers",
    };
  }
  return { supported: true, reason: "" };
}
