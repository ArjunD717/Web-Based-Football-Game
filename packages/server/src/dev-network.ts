// packages/server/src/dev-network.ts

import type { DevNetworkConfig } from "./config";

/** True when any artificial condition is active. */
export function devNetworkEnabled(settings: DevNetworkConfig): boolean {
  return (
    settings.latencyMs > 0 ||
    settings.jitterMs > 0 ||
    settings.lossPct > 0
  );
}

/**
 * One-way delivery delay. Jitter is symmetric around the configured latency
 * and is clamped at zero so a timer never schedules in the past.
 */
export function devNetworkDelayMs(
  settings: DevNetworkConfig,
  random: () => number = Math.random,
): number {
  if (!devNetworkEnabled(settings)) {
    return 0;
  }
  const jitter = (random() * 2 - 1) * settings.jitterMs;
  return Math.max(0, settings.latencyMs + jitter);
}

/** Drop test for a binary state message; text control messages stay reliable. */
export function devNetworkDrops(
  settings: DevNetworkConfig,
  random: () => number = Math.random,
): boolean {
  return settings.lossPct > 0 && random() * 100 < settings.lossPct;
}
