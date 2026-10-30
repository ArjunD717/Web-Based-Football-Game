// packages/sim/src/rules/injuries.ts

import { TUNING, clamp } from "@fb/shared";
import { eventRng } from "../random";
import type { PlayerState } from "../types";

export interface InjuryAssessment {
  readonly injured: boolean;
  readonly canPlayOn: boolean;
  readonly severity: number;
  readonly risk: number;
}

/**
 * Turn a tackle contact into a deterministic injury roll. The contact model
 * already contains the dangerous-force signal; proneness is the small
 * player-specific multiplier. A high-force contact can still be a minor knock,
 * which keeps the play-on choice meaningful.
 */
export function assessInjury(
  seed: number,
  tick: number,
  player: PlayerState,
  contactSeverity: number,
  fromBehind: boolean,
): InjuryAssessment {
  const tuning = TUNING.injury;
  const proneness = clamp(
    (player.attributes.injuryProneness ?? 50) / 99,
    0,
    1,
  );
  const severity = clamp(contactSeverity, 0, 1.5);
  const behindRisk = fromBehind
    ? TUNING.injury.pronenessRisk * TUNING.injury.behindRiskFactor
    : 0;
  const risk = clamp(
    tuning.baseRisk +
      severity * tuning.severityRisk +
      proneness * tuning.pronenessRisk +
      behindRisk,
    0,
    0.9,
  );
  const rng = eventRng(
    seed,
    tick,
    player.number + (player.team === "home" ? 0 : 10_000) + 0x1f2e3d4c,
  );
  if (!rng.chance(risk)) {
    return { injured: false, canPlayOn: true, severity, risk };
  }
  const canPlayOn =
    severity < tuning.seriousThreshold ||
    rng.chance(tuning.playOnChance);
  return { injured: true, canPlayOn, severity, risk };
}
