// packages/sim/src/ai/ai.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { hashMatchState } from "../hash";
import { createMatch } from "../match";
import {
  recordGoal,
  recordPossessionTick,
  recordShot,
  recordShotOnTarget,
} from "../stats";
import type { MatchRules, MatchState, PlayerState, TeamState } from "../types";
import { canReact } from "./brain";
import {
  analyseBall,
  offsideLineFor,
  planTeam,
} from "./context";
import { decideAndExecute } from "./decisions";
import { assignTeamTargets } from "./positioning";
import {
  difficultyProfile,
  isDefensiveRole,
  roleProfile,
} from "./profiles";

function liveMatch(
  seed = 1,
  rules: Partial<MatchRules> = {},
): MatchState {
  const state = createMatch({ seed, rules });
  state.referee.phase = "live";
  state.referee.setPiece = null;
  state.referee.restart = null;
  state.referee.offside = null;
  state.referee.timerSeconds = 0;
  return state;
}

function giveBallTo(state: MatchState, player: PlayerState): void {
  state.ball.x = player.x;
  state.ball.y = player.y;
  state.ball.z = TUNING.ball.radiusM;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
  state.ball.spinX = 0;
  state.ball.spinY = 0;
  state.ball.spinZ = 0;
  state.lastTouch = {
    team: player.team,
    playerId: player.id,
    playerNumber: player.number,
  };
}

function setTactics(
  team: TeamState,
  values: Partial<TeamState["tactics"]>,
): void {
  (team as unknown as { tactics: TeamState["tactics"] }).tactics = {
    ...team.tactics,
    ...values,
  };
}

function shootingScenario(seed: number): {
  state: MatchState;
  striker: PlayerState;
} {
  const state = liveMatch(seed);
  const striker = byRole(state.home, "ST");
  striker.x = state.pitch.lengthM - 16;
  striker.y = state.pitch.centreY;
  striker.facing = 0;
  giveBallTo(state, striker);
  for (const opponent of state.away.players) {
    if (opponent.role !== "GK") {
      opponent.x = 55;
    }
  }
  return { state, striker };
}

function byRole(team: TeamState, role: PlayerState["role"]): PlayerState {
  const player = team.players.find((candidate) => candidate.role === role);
  if (player === undefined) {
    throw new Error(`team ${team.side} has no ${role}`);
  }
  return player;
}

describe("role and difficulty profiles", () => {
  it("gives attacking roles more run-in-behind and defensive roles more cover", () => {
    expect(roleProfile("ST").runInBehind).toBeGreaterThan(
      roleProfile("CB").runInBehind,
    );
    expect(roleProfile("CB").cover).toBeGreaterThan(
      roleProfile("ST").cover,
    );
    expect(isDefensiveRole("CDM")).toBe(true);
    expect(isDefensiveRole("ST")).toBe(false);
  });

  it("makes higher difficulties react faster and aim better", () => {
    const beginner = difficultyProfile("beginner");
    const legendary = difficultyProfile("legendary");
    expect(legendary.reactionTicks).toBeLessThan(beginner.reactionTicks);
    expect(legendary.shotAimErrorM).toBeLessThan(beginner.shotAimErrorM);
    expect(legendary.pressAggression).toBeGreaterThan(
      beginner.pressAggression,
    );
  });

  it("gates reactions on the difficulty cadence", () => {
    const beginner = liveMatch(1, { aiDifficulty: "beginner" });
    const legendary = liveMatch(1, { aiDifficulty: "legendary" });
    const player = beginner.home.players[0]!;
    beginner.tick = 2;
    legendary.tick = 2;
    expect(canReact(beginner, player)).toBe(false);
    expect(canReact(legendary, player)).toBe(true);
  });
});

describe("team planning", () => {
  it("identifies attack, defence and loose-ball phases with assignments", () => {
    const state = liveMatch(7);
    const owner = byRole(state.home, "CM");
    owner.x = state.pitch.centreX + 2;
    owner.y = state.pitch.centreY;
    giveBallTo(state, owner);

    const ball = analyseBall(state);
    expect(ball.owner?.id).toBe(owner.id);

    const attack = planTeam(state, state.home, ball);
    expect(attack.phase).toBe("attack");
    expect(attack.owner?.id).toBe(owner.id);
    expect(attack.supportIds).toHaveLength(2);
    expect(attack.supportIds).not.toContain(owner.id);
    expect(attack.runnerIds.length).toBeGreaterThan(0);
    expect(attack.runnerIds).not.toContain(owner.id);
    expect(attack.overlapId).not.toBeNull();
    expect(attack.offsideLineX).toBe(offsideLineFor(state, state.home));

    const defence = planTeam(state, state.away, ball);
    expect(defence.phase).toBe("defend");
    expect(defence.presserId).not.toBeNull();
    expect(defence.coverId).not.toBeNull();

    state.ball.x = 4;
    state.ball.y = 4;
    state.lastTouch = null;
    const loose = planTeam(state, state.home, analyseBall(state));
    expect(loose.phase).toBe("loose");
    expect(loose.receiverId).toBeNull();
  });

  it("uses the authored defensive depth and high pressing instruction", () => {
    const deep = liveMatch(11);
    const shallow = liveMatch(11);
    const ballState = liveMatch(11);
    const owner = byRole(ballState.home, "CM");
    owner.x = ballState.pitch.centreX;
    owner.y = ballState.pitch.centreY;
    giveBallTo(ballState, owner);

    setTactics(deep.home, { defensiveDepth: 5 });
    setTactics(shallow.home, { defensiveDepth: 95 });
    expect(
      planTeam(shallow, shallow.home, analyseBall(ballState)).lineX,
    ).toBeGreaterThan(
      planTeam(deep, deep.home, analyseBall(ballState)).lineX,
    );

    const high = liveMatch(13);
    const low = liveMatch(13);
    setTactics(high.home, { pressIntensity: "high" });
    setTactics(low.home, { pressIntensity: "low" });
    const homePresser = byRole(high.home, "CM");
    for (const state of [high, low]) {
      const awayOwner = byRole(state.away, "CM");
      awayOwner.x = 60;
      awayOwner.y = state.pitch.centreY;
      giveBallTo(state, awayOwner);
      const presser = state.home.players.find(
        (player) => player.id === homePresser.id,
      )!;
      for (const player of state.home.players) {
        if (player.role !== "GK" && player.id !== presser.id) {
          player.x = 30;
        }
      }
      presser.x = 51;
      presser.y = state.pitch.centreY;
    }

    const highPlan = planTeam(high, high.home, analyseBall(high));
    const lowPlan = planTeam(low, low.home, analyseBall(low));
    expect(highPlan.presserId).toBe(homePresser.id);
    expect(highPlan.secondPresserId).not.toBeNull();
    expect(lowPlan.secondPresserId).toBeNull();
  });
});

describe("on-ball decisions", () => {
  it("keeps a set-piece taker at the restart spot", () => {
    const state = liveMatch(17);
    const taker = byRole(state.home, "CM");
    taker.x = state.pitch.lengthM - 0.6;
    taker.y = 0.6;
    state.ball.x = state.pitch.lengthM;
    state.ball.y = 0;
    state.referee.setPiece = {
      type: "corner",
      side: "home",
      takerId: taker.id,
      firstTouchId: null,
      otherTouched: false,
      wallPlayerIds: [],
      penalty: null,
    };
    const plan = planTeam(state, state.home, analyseBall(state));
    assignTeamTargets(state, state.home, plan);
    expect(taker.targetX).toBeCloseTo(taker.x, 10);
    expect(taker.targetY).toBeCloseTo(taker.y, 10);
    expect(taker.targetSpeed).toBe(0);

    const runner = state.home.players.find(
      (player) => player.id === plan.runnerIds[0],
    );
    expect(runner).toBeDefined();
    expect(runner!.targetSpeed).toBeGreaterThan(0);
  });

  it("places corner runners at the near and far posts", () => {
    const state = liveMatch(19);
    const taker = byRole(state.home, "CM");
    taker.x = state.pitch.lengthM - 0.6;
    taker.y = 0.6;
    state.ball.x = state.pitch.lengthM;
    state.ball.y = 0;
    state.referee.setPiece = {
      type: "corner",
      side: "home",
      takerId: taker.id,
      firstTouchId: null,
      otherTouched: false,
      wallPlayerIds: [],
      penalty: null,
    };
    const plan = planTeam(state, state.home, analyseBall(state));
    assignTeamTargets(state, state.home, plan);
    const nearRunner = state.home.players.find(
      (player) => player.id === plan.runnerIds[0],
    )!;
    const farRunner = state.home.players.find(
      (player) => player.id === plan.runnerIds[1],
    )!;
    expect(nearRunner.targetY).toBeLessThan(state.pitch.centreY);
    expect(farRunner.targetY).toBeGreaterThan(state.pitch.centreY);
    expect(nearRunner.targetX).toBeLessThan(state.pitch.lengthM);
    expect(farRunner.targetX).toBeLessThan(state.pitch.lengthM);
  });

  it("holds every player for a penalty and puts the keeper on the line", () => {
    const state = liveMatch(23);
    const taker = byRole(state.home, "ST");
    const keeper = byRole(state.away, "GK");
    state.ball.x = state.pitch.lengthM - state.pitch.penaltySpotDistanceM;
    state.ball.y = state.pitch.centreY;
    state.referee.setPiece = {
      type: "penalty",
      side: "home",
      takerId: taker.id,
      firstTouchId: null,
      otherTouched: false,
      wallPlayerIds: [],
      penalty: {
        side: "home",
        takerId: taker.id,
        goalkeeperId: keeper.id,
        kicked: false,
        encroachment: "none",
      },
    };
    assignTeamTargets(
      state,
      state.home,
      planTeam(state, state.home, analyseBall(state)),
    );
    assignTeamTargets(
      state,
      state.away,
      planTeam(state, state.away, analyseBall(state)),
    );
    for (const player of state.home.players) {
      expect(player.targetSpeed).toBe(0);
    }
    expect(keeper.targetX).toBeGreaterThan(
      state.pitch.lengthM - TUNING.referee.penaltyGoalkeeperLineOffsetM - 1,
    );
    expect(keeper.targetX).toBeLessThan(state.pitch.lengthM);
    expect(keeper.targetY).toBeCloseTo(state.pitch.centreY, 6);
  });

  it("sweeps a loose ball outside the penalty area", () => {
    const state = liveMatch(29);
    const keeper = byRole(state.home, "GK");
    state.ball.x = 20;
    state.ball.y = state.pitch.centreY;
    state.ball.z = TUNING.ball.radiusM;
    state.ball.vx = 0;
    state.ball.vy = 0;
    for (const player of state.home.players) {
      if (player.role !== "GK") {
        player.x = 45;
      }
    }
    for (const player of state.away.players) {
      player.x = 85;
    }
    assignTeamTargets(
      state,
      state.home,
      planTeam(state, state.home, analyseBall(state)),
    );
    expect(keeper.targetX).toBeGreaterThan(10);
    expect(keeper.targetX).toBeLessThanOrEqual(
      TUNING.ai.keeperSweepMaxM,
    );
  });

  it("executes valid on-ball actions and can shoot from the box", () => {
    let shots = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state, striker } = shootingScenario(seed);
      expect(decideAndExecute(state, striker)).toBe(true);
      expect(["pass", "shoot", "dribble", "clear"]).toContain(striker.state);
      if (striker.state === "shoot") {
        shots += 1;
      }
    }
    expect(shots).toBeGreaterThan(0);
  });

  it("makes identical decisions from identical state", () => {
    const first = shootingScenario(101);
    const second = shootingScenario(101);
    expect(decideAndExecute(first.state, first.striker)).toBe(true);
    expect(decideAndExecute(second.state, second.striker)).toBe(true);
    expect(hashMatchState(first.state)).toBe(hashMatchState(second.state));
  });
});

describe("match stats", () => {
  it("records shots, goals and possession without double counting", () => {
    const state = liveMatch(31);
    const player = state.home.players[0]!;
    state.ball.x = player.x;
    state.ball.y = player.y;
    recordShot(state, "home");
    recordShotOnTarget(state, "home");
    recordGoal(state, "home", true);
    expect(state.stats.home.shots).toBe(1);
    expect(state.stats.home.goals).toBe(1);
    expect(state.stats.home.shotsOnTarget).toBe(1);
    recordGoal(state, "home");
    expect(state.stats.home.goals).toBe(2);
    expect(state.stats.home.shotsOnTarget).toBe(2);
    recordPossessionTick(state);
    expect(state.stats.home.possessionTicks).toBe(1);
    expect(state.stats.away.possessionTicks).toBe(0);
  });
});
