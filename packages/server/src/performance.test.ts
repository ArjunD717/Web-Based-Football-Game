// packages/server/src/performance.test.ts
import { describe, expect, it } from "vitest";
import { ServerTickMetrics } from "./performance";

describe("server tick metrics", () => {
  it("reports a bounded rolling p95 and budget overruns", () => {
    const metrics = new ServerTickMetrics(4);
    for (const value of [1, 2, 3, 40, 5]) {
      metrics.record(value);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.ticks).toBe(5);
    expect(snapshot.overBudgetTicks).toBe(1);
    expect(snapshot.maxTickMs).toBe(40);
    expect(snapshot.p95TickMs).toBe(5);
    expect(snapshot.loopHz).toBe(60);
  });

  it("ignores invalid samples and handles an empty window", () => {
    const metrics = new ServerTickMetrics(3);
    metrics.record(-1);
    metrics.record(Number.NaN);
    expect(metrics.snapshot()).toMatchObject({
      ticks: 0,
      p95TickMs: 0,
      maxTickMs: 0,
      overBudgetTicks: 0,
    });
  });
});
