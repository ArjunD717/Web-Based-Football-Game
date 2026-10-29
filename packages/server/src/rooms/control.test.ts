// packages/server/src/rooms/control.test.ts
import { CONTROL_BUTTONS } from "@fb/shared";
import { createMatch, startFreeKick } from "@fb/sim";
import { describe, expect, it } from "vitest";
import {
  controlSnapshotIndices,
  createTeamControlRuntime,
  markControlReconnected,
  prepareTeamControl,
  updateControlInput,
} from "./control";

const DT = 1 / 60;

describe("control selection", () => {
  it("does not hand control to a held free-kick wall player", () => {
    const state = createMatch({ seed: 106 });
    startFreeKick(
      state,
      "home",
      "directFreeKick",
      state.pitch.lengthM - 22,
      state.pitch.centreY,
    );
    const wall = new Set(state.referee.setPiece?.wallPlayerIds ?? []);
    expect(wall.size).toBeGreaterThan(0);
    state.referee.phase = "live";
    state.referee.restart = null;

    const away = createTeamControlRuntime();
    prepareTeamControl(state, "away", away, DT);

    expect(away.activePlayerId).not.toBeNull();
    expect(wall.has(away.activePlayerId!)).toBe(false);
  });

  it("selects one controlled player per side and sets movement targets", () => {
    const state = createMatch({ seed: 101 });
    const home = createTeamControlRuntime();
    const away = createTeamControlRuntime();

    prepareTeamControl(state, "home", home, DT);
    prepareTeamControl(state, "away", away, DT);

    const homeActive = state.home.players.filter(
      (player) => player.isUserControlled,
    );
    const awayActive = state.away.players.filter(
      (player) => player.isUserControlled,
    );
    expect(homeActive).toHaveLength(1);
    expect(awayActive).toHaveLength(1);
    expect(home.activePlayerId).toBe(homeActive[0]?.id);

    expect(
      updateControlInput(
        home,
        {
          seq: 1,
          moveX: 1,
          moveY: 0,
          buttons: CONTROL_BUTTONS.SPRINT,
          chargePower: 0,
        },
        Date.now(),
      ),
    ).toBe(true);
    prepareTeamControl(state, "home", home, DT);
    expect(homeActive[0]!.targetX).toBeGreaterThan(homeActive[0]!.x);
    expect(homeActive[0]!.targetSpeed).toBeGreaterThan(1);

    const indices = controlSnapshotIndices(state, home, away);
    expect(indices.home).toBeGreaterThanOrEqual(0);
    expect(indices.home).toBeLessThan(11);
    expect(indices.away).toBeGreaterThanOrEqual(11);
    expect(indices.away).toBeLessThan(22);
  });

  it("cycles control on a switch press and respects the cooldown", () => {
    const state = createMatch({ seed: 102 });
    const home = createTeamControlRuntime();
    prepareTeamControl(state, "home", home, DT);
    const first = home.activePlayerId;

    updateControlInput(
      home,
      {
        seq: 1,
        moveX: 0,
        moveY: 0,
        buttons: CONTROL_BUTTONS.SWITCH,
        chargePower: 0,
      },
      Date.now(),
    );
    prepareTeamControl(state, "home", home, DT);
    const second = home.activePlayerId;
    expect(second).not.toBe(first);

    updateControlInput(
      home,
      {
        seq: 2,
        moveX: 0,
        moveY: 0,
        buttons: 0,
        chargePower: 0,
      },
      Date.now(),
    );
    prepareTeamControl(state, "home", home, DT);
    updateControlInput(
      home,
      {
        seq: 3,
        moveX: 0,
        moveY: 0,
        buttons: CONTROL_BUTTONS.SWITCH,
        chargePower: 0,
      },
      Date.now(),
    );
    prepareTeamControl(state, "home", home, DT);
    expect(home.activePlayerId).toBe(second);
  });

  it("ignores stale input and older sequences", () => {
    const state = createMatch({ seed: 103 });
    const home = createTeamControlRuntime();
    prepareTeamControl(state, "home", home, DT);
    expect(
      updateControlInput(
        home,
        {
          seq: 2,
          moveX: 1,
          moveY: 0,
          buttons: 0,
          chargePower: 0,
        },
        Date.now(),
      ),
    ).toBe(true);
    expect(
      updateControlInput(
        home,
        {
          seq: 1,
          moveX: -1,
          moveY: 0,
          buttons: 0,
          chargePower: 0,
        },
        Date.now(),
      ),
    ).toBe(false);

    home.lastInputAtMs = Date.now() - 10_000;
    prepareTeamControl(state, "home", home, DT);
    expect(home.input).not.toBeNull();
    expect(
      state.home.players.find((player) => player.isUserControlled)?.targetSpeed,
    ).toBe(0);

    markControlReconnected(home);
    expect(home.lastInputSeq).toBe(0);
    expect(home.previousButtons).toBe(0);
  });

  it("fires a charged shot on release", () => {
    const state = createMatch({ seed: 104 });
    state.referee.phase = "live";
    state.referee.restart = null;
    state.referee.setPiece = null;
    state.referee.timerSeconds = 0;
    const home = createTeamControlRuntime();
    prepareTeamControl(state, "home", home, DT);
    const active = state.home.players.find(
      (player) => player.isUserControlled,
    )!;
    state.ball.x = active.x + 0.3;
    state.ball.y = active.y;
    state.ball.z = 0.11;
    state.ball.vx = 0;
    state.ball.vy = 0;
    active.kickCooldown = 0;

    updateControlInput(
      home,
      {
        seq: 1,
        moveX: 1,
        moveY: 0,
        buttons: CONTROL_BUTTONS.SHOOT,
        chargePower: 0,
      },
      Date.now(),
    );
    prepareTeamControl(state, "home", home, DT);
    expect(home.shootCharge).toBeGreaterThan(0);

    updateControlInput(
      home,
      {
        seq: 2,
        moveX: 1,
        moveY: 0,
        buttons: 0,
        chargePower: 0.2,
      },
      Date.now(),
    );
    prepareTeamControl(state, "home", home, DT);
    expect(state.lastTouch?.playerId).toBe(active.id);
    expect(active.state).toBe("shoot");
    expect(
      Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz),
    ).toBeGreaterThan(1);
  });

  it("hands goalkeeper control to the human when the ball enters the box", () => {
    const state = createMatch({ seed: 105 });
    const home = createTeamControlRuntime();
    state.ball.x = 5;
    state.ball.y = state.pitch.centreY;
    state.ball.z = 0.11;
    prepareTeamControl(state, "home", home, DT);

    const active = state.home.players.find(
      (player) => player.isUserControlled,
    );
    expect(active?.role).toBe("GK");

    state.ball.x = state.pitch.centreX;
    state.ball.y = state.pitch.centreY;
    prepareTeamControl(state, "home", home, DT);
    expect(
      state.home.players.find((player) => player.isUserControlled)?.role,
    ).not.toBe("GK");
  });
});
