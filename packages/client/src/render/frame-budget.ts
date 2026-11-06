// packages/client/src/render/frame-budget.ts

/**
 * Presentation-only adaptive budget. It never feeds the simulation; pressure
 * only reduces the number of authored players allowed to cast real shadows.
 */
export interface FrameBudgetTuning {
  /** Desired wall-clock interval for one rendered frame. */
  readonly targetFrameMs: number;
  /** A frame above target × this ratio counts as slow. */
  readonly slowFrameRatio: number;
  /** A frame below target × this ratio counts as recovered. */
  readonly recoverFrameRatio: number;
  /** Consecutive slow frames required before entering pressure. */
  readonly slowStreak: number;
  /** Consecutive recovered frames required before leaving pressure. */
  readonly recoverStreak: number;
  /** Shadow-caster cap while pressure is active. */
  readonly pressureShadowCasters: number;
}

export interface FrameBudgetState {
  readonly slowStreak: number;
  readonly recoverStreak: number;
  readonly pressured: boolean;
}

export const INITIAL_FRAME_BUDGET_STATE: FrameBudgetState = Object.freeze({
  slowStreak: 0,
  recoverStreak: 0,
  pressured: false,
});

/**
 * Hysteresis avoids quality flapping. Invalid or out-of-range intervals leave
 * the state untouched so a suspended tab cannot trigger pressure.
 */
export function updateFrameBudget(
  state: FrameBudgetState,
  frameMs: number,
  tuning: FrameBudgetTuning,
): FrameBudgetState {
  if (
    !Number.isFinite(frameMs) ||
    frameMs <= 0 ||
    frameMs > 250 ||
    !Number.isFinite(tuning.targetFrameMs) ||
    tuning.targetFrameMs <= 0
  ) {
    return state;
  }
  const slowThreshold = tuning.targetFrameMs * tuning.slowFrameRatio;
  const recoverThreshold = tuning.targetFrameMs * tuning.recoverFrameRatio;
  if (frameMs >= slowThreshold) {
    const slowStreak = state.slowStreak + 1;
    if (!state.pressured && slowStreak >= tuning.slowStreak) {
      return { slowStreak: 0, recoverStreak: 0, pressured: true };
    }
    return {
      slowStreak,
      recoverStreak: 0,
      pressured: state.pressured,
    };
  }
  if (frameMs <= recoverThreshold) {
    const recoverStreak = state.recoverStreak + 1;
    if (state.pressured && recoverStreak >= tuning.recoverStreak) {
      return INITIAL_FRAME_BUDGET_STATE;
    }
    return {
      slowStreak: 0,
      recoverStreak,
      pressured: state.pressured,
    };
  }
  // A frame inside the hysteresis band cancels both streaks.
  if (state.slowStreak === 0 && state.recoverStreak === 0) {
    return state;
  }
  return {
    slowStreak: 0,
    recoverStreak: 0,
    pressured: state.pressured,
  };
}

/** The benchmark gate uses the same target as the runtime controller. */
export function meetsFrameBudget(
  percentileMs: number,
  tuning: FrameBudgetTuning,
): boolean {
  return (
    Number.isFinite(percentileMs) &&
    percentileMs <= tuning.targetFrameMs
  );
}
