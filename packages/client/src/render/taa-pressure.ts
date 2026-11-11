// packages/client/src/render/taa-pressure.ts

export interface TaaPressureState {
  /** Consecutive TAA frames whose render time exceeded the threshold. */
  readonly slowFrames: number;
}

export const INITIAL_TAA_PRESSURE_STATE: TaaPressureState = {
  slowFrames: 0,
};

export interface TaaPressureUpdate {
  readonly state: TaaPressureState;
  readonly disable: boolean;
}

/**
 * Render time, not display interval, decides whether TAA is too expensive.
 * A monitor capped at 30/60 Hz must not disable the resolve when the CPU/GPU
 * still finishes the frame inside the budget. One fast frame clears the
 * streak, while sustained pressure disables it exactly once.
 */
export function updateTaaPressure(
  state: TaaPressureState,
  renderMs: number,
  thresholdMs: number,
  framesToDisable: number,
): TaaPressureUpdate {
  if (!Number.isFinite(renderMs) || renderMs <= thresholdMs) {
    return {
      state:
        state.slowFrames === 0
          ? state
          : INITIAL_TAA_PRESSURE_STATE,
      disable: false,
    };
  }
  const slowFrames = Math.min(
    Math.max(1, Math.floor(framesToDisable)),
    state.slowFrames + 1,
  );
  return {
    state: { slowFrames },
    disable: slowFrames >= Math.max(1, Math.floor(framesToDisable)),
  };
}

export interface TaaRecoveryState {
  /** Consecutive direct-path frames below the recovery threshold. */
  readonly fastFrames: number;
}

export const INITIAL_TAA_RECOVERY_STATE: TaaRecoveryState = {
  fastFrames: 0,
};

export interface TaaRecoveryUpdate {
  readonly state: TaaRecoveryState;
  readonly retry: boolean;
}

/**
 * Re-enable TAA only after the direct path has sustained a lower render cost.
 * The gap between disable and recovery thresholds is deliberate hysteresis.
 */
export function updateTaaRecovery(
  state: TaaRecoveryState,
  renderMs: number,
  thresholdMs: number,
  framesToRetry: number,
): TaaRecoveryUpdate {
  if (!Number.isFinite(renderMs) || renderMs > thresholdMs) {
    return {
      state:
        state.fastFrames === 0
          ? state
          : INITIAL_TAA_RECOVERY_STATE,
      retry: false,
    };
  }
  const target = Math.max(1, Math.floor(framesToRetry));
  const fastFrames = Math.min(target, state.fastFrames + 1);
  return { state: { fastFrames }, retry: fastFrames >= target };
}
