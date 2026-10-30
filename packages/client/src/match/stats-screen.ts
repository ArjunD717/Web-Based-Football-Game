// packages/client/src/match/stats-screen.ts

export interface MatchStatsViewRow {
  readonly label: string;
  readonly home: string;
  readonly away: string;
}

export interface MatchStatsScreenView {
  readonly title: string;
  readonly score: string;
  readonly note: string;
  readonly rows: readonly MatchStatsViewRow[];
}

/**
 * Render the full-time board. Kept separate from the transport/client state so
 * the layout can be exercised without a live match.
 */
export function renderMatchStatsScreen(
  screen: HTMLElement,
  rowsElement: HTMLElement,
  titleElement: HTMLElement,
  scoreElement: HTMLElement,
  noteElement: HTMLElement,
  view: MatchStatsScreenView,
): void {
  titleElement.textContent = view.title;
  scoreElement.textContent = view.score;
  noteElement.textContent = view.note;
  rowsElement.replaceChildren(
    ...view.rows.map(({ label, home, away }) => {
      const row = document.createElement("div");
      row.className = "stats-row";
      const homeValue = document.createElement("strong");
      homeValue.textContent = home;
      const title = document.createElement("span");
      title.textContent = label;
      const awayValue = document.createElement("strong");
      awayValue.textContent = away;
      row.append(homeValue, title, awayValue);
      return row;
    }),
  );
  screen.hidden = false;
}
