// packages/server/src/rooms/simulation-loop.test.ts

import { afterEach, describe, expect, it, vi } from "vitest";
import { startSimulationLoop } from "./simulation-loop";

afterEach(() => {
  vi.useRealTimers();
});

describe("simulation loop pacing", () => {
  it("feeds measured wall time into the fixed-step accumulator", () => {
    vi.useFakeTimers();
    let wallMs = 0;
    const tick = vi.fn();
    const samples: number[] = [];
    const loop = startSimulationLoop(
      { tick },
      {
        tickHz: 60,
        now: () => wallMs,
        onTick: (_elapsed, simulatedSeconds) => {
          samples.push(simulatedSeconds);
        },
      },
    );

    wallMs = 16;
    vi.advanceTimersByTime(17);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith(0.016);
    expect(samples).toEqual([0.016]);

    wallMs = 1_016;
    vi.advanceTimersByTime(17);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(tick.mock.calls[1]?.[0]).toBe(0.25);

    loop.stop();
    wallMs = 2_000;
    vi.advanceTimersByTime(17);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("applies an explicit acceptance speed multiplier", () => {
    vi.useFakeTimers();
    let wallMs = 0;
    const tick = vi.fn();
    const loop = startSimulationLoop(
      { tick },
      { tickHz: 60, speed: 4, now: () => wallMs },
    );

    wallMs = 16;
    vi.advanceTimersByTime(17);
    expect(tick).toHaveBeenCalledWith(0.064);
    loop.stop();
  });

  it("rejects a non-positive loop rate or speed", () => {
    expect(() => startSimulationLoop({ tick: vi.fn() }, { tickHz: 0 })).toThrow(
      RangeError,
    );
    expect(() => startSimulationLoop({ tick: vi.fn() }, { speed: 0 })).toThrow(
      RangeError,
    );
  });
});
