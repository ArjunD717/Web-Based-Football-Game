// packages/server/src/performance.ts
import { TUNING } from "@fb/shared";

export interface ServerTickSnapshot {
  readonly loopHz: number;
  readonly tickBudgetMs: number;
  readonly ticks: number;
  readonly p95TickMs: number;
  readonly maxTickMs: number;
  readonly overBudgetTicks: number;
}

/**
 * Small fixed-size ring of server-loop durations. It is intentionally cheap:
 * one write per tick, with sorting only when /healthz is requested.
 */
export class ServerTickMetrics {
  private readonly samples: number[];
  private readonly budgetMs: number;
  private index = 0;
  private filled = 0;
  private ticks = 0;
  private overBudgetTicks = 0;

  constructor(windowSize = 600) {
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
      throw new RangeError("windowSize must be a positive integer");
    }
    this.samples = new Array<number>(windowSize).fill(0);
    this.budgetMs = 1_000 / TUNING.sim.tickHz;
  }

  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.samples[this.index] = durationMs;
    this.index = (this.index + 1) % this.samples.length;
    this.filled = Math.min(this.filled + 1, this.samples.length);
    this.ticks += 1;
    if (durationMs > this.budgetMs) {
      this.overBudgetTicks += 1;
    }
  }

  snapshot(): ServerTickSnapshot {
    const values = this.samples.slice(0, this.filled).sort((a, b) => a - b);
    const last = values[values.length - 1] ?? 0;
    return {
      loopHz: TUNING.sim.tickHz,
      tickBudgetMs: Math.round(this.budgetMs * 100) / 100,
      ticks: this.ticks,
      p95TickMs:
        Math.round((values[Math.floor((values.length - 1) * 0.95)] ?? 0) * 100) /
        100,
      maxTickMs: Math.round(last * 100) / 100,
      overBudgetTicks: this.overBudgetTicks,
    };
  }
}
