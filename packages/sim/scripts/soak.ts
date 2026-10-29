// packages/sim/scripts/soak.ts

import { createMatch, stepMatch } from "../src/index";
import { TUNING } from "@fb/shared";

const matches = Number(process.argv[2] ?? "1000");
const tickLimit =
  (TUNING.match.halfRealMinutes * 60 * 2 + 20) * TUNING.sim.tickHz;

interface Totals {
  goals: number;
  shots: number;
  fouls: number;
  offsides: number;
  yellows: number;
  reds: number;
  homeWins: number;
  draws: number;
  awayWins: number;
}

const totals: Totals = {
  goals: 0,
  shots: 0,
  fouls: 0,
  offsides: 0,
  yellows: 0,
  reds: 0,
  homeWins: 0,
  draws: 0,
  awayWins: 0,
};

const started = performance.now();
for (let index = 0; index < matches; index += 1) {
  const state = createMatch({ seed: 1000 + index });
  let ticks = 0;
  while (state.referee.phase !== "fullTime" && ticks < tickLimit) {
    stepMatch(state);
    ticks += 1;
  }
  totals.goals += state.referee.scoreHome + state.referee.scoreAway;
  totals.shots += state.stats.home.shots + state.stats.away.shots;
  totals.fouls += state.stats.home.fouls + state.stats.away.fouls;
  totals.offsides += state.stats.home.offsides + state.stats.away.offsides;
  totals.yellows +=
    state.stats.home.yellowCards + state.stats.away.yellowCards;
  totals.reds += state.stats.home.redCards + state.stats.away.redCards;
  if (state.referee.scoreHome > state.referee.scoreAway) {
    totals.homeWins += 1;
  } else if (state.referee.scoreHome < state.referee.scoreAway) {
    totals.awayWins += 1;
  } else {
    totals.draws += 1;
  }
  if (index === 0) {
    console.log("first match", {
      ticks,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      score: `${state.referee.scoreHome}-${state.referee.scoreAway}`,
      stats: state.stats,
      phase: state.referee.phase,
      possession: {
        home: state.stats.home.possessionTicks,
        away: state.stats.away.possessionTicks,
      },
    });
  }
}

const averages = {
  goals: totals.goals / matches,
  shots: totals.shots / matches,
  shotsPerTeam: totals.shots / matches / 2,
  fouls: totals.fouls / matches,
  foulsPerTeam: totals.fouls / matches / 2,
  offsides: totals.offsides / matches,
  offsidesPerTeam: totals.offsides / matches / 2,
  yellows: totals.yellows / matches,
  reds: totals.reds / matches,
  homeWins: totals.homeWins,
  draws: totals.draws,
  awayWins: totals.awayWins,
  elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
};
console.log("average per match over", matches, averages);

/** Product targets from the milestone brief; fixed seeds make this deterministic. */
const targets = [
  ["goals", averages.goals, 2.5, 3.0],
  ["shotsPerTeam", averages.shotsPerTeam, 8, 14],
  ["foulsPerTeam", averages.foulsPerTeam, 10, 12],
  ["offsidesPerTeam", averages.offsidesPerTeam, 2, 4],
  ["yellows", averages.yellows, 1.5, 2.0],
] as const;
const misses = targets.filter(
  ([, value, min, max]) => value < min || value > max,
);
if (misses.length > 0) {
  for (const [name, value, min, max] of misses) {
    console.error(
      `target miss: ${name}=${value.toFixed(2)} outside ${min}..${max}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("all match-average targets met");
}
