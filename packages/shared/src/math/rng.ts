// packages/shared/src/math/rng.ts

const UINT32_RANGE = 4_294_967_296;
const MULBERRY_INCREMENT = 0x6d2b79f5;

/**
 * Deterministic pseudo-random source.
 *
 * All gameplay randomness must flow through an instance created from a seed so
 * a replay is reproducible from the seed and input log.
 */
export interface Rng {
  /** Normalized seed actually used (uint32). */
  readonly seed: number;
  /** Uniform value in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
  /** Uniform real in [min, max), or `min` when equal. */
  range(min: number, max: number): number;
  /** True with probability `probability`, in [0, 1]. */
  chance(probability: number): boolean;
  /** Uniform element; throws on an empty collection. */
  pick<T>(items: readonly T[]): T;
}

/**
 * mulberry32: tiny, fast, good enough for games, and trivially portable.
 * Chosen over Math.random so server, client tests and replays agree exactly.
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${seed}`);
  }

  const normalizedSeed = seed >>> 0;
  let state = normalizedSeed;

  const next = (): number => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };

  const int = (minInclusive: number, maxExclusive: number): number => {
    if (
      !Number.isSafeInteger(minInclusive) ||
      !Number.isSafeInteger(maxExclusive)
    ) {
      throw new RangeError("int bounds must be safe integers");
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError(
        `maxExclusive (${maxExclusive}) must exceed minInclusive (${minInclusive})`,
      );
    }
    const span = maxExclusive - minInclusive;
    if (span > UINT32_RANGE) {
      throw new RangeError("int span exceeds the 32-bit generator range");
    }

    // Rejection sampling removes modulo bias; deterministic because draws are.
    const rejectionLimit = Math.floor(UINT32_RANGE / span) * span;
    let draw = Math.floor(next() * UINT32_RANGE);
    while (draw >= rejectionLimit) {
      draw = Math.floor(next() * UINT32_RANGE);
    }
    return minInclusive + (draw % span);
  };

  const range = (min: number, max: number): number => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new RangeError(`invalid range [${min}, ${max})`);
    }
    return min + next() * (max - min);
  };

  const chance = (probability: number): boolean => {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError(`probability must be in [0, 1], got ${probability}`);
    }
    return next() < probability;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError("cannot pick from an empty collection");
    }
    return items[int(0, items.length)] as T;
  };

  return { seed: normalizedSeed, next, int, range, chance, pick };
}
