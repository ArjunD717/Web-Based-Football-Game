// packages/server/src/rooms/simulation-loop.ts

import { TUNING } from "@fb/shared";
import type { RoomManager } from "./room-manager";

export interface SimulationLoopOptions {
  /** Wall-clock loop frequency. The match itself remains a fixed 60 Hz sim. */
  readonly tickHz?: number;
  /** Optional acceptance/test multiplier; production always runs at 1. */
  readonly speed?: number;
  readonly now?: () => number;
  readonly onTick?: (elapsedMs: number, simulatedSeconds: number) => void;
}

export interface RunningSimulationLoop {
  stop(): void;
}

/**
 * Wall-clock pacing for the room accumulator. Timer callbacks never step the
 * simulation directly; they measure elapsed wall time so a delayed callback is
 * absorbed by the fixed-step accumulator instead of producing a variable dt.
 */
export function startSimulationLoop(
  manager: Pick<RoomManager, "tick">,
  options: SimulationLoopOptions = {},
): RunningSimulationLoop {
  const tickHz = options.tickHz ?? TUNING.sim.tickHz;
  const speed = options.speed ?? 1;
  if (!Number.isFinite(tickHz) || tickHz <= 0) {
    throw new RangeError("tickHz must be a positive finite number");
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError("speed must be a positive finite number");
  }
  const now = options.now ?? (() => performance.now());
  let lastFrameAt = now();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = (): void => {
    if (stopped) {
      return;
    }
    const frameAt = now();
    const elapsedSeconds = Math.min(
      Math.max(frameAt - lastFrameAt, 0) / 1_000,
      TUNING.presentation.maxFrameDeltaSeconds,
    );
    lastFrameAt = frameAt;
    const simulatedSeconds = elapsedSeconds * speed;
    if (simulatedSeconds <= 0) {
      return;
    }
    const startedAt = now();
    manager.tick(simulatedSeconds);
    options.onTick?.(now() - startedAt, simulatedSeconds);
  };

  timer = setInterval(tick, 1_000 / tickHz);
  timer.unref();

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
