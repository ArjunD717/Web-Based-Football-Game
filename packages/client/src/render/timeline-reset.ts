// packages/client/src/render/timeline-reset.ts

export type TimelineDirection = -1 | 0 | 1;

const DIRECTION_EPSILON_SECONDS = 1e-4;

export function timelineDirection(
  previousElapsedSeconds: number,
  currentElapsedSeconds: number,
): TimelineDirection {
  const delta = currentElapsedSeconds - previousElapsedSeconds;
  if (delta > DIRECTION_EPSILON_SECONDS) {
    return 1;
  }
  if (delta < -DIRECTION_EPSILON_SECONDS) {
    return -1;
  }
  return 0;
}

/**
 * Replay can run backward, seek, or loop. A direction change or a large
 * timeline jump invalidates both the accumulated history and proxy matrices.
 * Paused frames (direction 0) retain the last real direction so resuming
 * forward playback does not force a reset.
 */
export function shouldResetTimeline(
  previousDirection: TimelineDirection,
  nextDirection: TimelineDirection,
  elapsedDeltaSeconds: number,
  jumpThresholdSeconds: number,
): boolean {
  if (
    previousDirection !== 0 &&
    nextDirection !== 0 &&
    previousDirection !== nextDirection
  ) {
    return true;
  }
  return (
    Number.isFinite(elapsedDeltaSeconds) &&
    Math.abs(elapsedDeltaSeconds) > jumpThresholdSeconds
  );
}
