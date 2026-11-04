// packages/client/src/render/goal-effects.ts

/**
 * Presentation-only goal-moment envelopes. Kept pure so the net and crowd
 * animation timing can be tuned and tested without a WebGL context.
 */
export function netRippleStrength(
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  if (
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(durationSeconds) ||
    elapsedSeconds <= 0 ||
    durationSeconds <= 0 ||
    elapsedSeconds >= durationSeconds
  ) {
    return 0;
  }
  const attack = 1 - Math.exp(-32 * elapsedSeconds);
  const decay = Math.exp(-4.8 * elapsedSeconds);
  const tail = Math.max(0, 1 - elapsedSeconds / durationSeconds);
  return attack * decay * Math.min(1, tail * 2);
}

export function crowdCelebrationStrength(
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  if (
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(durationSeconds) ||
    elapsedSeconds < 0 ||
    durationSeconds <= 0 ||
    elapsedSeconds >= durationSeconds
  ) {
    return 0;
  }
  const progress = elapsedSeconds / durationSeconds;
  const pulse = 0.72 + 0.28 * Math.cos(elapsedSeconds * 22);
  return Math.pow(1 - progress, 1.4) * pulse;
}
