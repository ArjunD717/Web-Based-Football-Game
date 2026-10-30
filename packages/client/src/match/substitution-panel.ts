// packages/client/src/match/substitution-panel.ts

import type { MatchSetupWire, WireRosterPlayer } from "@fb/shared";

interface SubstitutionPanelOptions {
  readonly onSubstitute: (outId: string, inId: string) => void;
}

/**
 * The panel queues requests instead of mutating the lineup locally. The server
 * applies them at the next natural stoppage and replaces the roster.
 */
export class SubstitutionPanel {
  private readonly button =
    document.querySelector<HTMLButtonElement>("#open-subs");
  private readonly dialog =
    document.querySelector<HTMLDialogElement>("#subs-dialog");
  private readonly close =
    document.querySelector<HTMLButtonElement>("#close-subs");
  private readonly out =
    document.querySelector<HTMLSelectElement>("#subs-out");
  private readonly incoming =
    document.querySelector<HTMLSelectElement>("#subs-in");
  private readonly submit =
    document.querySelector<HTMLButtonElement>("#subs-submit");
  private readonly status =
    document.querySelector<HTMLElement>("#subs-status");
  private readonly benchCount =
    document.querySelector<HTMLElement>("#subs-bench-count");
  private signature = "";
  private matchId = "";
  private notice = "";

  constructor(private readonly options: SubstitutionPanelOptions) {
    this.button?.addEventListener("click", () => {
      this.dialog?.showModal();
    });
    this.close?.addEventListener("click", () => {
      this.dialog?.close();
    });
    this.submit?.addEventListener("click", () => {
      const outId = this.out?.value ?? "";
      const inId = this.incoming?.value ?? "";
      if (outId === "" || inId === "") {
        return;
      }
      this.options.onSubstitute(outId, inId);
      this.setStatus("Queued — waiting for the next stoppage.");
    });
  }

  render(
    setup: MatchSetupWire | null,
    side: "home" | "away" | null,
    available = true,
  ): void {
    if (this.button === null) {
      return;
    }
    this.button.hidden = setup === null || side === null || !available;
    if (setup === null || side === null || !available) {
      this.dialog?.close();
      this.signature = "";
      return;
    }
    const team = setup[side];
    if (setup.matchId !== this.matchId) {
      this.matchId = setup.matchId;
      this.notice = "";
    }
    const signature = `${setup.matchId}:${side}:${team.players
      .map((player) => player.id)
      .join(",")}:${team.bench.map((player) => player.id).join(",")}`;
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this.fillSelect(this.out, team.players);
    this.fillSelect(this.incoming, team.bench);
    if (this.benchCount !== null) {
      this.benchCount.textContent = `Bench: ${team.bench.length}`;
    }
    if (this.submit !== null) {
      this.submit.disabled =
        team.players.length === 0 || team.bench.length === 0;
    }
    if (this.notice === "") {
      this.setStatus(
        team.bench.length === 0
          ? "No substitutes remain."
          : "Select a player off and on.",
      );
    }
  }

  updateNotice(notice: string | null): void {
    if (notice === null) {
      return;
    }
    this.notice = notice;
    this.setStatus(notice);
  }

  private fillSelect(
    select: HTMLSelectElement | null,
    players: readonly WireRosterPlayer[],
  ): void {
    if (select === null) {
      return;
    }
    const previous = select.value;
    select.replaceChildren();
    for (const player of players) {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = `#${player.number} ${player.name}`;
      select.append(option);
    }
    if (players.some((player) => player.id === previous)) {
      select.value = previous;
    }
  }

  private setStatus(message: string): void {
    if (this.status !== null) {
      this.status.hidden = message === "";
      this.status.textContent = message;
    }
  }
}
