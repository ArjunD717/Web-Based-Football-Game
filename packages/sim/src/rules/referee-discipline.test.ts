// packages/sim/src/rules/referee-discipline.test.ts
import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import type { MatchState, PlayerState } from "../types";
import {
  advanceReferee,
  beginKick,
  commitTackleFoul,
  evaluateBoundary,
  evaluateHandball,
  registerTouch,
  startThrowIn,
  startPenalty,
} from "./referee";

function allPlayers(state: MatchState): PlayerState[] {
  return [...state.home.players, ...state.away.players];
}

function makeLive(state: MatchState): void {
  state.referee.phase = "live";
  state.referee.restart = null;
  state.referee.timerSeconds = 0;
  state.referee.setPiece = null;
  state.referee.pendingFoul = null;
}

function putBall(state: MatchState, x: number, y: number): void {
  state.ball.x = x;
  state.ball.y = y;
  state.ball.z = TUNING.ball.radiusM;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.vz = 0;
}

function contact(
  state: MatchState,
  team: "home" | "away",
  player: PlayerState,
) {
  return {
    team,
    playerId: player.id,
    playerNumber: player.number,
    ballHeightM: 1,
    relativeSpeedMps: 5,
    contactX: state.ball.x,
    contactY: state.ball.y,
  };
}

function cardSetup(seed: number) {
  const state = createMatch({ seed });
  makeLive(state);
  const home = state.home;
  const away = state.away;
  const victim = home.players.find((player) => player.role === "ST")!;
  const tackler = away.players.find((player) => player.role === "CB")!;
  const goalX =
    home.attackDirection === 1 ? state.pitch.lengthM : 0;
  victim.x = goalX - home.attackDirection * 30;
  victim.y = state.pitch.centreY;
  victim.facing = Math.atan2(0, home.attackDirection);
  victim.vx = 0;
  victim.vy = 0;
  // Keep two defenders goal-side so the challenge is not DOGSO.
  const goalSide = away.players
    .filter((player) => player.role === "GK" || player === tackler)
    .slice(0, 1);
  for (const defender of away.players) {
    const isGoalSide = playerGoalSide(
      defender,
      victim,
      goalX,
      home.attackDirection,
    );
    if (defender !== tackler && !isGoalSide && goalSide.length < 2) {
      defender.x = goalX - home.attackDirection * 6;
      defender.y = state.pitch.centreY + 8;
      goalSide.push(defender);
    }
  }
  const keeper = away.players.find((player) => player.role === "GK")!;
  keeper.x = goalX - home.attackDirection * 2;
  keeper.y = state.pitch.centreY;

  tackler.x = victim.x + home.attackDirection * 0.5;
  tackler.y = victim.y;
  tackler.facing = Math.atan2(0, -home.attackDirection);
  tackler.vx = -home.attackDirection * 12;
  tackler.vy = 0;
  tackler.state = "idle";
  putBall(state, state.pitch.centreX, state.pitch.centreY);
  return { state, victim, tackler };
}

function playerGoalSide(
  defender: PlayerState,
  victim: PlayerState,
  goalX: number,
  direction: 1 | -1,
): boolean {
  return direction === 1
    ? defender.x > victim.x && defender.x < goalX
    : defender.x < victim.x && defender.x > goalX;
}

describe("foul and card consequences", () => {
  it("sends off a second yellow and records the red-card event", () => {
    const { state, victim, tackler } = cardSetup(51);
    tackler.yellowCards = 1;
    expect(commitTackleFoul(state, tackler, victim, false)).toBe(true);

    expect(tackler.sentOff).toBe(true);
    expect(tackler.yellowCards).toBe(2);
    expect(state.referee.lastEvent?.type).toBe("redCard");
    expect(state.referee.setPiece?.type).toBe("directFreeKick");
    expect(state.referee.setPiece?.side).toBe("home");
  });

  it("stops play for a reckless tackle when no advantage is available", () => {
    const { state, victim, tackler } = cardSetup(52);
    for (const player of state.home.players) {
      if (player !== victim) {
        player.x = 90;
        player.y = 10;
      }
    }
    putBall(state, 5, 5);
    expect(commitTackleFoul(state, tackler, victim, false)).toBe(true);
    expect(state.referee.setPiece?.type).toBe("directFreeKick");
    expect(state.referee.pendingFoul).toBeNull();
  });

  it("plays advantage and returns to the foul when no progress is made", () => {
    const { state, victim, tackler } = cardSetup(53);
    const teammate = state.home.players.find(
      (player) => player.id !== victim.id && player.role === "CM",
    )!;
    teammate.x = victim.x + 0.5;
    teammate.y = victim.y;
    putBall(state, teammate.x, teammate.y);
    // A clean ball-first slide from behind is careless but not a card.
    tackler.state = "slide";
    tackler.x = victim.x - state.home.attackDirection * 0.4;
    tackler.facing = Math.atan2(0, state.home.attackDirection);
    tackler.vx = state.home.attackDirection * 2;
    tackler.vy = 0;

    expect(commitTackleFoul(state, tackler, victim, true)).toBe(true);
    expect(state.referee.pendingFoul).not.toBeNull();
    expect(state.referee.setPiece?.type).not.toBe("directFreeKick");

    const pending = state.referee.pendingFoul!;
    state.tick = pending.expiresTick;
    expect(advanceReferee(state, 1 / TUNING.sim.tickHz)).toBe(false);
    expect(state.referee.pendingFoul).toBeNull();
    expect(state.referee.setPiece).toMatchObject({
      type: "directFreeKick",
      side: "home",
    });
  });
});

describe("offside involvement", () => {
  it("awards an indirect free kick when a flagged player receives the pass", () => {
    const state = createMatch({ seed: 54 });
    makeLive(state);
    const kicker = state.home.players.find((player) => player.role === "CM")!;
    const striker = state.home.players.find((player) => player.role === "ST")!;
    const defenders = state.away.players;
    kicker.x = state.pitch.centreX - 5;
    kicker.y = state.pitch.centreY;
    striker.x = state.pitch.centreX + 15;
    striker.y = state.pitch.centreY;
    putBall(state, kicker.x, kicker.y);
    const line = state.pitch.centreX + 2;
    for (const defender of defenders) {
      defender.x = line;
      defender.y = state.pitch.centreY - 20 + defender.number;
    }
    state.away.players.find((player) => player.role === "GK")!.x =
      state.pitch.lengthM - 2;

    expect(beginKick(state, kicker, "pass")).toBe(true);
    expect(state.referee.offside?.playerIds).toContain(striker.id);
    putBall(state, striker.x, striker.y);
    registerTouch(state, contact(state, "home", striker));

    expect(state.referee.setPiece).toMatchObject({
      type: "indirectFreeKick",
      side: "away",
    });
    expect(state.referee.lastEvent?.type).toBe("offside");
  });

  it("does not capture offside from the throw-in taker's first touch", () => {
    const state = createMatch({ seed: 55 });
    startThrowIn(state, "home", state.pitch.centreX, 0);
    const taker = state.home.players.find(
      (player) => player.id === state.referee.setPiece?.takerId,
    )!;
    state.referee.phase = "live";
    state.referee.restart = null;
    expect(beginKick(state, taker, "pass")).toBe(true);
    expect(state.referee.offside).toBeNull();
  });
});

describe("penalty kick outcomes", () => {
  function penaltyState(seed: number) {
    const state = createMatch({ seed });
    startPenalty(state, "home");
    const setPiece = state.referee.setPiece!;
    state.referee.phase = "live";
    state.referee.restart = null;
    return { state, setPiece, taker: allPlayers(state).find(
      (player) => player.id === setPiece.penalty!.takerId,
    )! };
  }

  it("scores a clean penalty", () => {
    const { state, taker } = penaltyState(56);
    expect(beginKick(state, taker, "shot")).toBe(true);
    putBall(state, state.pitch.lengthM + 0.2, state.pitch.centreY);
    evaluateBoundary(state);
    expect(state.referee.scoreHome).toBe(1);
    expect(state.referee.restart?.type).toBe("kickoff");
  });

  it("retakes the penalty when a defender encroaches", () => {
    const { state, taker } = penaltyState(57);
    const defender = state.away.players.find(
      (player) => player.role === "CB",
    )!;
    defender.x = state.pitch.lengthM - 8;
    defender.y = state.pitch.centreY;
    expect(beginKick(state, taker, "shot")).toBe(true);
    expect(state.referee.setPiece?.penalty?.encroachment).toBe("defender");
    putBall(state, state.pitch.lengthM + 0.2, state.pitch.centreY);
    evaluateBoundary(state);
    expect(state.referee.scoreHome).toBe(0);
    expect(state.referee.setPiece?.type).toBe("penalty");
    expect(state.referee.setPiece?.penalty?.kicked).toBe(false);
  });

  it("awards an indirect free kick when an attacker encroaches", () => {
    const { state, taker } = penaltyState(58);
    const attacker = state.home.players.find(
      (player) => player.role !== "GK" && player.id !== taker.id,
    )!;
    attacker.x = state.pitch.lengthM - 8;
    attacker.y = state.pitch.centreY;
    expect(beginKick(state, taker, "shot")).toBe(true);
    expect(state.referee.setPiece?.penalty?.encroachment).toBe("attacker");
    putBall(state, state.pitch.lengthM + 0.2, state.pitch.centreY);
    evaluateBoundary(state);
    expect(state.referee.scoreHome).toBe(0);
    expect(state.referee.setPiece?.type).toBe("indirectFreeKick");
    expect(state.referee.setPiece?.side).toBe("away");
  });

  it("awards an indirect free kick for a penalty double touch", () => {
    const { state, taker } = penaltyState(59);
    expect(beginKick(state, taker, "shot")).toBe(true);
    expect(beginKick(state, taker, "shot")).toBe(false);
    expect(state.referee.setPiece).toMatchObject({
      type: "indirectFreeKick",
      side: "away",
    });
    expect(state.referee.lastEvent?.type).toBe("foul");
  });
});

describe("handball consequences", () => {
  it("awards a penalty for a defender's arm in the box", () => {
    const state = createMatch({ seed: 60 });
    makeLive(state);
    const defender = state.away.players.find(
      (player) => player.role === "CB",
    )!;
    defender.x = state.pitch.lengthM - 8;
    defender.y = state.pitch.centreY;
    putBall(state, defender.x, defender.y);
    const handled = evaluateHandball(state, {
      ...contact(state, "away", defender),
      ballHeightM: 1.45,
      relativeSpeedMps: 8,
    });
    expect(handled).toBe(true);
    expect(state.referee.setPiece).toMatchObject({
      type: "penalty",
      side: "home",
    });
    expect(state.referee.lastEvent?.type).toBe("penalty");
  });
});
