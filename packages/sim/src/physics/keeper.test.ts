// packages/sim/src/physics/keeper.test.ts

import { TUNING } from "@fb/shared";
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import { resolveGoalkeeperSave } from "./keeper";

describe("goalkeeper save window", () => {
  it("starts a directional dive for a shot inside the keeper's reach", () => {
    const state = createMatch({ seed: 7 });
    const goal = state.pitch.awayGoal;
    const keeper = state.away.players.find((player) => player.role === "GK");
    expect(keeper).toBeDefined();
    if (keeper === undefined) {
      return;
    }

    state.referee.phase = "live";
    state.ball.x = goal.lineX - 2;
    state.ball.y = goal.centreY + 0.8;
    state.ball.z = TUNING.ball.radiusM;
    state.ball.vx = 20;
    state.ball.vy = 0;
    state.ball.vz = 0;
    keeper.x = goal.lineX - 2.5;
    keeper.y = goal.centreY;
    keeper.facing = 0;
    keeper.actionTimer = 0;
    keeper.state = "idle";

    resolveGoalkeeperSave(state);

    expect(keeper.state).toBe("diveLeft");
    expect(keeper.actionTimer).toBe(TUNING.player.actionStateSeconds);
  });

  it("does not restart an active dive on the next shot tick", () => {
    const state = createMatch({ seed: 8 });
    const goal = state.pitch.awayGoal;
    const keeper = state.away.players.find((player) => player.role === "GK");
    if (keeper === undefined) {
      throw new Error("Expected an away goalkeeper");
    }

    state.referee.phase = "live";
    state.ball.x = goal.lineX - 2;
    state.ball.y = goal.centreY - 0.8;
    state.ball.z = TUNING.ball.radiusM;
    state.ball.vx = 20;
    state.ball.vy = 0;
    state.ball.vz = 0;
    keeper.x = goal.lineX - 2.5;
    keeper.y = goal.centreY;
    keeper.facing = 0;
    keeper.actionTimer = 0;
    keeper.state = "idle";

    resolveGoalkeeperSave(state);
    expect(keeper.state).toBe("diveRight");

    keeper.actionTimer = TUNING.player.actionStateSeconds / 2;
    resolveGoalkeeperSave(state);
    expect(keeper.actionTimer).toBe(
      TUNING.player.actionStateSeconds / 2,
    );
  });
});
