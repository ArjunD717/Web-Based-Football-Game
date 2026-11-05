// packages/server/src/dev-network.test.ts
import { describe, expect, it } from "vitest";
import {
  devNetworkDelayMs,
  devNetworkDrops,
  devNetworkEnabled,
} from "./dev-network";

const disabled = { latencyMs: 0, jitterMs: 0, lossPct: 0 };

describe("dev network conditions", () => {
  it("is inactive at the defaults", () => {
    expect(devNetworkEnabled(disabled)).toBe(false);
    expect(devNetworkDelayMs(disabled)).toBe(0);
    expect(devNetworkDrops(disabled, () => 0)).toBe(false);
  });

  it("applies symmetric jitter without negative delays", () => {
    const settings = { latencyMs: 100, jitterMs: 20, lossPct: 0 };
    expect(devNetworkDelayMs(settings, () => 0)).toBe(80);
    expect(devNetworkDelayMs(settings, () => 0.5)).toBe(100);
    expect(devNetworkDelayMs(settings, () => 1)).toBe(120);
    expect(devNetworkDelayMs({ ...settings, latencyMs: 5 }, () => 1)).toBe(25);
    expect(
      devNetworkDelayMs({ ...settings, latencyMs: 0, jitterMs: 20 }, () => 0),
    ).toBe(0);
  });

  it("drops snapshots below the configured percentage", () => {
    const settings = { latencyMs: 0, jitterMs: 0, lossPct: 10 };
    expect(devNetworkDrops(settings, () => 0.09)).toBe(true);
    expect(devNetworkDrops(settings, () => 0.1)).toBe(false);
  });
});
