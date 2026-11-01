// packages/client/src/match/switch-target.ts
import type { RenderPlayer } from "../render/view";

/**
 * Mirror the server's distance-ordered switch cycle for presentation only.
 * The preview must never block a switch; the server remains authoritative.
 */
export function findNextSwitchTarget(
  players: readonly RenderPlayer[],
  ballX: number,
  ballY: number,
  includeGoalkeeper: boolean,
): RenderPlayer | null {
  const active = players.find((player) => player.controlled);
  if (active === undefined) {
    return null;
  }
  const candidates = players
    .filter(
      (player) =>
        !player.sentOff &&
        (includeGoalkeeper || !player.goalkeeper),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - ballX, a.y - ballY) -
        Math.hypot(b.x - ballX, b.y - ballY),
    );
  if (candidates.length <= 1) {
    return null;
  }
  const index = candidates.findIndex((player) => player.id === active.id);
  if (index < 0) {
    return null;
  }
  const next = candidates[(index + 1) % candidates.length];
  return next === undefined || next.id === active.id ? null : next;
}
