// packages/sim/src/rules/fouls.test.ts
import { describe, expect, it } from "vitest";
import { createMatch } from "../match";
import {
  assessTackle,
  findTackleVictim,
  isDenyingGoalscoringOpportunity,
  type TackleContact,
} from "./fouls";

const cleanContact: TackleContact = {
  tick: 1,
  tacklerTeam: "away",
  tacklerId: "away-4",
  victimId: "home-10",
  approachAngleRad: 0,
  relativeSpeedMps: 0,
  ballWonFirst: true,
  fromBehind: false,
  contactPoint: "ball",
  tacklerAggression: 40,
  tacklerTackle: 80,
  victimBalance: 80,
  sliding: false,
  dogso: false,
};

describe("tackle severity model", () => {
  it("does not punish a clean, slow ball-first tackle", () => {
    const assessment = assessTackle(cleanContact, "standard");
    expect(assessment.foul).toBe(false);
    expect(assessment.card).toBeNull();
  });

  it("punishes a fast sliding tackle from behind that misses the ball", () => {
    const assessment = assessTackle(
      {
        ...cleanContact,
        relativeSpeedMps: 12,
        ballWonFirst: false,
        fromBehind: true,
        sliding: true,
        contactPoint: "lowerLeg",
        tacklerAggression: 90,
        tacklerTackle: 30,
        victimBalance: 30,
      },
      "standard",
    );
    expect(assessment.foul).toBe(true);
    expect(assessment.card).toBe("red");
    expect(assessment.reason).toBe("excessive");
  });

  it("keeps a sliding challenge from behind careless even after a clean win", () => {
    for (const strictness of ["lenient", "standard", "strict"] as const) {
      const assessment = assessTackle(
        {
          ...cleanContact,
          fromBehind: true,
          sliding: true,
          relativeSpeedMps: 2,
        },
        strictness,
      );
      expect(assessment.foul).toBe(true);
    }
  });

  it("uses strictness as a tolerance offset", () => {
    const contact: TackleContact = {
      ...cleanContact,
      ballWonFirst: false,
      relativeSpeedMps: 2,
      tacklerAggression: 50,
      tacklerTackle: 50,
      victimBalance: 50,
    };
    const lenient = assessTackle(contact, "lenient");
    const standard = assessTackle(contact, "standard");
    const strict = assessTackle(contact, "strict");
    expect(lenient.severity).toBeLessThan(standard.severity);
    expect(standard.severity).toBeLessThan(strict.severity);
    expect(strict.severity - lenient.severity).toBeCloseTo(0.16, 8);
  });

  it("turns DOGSO into a straight red once the contact is a foul", () => {
    const assessment = assessTackle(
      {
        ...cleanContact,
        ballWonFirst: false,
        relativeSpeedMps: 6,
        fromBehind: true,
        sliding: true,
        contactPoint: "lowerLeg",
        dogso: true,
      },
      "standard",
    );
    expect(assessment.foul).toBe(true);
    expect(assessment.card).toBe("red");
    expect(assessment.reason).toBe("dogso");
  });
});

describe("findTackleVictim", () => {
  it("chooses the closest standing opponent in range", () => {
    const state = createMatch({ seed: 41 });
    const tackler = state.home.players[5]!;
    const opponents = state.away.players;
    for (const opponent of opponents) {
      opponent.x = tackler.x + 10;
      opponent.y = tackler.y;
    }
    const near = opponents[6]!;
    near.x = tackler.x + 0.4;
    near.y = tackler.y;
    const sentOff = opponents[7]!;
    sentOff.x = tackler.x + 0.2;
    sentOff.y = tackler.y;
    sentOff.sentOff = true;
    const fallen = opponents[8]!;
    fallen.x = tackler.x + 0.3;
    fallen.y = tackler.y;
    fallen.state = "fall";

    expect(findTackleVictim(opponents, tackler)?.id).toBe(near.id);
  });

  it("returns null when no opponent is within contact range", () => {
    const state = createMatch({ seed: 42 });
    const tackler = state.home.players[5]!;
    for (const opponent of state.away.players) {
      opponent.x = tackler.x + 5;
      opponent.y = tackler.y;
    }
    expect(findTackleVictim(state.away.players, tackler)).toBeNull();
  });
});

describe("DOGSO geometry", () => {
  function setup(seed: number) {
    const state = createMatch({ seed });
    const victim = state.home.players.find((player) => player.role === "ST")!;
    const attackers = state.away;
    const goalX =
      state.home.attackDirection === 1 ? state.pitch.lengthM : 0;
    victim.x = goalX - state.home.attackDirection * 8;
    victim.y = state.pitch.centreY;
    for (const defender of attackers.players) {
      defender.x = victim.x - state.home.attackDirection * 20;
      defender.y = state.pitch.centreY + 25;
    }
    const goalkeeper = attackers.players.find(
      (player) => player.role === "GK",
    )!;
    goalkeeper.x = goalX - state.home.attackDirection * 2;
    goalkeeper.y = state.pitch.centreY;
    return { state, victim, attackers, goalX };
  }

  it("denies an obvious central opportunity with only the keeper back", () => {
    const { state, victim } = setup(43);
    expect(isDenyingGoalscoringOpportunity(state, victim)).toBe(true);
  });

  it("does not call DOGSO when a second defender is goal-side", () => {
    const { state, victim, attackers, goalX } = setup(44);
    const extra = attackers.players.find((player) => player.role === "CB")!;
    extra.x = goalX - state.home.attackDirection * 4;
    extra.y = state.pitch.centreY;
    expect(isDenyingGoalscoringOpportunity(state, victim)).toBe(false);
  });

  it("does not call DOGSO for a wide or distant runner", () => {
    const { state, victim } = setup(45);
    victim.y = state.pitch.centreY + 20;
    expect(isDenyingGoalscoringOpportunity(state, victim)).toBe(false);

    victim.y = state.pitch.centreY;
    victim.x =
      state.home.attackDirection === 1
        ? 10
        : state.pitch.lengthM - 10;
    expect(isDenyingGoalscoringOpportunity(state, victim)).toBe(false);
  });
});
