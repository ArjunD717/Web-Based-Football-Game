// packages/sim/src/ai/profiles.ts

import { TUNING } from "@fb/shared";
import type { AiDifficulty, PlayerRole } from "../types";

export interface DifficultyProfile {
  readonly reactionTicks: number;
  readonly decisionNoise: number;
  readonly passErrorM: number;
  readonly shotAimErrorM: number;
  readonly pressAggression: number;
  readonly tackleBias: number;
  readonly throughBias: number;
  readonly offsideDiscipline: number;
  readonly supportSpeedFactor: number;
}

export interface RoleProfile {
  readonly attackShift: number;
  readonly defendShift: number;
  readonly runInBehind: number;
  readonly cover: number;
}

export function difficultyProfile(
  difficulty: AiDifficulty,
): DifficultyProfile {
  return TUNING.ai.difficulty[difficulty];
}

export function roleProfile(role: PlayerRole): RoleProfile {
  return TUNING.ai.roles[role];
}

export function isDefensiveRole(role: PlayerRole): boolean {
  return role === "RB" || role === "CB" || role === "LB" || role === "CDM";
}

export function isWideRole(role: PlayerRole): boolean {
  return (
    role === "RB" ||
    role === "LB" ||
    role === "RM" ||
    role === "LM" ||
    role === "RW" ||
    role === "LW"
  );
}
