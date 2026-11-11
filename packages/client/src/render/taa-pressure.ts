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
