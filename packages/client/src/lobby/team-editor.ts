// packages/client/src/lobby/team-editor.ts

import {
  FORMATION_NAMES,
  buildDefaultSheet,
  cloneTeamSheet,
  formationDefinition,
  parseTeamSheet,
  validateTeamSheetAgainstData,
  type FormationName,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type MatchSettingsWire,
  type PlayerData,
  type PlayerPosition,
  type TeamSheet,
} from "@fb/shared";
import { loadCatalog, type Catalog, type TeamCatalogEntry } from "../data/catalog";

type SelectionKind = "starter" | "bench" | "reserve";
type EditorTab = "squad" | "tactics" | "setup";
type PoolTab = "bench" | "reserve";

interface Selection {
  readonly kind: SelectionKind;
  readonly index: number;
}

interface EditorCallbacks {
  readonly onSetTeam: (teamId: string) => void;
  readonly onUpdateSheet: (sheet: TeamSheet) => void;
  readonly onUpdateSettings: (settings: MatchSettingsWire) => void;
  readonly onToast: (message: string) => void;
  readonly onAvailabilityChange: () => void;
}

const SAVE_PREFIX = "fb.team-sheet.";
const POSITION_GROUPS = {
  GK: ["GK"],
  DEF: ["RB", "RWB", "CB", "LB", "LWB"],
  MID: ["CDM", "CM", "CAM", "RM", "LM"],
  ATT: ["RW", "LW", "CF", "ST"],
} as const;

const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  acceleration: "Acceleration",
  sprintSpeed: "Sprint speed",
  finishing: "Finishing",
  shotPower: "Shot power",
  longShots: "Long shots",
  volleys: "Volleys",
  penalties: "Penalties",
  attPosition: "Att. position",
  shortPassing: "Short passing",
  vision: "Vision",
  crossing: "Crossing",
  longPassing: "Long passing",
  fkAccuracy: "FK accuracy",
  curve: "Curve",
  dribbling: "Dribbling",
  agility: "Agility",
  balance: "Balance",
  reactions: "Reactions",
  ballControl: "Ball control",
  composure: "Composure",
  interceptions: "Interceptions",
  headingAccuracy: "Heading",
  defAwareness: "Def. awareness",
  standingTackle: "Standing tackle",
  slidingTackle: "Sliding tackle",
  jumping: "Jumping",
  stamina: "Stamina",
  strength: "Strength",
  aggression: "Aggression",
};

/**
 * Owns the draft-team DOM only. Every accepted change is sent to the host and
 * rendered back from the authoritative lobby state, so both devices observe the
 * same sheet without a second local source of truth.
 */
export class TeamEditor {
  private readonly root = byId<HTMLElement>("team-editor");
  private readonly status = byId<HTMLElement>("editor-status");
  private readonly body = byId<HTMLElement>("editor-body");
  private readonly teamKind = byId<HTMLSelectElement>("team-kind");
  private readonly leagueFilter = byId<HTMLSelectElement>("league-filter");
  private readonly teamSelect = byId<HTMLSelectElement>("team-select");
  private readonly formationSelect =
    byId<HTMLSelectElement>("formation-select");
  private readonly kitSelect = byId<HTMLSelectElement>("kit-select");
  private readonly clubPreview = byId<HTMLElement>("club-preview");
  private readonly syncChip = byId<HTMLElement>("editor-sync");
  private readonly xiRating = byId<HTMLElement>("squad-xi-rating");
  private readonly benchSummary = byId<HTMLElement>("squad-bench-summary");
  private readonly roleWarnings =
    byId<HTMLElement>("squad-role-warnings");
  private readonly formationLabel =
    byId<HTMLElement>("squad-formation-label");
  private readonly pitch = byId<HTMLElement>("formation-pitch");
  private readonly benchSize = byId<HTMLSelectElement>("bench-size");
  private readonly benchList = byId<HTMLElement>("bench-list");
  private readonly reserveList = byId<HTMLElement>("reserve-list");
  private readonly benchCount = byId<HTMLElement>("bench-count");
  private readonly reserveCount = byId<HTMLElement>("reserve-count");
  private readonly playerSearch = byId<HTMLInputElement>("player-search");
  private readonly positionFilter =
    byId<HTMLSelectElement>("position-filter");
  private readonly playerDetail = byId<HTMLElement>("player-detail");
  private readonly opponentPanel = byId<HTMLElement>("opponent-panel");
  private readonly captainSelect = byId<HTMLSelectElement>("captain-select");
  private readonly penaltySelect = byId<HTMLSelectElement>("penalty-select");
  private readonly freeKickSelect =
    byId<HTMLSelectElement>("freekick-select");
  private readonly cornerLeftSelect =
    byId<HTMLSelectElement>("corner-left-select");
  private readonly cornerRightSelect =
    byId<HTMLSelectElement>("corner-right-select");
  private readonly depthRange = byId<HTMLInputElement>("tactics-depth");
  private readonly depthValue = byId<HTMLElement>("tactics-depth-value");
  private readonly widthRange = byId<HTMLInputElement>("tactics-width");
  private readonly widthValue = byId<HTMLElement>("tactics-width-value");
  private readonly pressSelect = byId<HTMLSelectElement>("tactics-press");
  private readonly buildUpSelect =
    byId<HTMLSelectElement>("tactics-build-up");
  private readonly importFile = byId<HTMLInputElement>("import-file");
  private readonly halfLength =
    byId<HTMLSelectElement>("match-half-length");
  private readonly strictness =
    byId<HTMLSelectElement>("match-strictness");
  private readonly aiDifficulty =
    byId<HTMLSelectElement>("match-ai-difficulty");
  private readonly extraTime =
    byId<HTMLInputElement>("match-extra-time");
  private readonly shootout =
    byId<HTMLInputElement>("match-shootout");
  private readonly varEnabled = byId<HTMLInputElement>("match-var");
  private readonly settingsOwner =
    byId<HTMLElement>("settings-owner");

  private catalog: Catalog | null = null;
  private catalogError: string | null = null;
  private room: LobbyRoomWire | null = null;
  private selfSeat: number | null = null;
  private self: LobbyPlayerWire | null = null;
  private opponent: LobbyPlayerWire | null = null;
  private entry: TeamCatalogEntry | null = null;
  private sheet: TeamSheet | null = null;
  private selection: Selection | null = null;
  private lastTeamId: string | null = null;
  private dragged: Selection | null = null;
  private suppressClickUntil = 0;
  private activeEditorTab: EditorTab = "squad";
  private activePoolTab: PoolTab = "bench";

  constructor(private readonly callbacks: EditorCallbacks) {
    this.bindEditorTabs();
    this.bindPoolTabs();
    this.bindSquadFileMenu();

    this.teamSelect.addEventListener("change", () => {
      const teamId = this.teamSelect.value;
      if (teamId === "") {
        return;
      }
      this.selection = null;
      this.callbacks.onSetTeam(teamId);
    });

    this.teamKind.addEventListener("change", () => {
      this.renderToolbar();
    });

    this.leagueFilter.addEventListener("change", () => {
      this.renderToolbar();
    });

    this.kitSelect.addEventListener("change", () => {
      const sheet = this.sheet;
      const kit = this.kitSelect.value;
      if (
        sheet === null ||
        (kit !== "home" && kit !== "away" && kit !== "third")
      ) {
        return;
      }
      this.commit({ ...sheet, kit });
    });

    this.formationSelect.addEventListener("change", () => {
      const entry = this.entry;
      const sheet = this.sheet;
      const name = this.formationSelect.value as FormationName;
      if (entry === null || sheet === null || !FORMATION_NAMES.includes(name)) {
        return;
      }
      const built = buildDefaultSheet(
        entry.players,
        name,
        sheet.bench.length,
      );
      this.commit({
        ...built.sheet,
        kit: sheet.kit,
        tactics: { ...sheet.tactics },
      });
    });

    this.benchSize.addEventListener("change", () => {
      this.changeBenchSize(Number(this.benchSize.value));
    });

    byId<HTMLButtonElement>("auto-pick").addEventListener("click", () => {
      const entry = this.entry;
      const sheet = this.sheet;
      if (entry === null || sheet === null) {
        return;
      }
      const built = buildDefaultSheet(
        entry.players,
        sheet.formation,
        sheet.bench.length,
      );
      this.selection = null;
      this.commit({
        ...built.sheet,
        kit: sheet.kit,
        tactics: { ...sheet.tactics },
      });
    });

    byId<HTMLButtonElement>("reset-sheet").addEventListener("click", () => {
      if (this.entry === null) {
        return;
      }
      this.selection = null;
      this.commit(cloneTeamSheet(this.entry.team.defaultSheet));
    });

    byId<HTMLButtonElement>("save-sheet").addEventListener("click", () => {
      this.saveSheet();
    });

    byId<HTMLButtonElement>("load-sheet").addEventListener("click", () => {
      this.loadSheet();
    });

    byId<HTMLButtonElement>("export-sheet").addEventListener("click", () => {
      this.exportSheet();
    });

    byId<HTMLButtonElement>("import-sheet").addEventListener("click", () => {
      this.importFile.click();
    });

    this.importFile.addEventListener("change", () => {
      void this.importSheet();
    });

    this.playerSearch.addEventListener("input", () => {
      this.renderSquadLists();
    });
    this.positionFilter.addEventListener("change", () => {
      this.renderSquadLists();
    });

    this.bindTactics();
    this.bindTakerSelects();
    for (const control of [
      this.halfLength,
      this.strictness,
      this.aiDifficulty,
      this.extraTime,
      this.shootout,
      this.varEnabled,
    ]) {
      control.addEventListener("change", () => {
        const half = Number(this.halfLength.value);
        const strictness = this.strictness.value;
        const aiDifficulty = this.aiDifficulty.value;
        if (
          (half !== 4 && half !== 6 && half !== 8 && half !== 10) ||
          (strictness !== "lenient" &&
            strictness !== "standard" &&
            strictness !== "strict") ||
          (aiDifficulty !== "beginner" &&
            aiDifficulty !== "amateur" &&
            aiDifficulty !== "professional" &&
            aiDifficulty !== "worldClass" &&
            aiDifficulty !== "legendary")
        ) {
          return;
        }
        this.callbacks.onUpdateSettings({
          halfRealMinutes: half,
          extraTime: this.extraTime.checked,
          shootout: this.shootout.checked,
          varEnabled: this.varEnabled.checked,
          refereeStrictness: strictness,
          aiDifficulty,
        });
      });
    }

    void this.loadCatalog();
  }

  private bindEditorTabs(): void {
    const tabs = [
      ...this.root.querySelectorAll<HTMLButtonElement>("[data-squad-tab]"),
    ];
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        this.showEditorTab(readEditorTab(tab));
      });
      tab.addEventListener("keydown", (event) => {
        this.handleTabKey(event, tabs, (next) => {
          this.showEditorTab(readEditorTab(next));
          next.focus();
        });
      });
    }
    this.showEditorTab(this.activeEditorTab);
  }

  private bindPoolTabs(): void {
    const tabs = [
      ...this.root.querySelectorAll<HTMLButtonElement>("[data-pool-tab]"),
    ];
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        this.showPoolTab(readPoolTab(tab));
      });
      tab.addEventListener("keydown", (event) => {
        this.handleTabKey(event, tabs, (next) => {
          this.showPoolTab(readPoolTab(next));
          next.focus();
        });
      });
    }
    this.showPoolTab(this.activePoolTab);
  }

  private bindSquadFileMenu(): void {
    const menu = this.root.querySelector<HTMLDetailsElement>(".squad-file");
    if (menu === null) {
      return;
    }
    for (const action of menu.querySelectorAll<HTMLButtonElement>("button")) {
      action.addEventListener("click", () => {
        menu.open = false;
      });
    }
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !menu.open) {
        return;
      }
      event.preventDefault();
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        menu.open &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        menu.open = false;
      }
    });
  }

  private showEditorTab(tab: EditorTab): void {
    this.activeEditorTab = tab;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-squad-tab]",
    )) {
      const selected = button.dataset.squadTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>(
      "[data-squad-panel]",
    )) {
      panel.hidden = panel.dataset.squadPanel !== tab;
    }
    this.root.dataset.section = tab;
  }

  private showPoolTab(tab: PoolTab): void {
    this.activePoolTab = tab;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-pool-tab]",
    )) {
      const selected = button.dataset.poolTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>(
      "[data-pool-panel]",
    )) {
      panel.hidden = panel.dataset.poolPanel !== tab;
    }
  }

  private handleTabKey(
    event: KeyboardEvent,
    tabs: readonly HTMLButtonElement[],
    activate: (tab: HTMLButtonElement) => void,
  ): void {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const current = event.currentTarget;
    if (!(current instanceof HTMLButtonElement)) {
      return;
    }
    const index = tabs.indexOf(current);
    if (index < 0 || tabs.length === 0) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (next !== undefined) {
      activate(next);
    }
  }

  render(room: LobbyRoomWire | null, selfSeat: number | null): void {
    this.room = room;
    this.selfSeat = selfSeat;
    if (room === null || selfSeat === null) {
      this.root.hidden = true;
      return;
    }
    const visible = room.phase === "waiting" || room.phase === "ready";
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    this.self = room.players.find((player) => player.seat === selfSeat) ?? null;
    this.opponent =
      room.players.find((player) => player.seat !== selfSeat) ?? null;
    const teamId = this.self?.teamId ?? null;
    const teamChanged = teamId !== this.lastTeamId;
    if (teamChanged) {
      this.lastTeamId = teamId;
      this.selection = null;
    }
    this.entry =
      teamId === null ? null : this.catalog?.teamEntries.get(teamId) ?? null;
    if (teamChanged && this.entry !== null) {
      this.teamKind.value = this.entry.team.kind;
    }
    this.sheet = this.self?.sheet ?? null;
    this.renderSettings(room);
    this.syncChip.textContent = "Synced with host";
    this.syncChip.dataset.state = "ok";

    if (this.catalogError !== null) {
      this.body.hidden = true;
      this.status.hidden = false;
      this.status.textContent = this.catalogError;
      return;
    }
    if (this.catalog === null) {
      this.body.hidden = true;
      this.status.hidden = false;
      this.status.textContent = "Loading generated squads…";
      return;
    }
    if (this.entry === null || this.sheet === null) {
      this.body.hidden = true;
      this.status.hidden = false;
      this.status.textContent =
        this.self === null
          ? "Join a room to edit a team."
          : "Waiting for the host to assign a team.";
      return;
    }

    this.status.hidden = true;
    this.body.hidden = false;
    this.renderToolbar();
    this.renderPitch();
    this.renderSummary();
    this.renderSquadLists();
    this.renderPlayerDetail();
    this.renderTactics();
    this.renderOpponent();
    this.showEditorTab(this.activeEditorTab);
    this.showPoolTab(this.activePoolTab);
  }

  /** Used by the ready button to avoid a predictable server rejection. */
  canReady(): boolean {
    if (this.entry === null || this.sheet === null) {
      return false;
    }
    return (
      validateTeamSheetAgainstData(
        this.entry.team,
        this.sheet,
        this.entry.playersById,
      ).length === 0
    );
  }

  private async loadCatalog(): Promise<void> {
    try {
      this.catalog = await loadCatalog();
      this.catalogError = null;
    } catch (error) {
      this.catalogError =
        error instanceof Error
          ? `Could not load team data: ${error.message}`
          : "Could not load team data";
    }
    this.render(this.room, this.selfSeat);
    this.callbacks.onAvailabilityChange();
  }

  private renderToolbar(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null || this.catalog === null) {
      return;
    }
    const opponentTeamId = this.opponent?.teamId ?? null;
    const teamKind = this.teamKind.value || "club";
    this.teamKind.value = teamKind;
    const currentLeague = this.leagueFilter.value || "all";
    this.leagueFilter.replaceChildren();
    this.leagueFilter.disabled = teamKind === "nation";
    const allLeagues = document.createElement("option");
    allLeagues.value = "all";
    allLeagues.textContent =
      teamKind === "nation" ? "International" : "All leagues";
    this.leagueFilter.append(allLeagues);
    if (teamKind !== "nation") {
      for (const league of [...this.catalog.leagues].sort((a, b) =>
        a.country.localeCompare(b.country),
      )) {
        const option = document.createElement("option");
        option.value = league.id;
        option.textContent = `${league.country} · ${league.name}`;
        this.leagueFilter.append(option);
      }
    }
    const leagueId =
      teamKind === "nation"
        ? "all"
        : currentLeague === "all" ||
            this.catalog.leagues.some((league) => league.id === currentLeague)
          ? currentLeague
          : "all";
    this.leagueFilter.value = leagueId;

    this.teamSelect.replaceChildren();
    const teams = [...this.catalog.teamEntries.values()]
      .filter((teamEntry) => {
        const isCurrent = teamEntry.team.id === entry.team.id;
        if (!isCurrent && teamKind !== "all" && teamEntry.team.kind !== teamKind) {
          return false;
        }
        if (teamKind === "nation" || leagueId === "all") {
          return true;
        }
        return isCurrent || teamEntry.team.leagueId === leagueId;
      })
      .sort((a, b) => a.team.name.localeCompare(b.team.name));
    for (const teamEntry of teams) {
      const option = document.createElement("option");
      option.value = teamEntry.team.id;
      const isCurrent = teamEntry.team.id === entry.team.id;
      const kindPrefix =
        teamEntry.team.kind === "nation" ? "National · " : "";
      const currentPrefix =
        isCurrent && teamKind !== "all" && teamEntry.team.kind !== teamKind
          ? "Current · "
          : "";
      option.textContent = `${currentPrefix}${kindPrefix}${teamEntry.team.name}${
        teamEntry.team.sample ? " (sample)" : ""
      }`;
      option.disabled =
        teamEntry.team.id === opponentTeamId &&
        teamEntry.team.id !== entry.team.id;
      this.teamSelect.append(option);
    }
    this.teamSelect.value = entry.team.id;
    this.root.style.setProperty("--team-primary", kitColor(entry, sheet.kit));

    this.formationSelect.replaceChildren();
    for (const formation of FORMATION_NAMES) {
      const option = document.createElement("option");
      option.value = formation;
      option.textContent = formation;
      this.formationSelect.append(option);
    }
    this.formationSelect.value = sheet.formation;

    this.kitSelect.value = sheet.kit;

    this.benchSize.replaceChildren();
    for (let size = 5; size <= 9; size += 1) {
      const option = document.createElement("option");
      option.value = String(size);
      option.textContent = String(size);
      this.benchSize.append(option);
    }
    this.benchSize.value = String(sheet.bench.length);
    this.renderClubPreview();
  }

  private renderClubPreview(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    this.clubPreview.replaceChildren();
    const league = this.catalog?.leagues.find(
      (item) => item.id === entry.team.leagueId,
    );
    const nation =
      entry.team.kind === "nation" && entry.team.nationId !== null
        ? this.catalog?.nationsById.get(entry.team.nationId)
        : null;

    const crestFrame = document.createElement("div");
    crestFrame.className = "squad-club__crest-frame";
    const crest = document.createElement("img");
    crest.className = "squad-club__crest";
    crest.src = `/data/${entry.team.crest}`;
    crest.alt = `${entry.team.name} crest`;
    crest.decoding = "async";
    crestFrame.append(crest);

    const identity = document.createElement("div");
    identity.className = "squad-club__identity";
    const kicker = document.createElement("p");
    kicker.className = "ui-kicker";
    kicker.textContent =
      entry.team.kind === "nation"
        ? "International"
        : league?.country ?? "Club";
    const name = document.createElement("h2");
    name.className = "squad-club__name";
    name.textContent = entry.team.name;
    const meta = document.createElement("p");
    meta.className = "squad-club__meta";
    meta.textContent =
      entry.team.kind === "nation"
        ? `${nation?.name ?? entry.team.name} · ${entry.team.squad.length}-player pool`
        : `${league?.name ?? "Unknown league"} · ${entry.team.stadium} · ${
            entry.team.managerName
          }`;
    identity.append(kicker, name, meta);

    const swatches = document.createElement("div");
    swatches.className = "squad-club__swatches";
    for (const [label, colour] of [
      ["Home", entry.team.colours.home],
      ["Away", entry.team.colours.away],
      ["Third", entry.team.colours.third],
      ["GK", entry.team.colours.goalkeeper],
    ] as const) {
      const swatch = document.createElement("span");
      swatch.className = "squad-club__swatch";
      swatch.style.backgroundColor = colour;
      swatch.title = `${label} ${colour}`;
      swatches.append(swatch);
    }
    const sample = document.createElement("span");
    sample.className = "ui-badge ui-badge--outline";
    sample.textContent = entry.team.sample
      ? entry.team.kind === "nation"
        ? "Sample nation"
        : "Sample club"
      : entry.team.kind === "nation"
        ? "National team"
        : "Club";
    swatches.append(sample);

    const kit = document.createElement("img");
    kit.className = "squad-club__kit";
    kit.src = `/data/${entry.team.kits[sheet.kit]}`;
    kit.alt = `${entry.team.name} ${sheet.kit} kit`;
    kit.decoding = "async";

    this.clubPreview.append(crestFrame, identity, swatches, kit);
  }

  private renderSummary(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    const starters = sheet.startingXI
      .map((slot) => entry.playersById.get(slot.playerId))
      .filter((player): player is PlayerData => player !== undefined);
    const rating =
      starters.length === 0
        ? null
        : Math.round(
            starters.reduce((total, player) => total + player.overall, 0) /
              starters.length,
          );
    this.xiRating.textContent = rating === null ? "—" : String(rating);
    this.benchSummary.textContent = String(sheet.bench.length);
    this.formationLabel.textContent = sheet.formation;
  }

  private renderPitch(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    const definition = formationDefinition(sheet.formation);
    this.pitch.replaceChildren();
    this.pitch.style.setProperty(
      "--team-primary",
      kitColor(entry, sheet.kit),
    );

    let outOfRole = 0;
    for (const [index, slot] of sheet.startingXI.entries()) {
      const geometry = definition.slots[index];
      const player = entry.playersById.get(slot.playerId);
      const selected =
        this.selection?.kind === "starter" && this.selection.index === index;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "squad-marker";
      button.dataset.selected = String(selected);
      if (player !== undefined) {
        const fit = roleFit(player, slot.role);
        button.dataset.roleFit = fit;
        button.title = `${player.name} — ${fit} fit at ${slot.role}`;
        button.dataset.number = String(player.kitNumber);
        if (fit === "warning") {
          outOfRole += 1;
        }
      } else {
        button.dataset.number = "—";
      }
      // The shared geometry stops around x=0.72; spread it across the editor
      // pitch and keep edge cards inside the touchlines.
      const normalizedX = Math.min(0.72, Math.max(0, geometry?.x ?? 0.5));
      const displayX = 0.12 + (normalizedX / 0.72) * 0.76;
      const displayY =
        0.1 + Math.min(1, Math.max(0, geometry?.y ?? 0.5)) * 0.8;
      button.style.left = `${displayX * 100}%`;
      button.style.top = `${displayY * 100}%`;
      button.setAttribute(
        "aria-label",
        `${slot.role} ${player?.name ?? slot.playerId}, ${
          player === undefined ? "unassigned" : `${player.overall} overall`
        }, click to swap`,
      );
      button.addEventListener("click", () => {
        if (performance.now() < this.suppressClickUntil) {
          return;
        }
        this.select({ kind: "starter", index });
      });
      this.makeDraggable(button, { kind: "starter", index });

      const role = document.createElement("span");
      role.className = "squad-marker__role";
      role.textContent = slot.role;
      const name = document.createElement("strong");
      name.className = "squad-marker__name";
      name.textContent =
        player === undefined ? slot.playerId : surname(player.name);
      const meta = document.createElement("span");
      meta.className = "squad-marker__meta";
      meta.textContent =
        player === undefined ? "Unassigned" : `${player.overall} OVR`;
      button.append(role, name, meta);
      if (player !== undefined) {
        button.style.setProperty("--shirt", kitColor(entry, sheet.kit));
      }
      this.pitch.append(button);
    }
    this.roleWarnings.textContent = String(outOfRole);
    this.roleWarnings.dataset.state = outOfRole === 0 ? "ok" : "warning";
  }

  private renderSquadLists(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    const search = this.playerSearch.value.trim().toLowerCase();
    const filter = this.positionFilter.value;
    const matches = (playerId: string): boolean => {
      const player = entry.playersById.get(playerId);
      if (player === undefined) {
        return true;
      }
      if (
        search !== "" &&
        !player.name.toLowerCase().includes(search) &&
        !player.positions.some((position) =>
          position.toLowerCase().includes(search),
        )
      ) {
        return false;
      }
      if (filter === "all") {
        return true;
      }
      const group: readonly PlayerPosition[] =
        POSITION_GROUPS[filter as keyof typeof POSITION_GROUPS];
      return player.positions.some((position) => group.includes(position));
    };

    this.benchList.replaceChildren();
    for (const [index, playerId] of sheet.bench.entries()) {
      const player = entry.playersById.get(playerId);
      if (player !== undefined && !matches(playerId)) {
        continue;
      }
      this.benchList.append(
        this.buildPlayerRow(playerId, player, {
          kind: "bench",
          index,
        }),
      );
    }
    if (this.benchList.childElementCount === 0) {
      this.benchList.append(emptyMessage("No substitutes match this filter"));
    }

    this.reserveList.replaceChildren();
    let visibleReserves = 0;
    for (const [index, playerId] of sheet.reserves.entries()) {
      const player = entry.playersById.get(playerId);
      if (player !== undefined && !matches(playerId)) {
        continue;
      }
      visibleReserves += 1;
      this.reserveList.append(
        this.buildPlayerRow(playerId, player, {
          kind: "reserve",
          index,
        }),
      );
    }
    if (visibleReserves === 0) {
      this.reserveList.append(emptyMessage("No reserves match this filter"));
    }
    this.benchCount.textContent = String(sheet.bench.length);
    this.reserveCount.textContent = String(sheet.reserves.length);
  }

  private buildPlayerRow(
    playerId: string,
    player: PlayerData | undefined,
    selection: Selection,
  ): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "squad-player";
    button.dataset.selected = String(this.isSelected(selection));
    if (player !== undefined) {
      button.title = `${player.name} — select to swap`;
      button.setAttribute(
        "aria-label",
        `${player.name}, ${player.preferredPosition}, ${player.overall} overall, select to swap`,
      );
    }
    button.addEventListener("click", () => {
      if (performance.now() < this.suppressClickUntil) {
        return;
      }
      this.select(selection);
    });
    this.makeDraggable(button, selection);

    const number = document.createElement("span");
    number.className = "squad-player__number";
    number.textContent =
      player === undefined ? "—" : String(player.kitNumber).padStart(2, "0");
    const identity = document.createElement("span");
    identity.className = "squad-player__identity";
    const name = document.createElement("strong");
    name.className = "squad-player__name";
    name.textContent = player?.name ?? playerId;
    const meta = document.createElement("span");
    meta.className = "squad-player__meta";
    meta.textContent =
      player === undefined
        ? playerId
        : `${player.preferredPosition} · ${player.positions.slice(0, 3).join("/")}`;
    identity.append(name, meta);
    const overall = document.createElement("span");
    overall.className = "squad-player__overall";
    overall.textContent = player === undefined ? "—" : String(player.overall);
    button.append(number, identity, overall);
    return button;
  }

  private makeDraggable(element: HTMLElement, selection: Selection): void {
    element.draggable = true;
    element.addEventListener("dragstart", (event) => {
      this.dragged = selection;
      element.classList.add("dragging");
      if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-fb-sheet-selection",
          JSON.stringify(selection),
        );
      }
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("dragging");
      this.dragged = null;
      this.suppressClickUntil = performance.now() + 150;
    });
    element.addEventListener("dragover", (event) => {
      if (this.dragged === null) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "move";
      }
      element.classList.add("drag-over");
    });
    element.addEventListener("dragleave", () => {
      element.classList.remove("drag-over");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("drag-over");
      const target = this.dragged;
      this.dragged = null;
      this.suppressClickUntil = performance.now() + 150;
      if (
        target === null ||
        (target.kind === selection.kind && target.index === selection.index)
      ) {
        return;
      }
      this.selection = null;
      this.swap(target, selection);
    });
  }

  private select(selection: Selection): void {
    if (selection.kind === "bench" || selection.kind === "reserve") {
      this.showPoolTab(selection.kind);
    }
    if (
      this.selection !== null &&
      this.selection.kind === selection.kind &&
      this.selection.index === selection.index
    ) {
      this.selection = null;
      this.renderPitch();
      this.renderSquadLists();
      this.renderPlayerDetail();
      return;
    }
    if (this.selection === null) {
      this.selection = selection;
      this.renderPitch();
      this.renderSquadLists();
      this.renderPlayerDetail();
      return;
    }
    const from = this.selection;
    this.selection = null;
    this.swap(from, selection);
  }

  private swap(from: Selection, to: Selection): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    const starterIds = sheet.startingXI.map((slot) => slot.playerId);
    const benchIds = [...sheet.bench];
    const reserveIds = [...sheet.reserves];
    const read = (selection: Selection): string | undefined => {
      if (selection.kind === "starter") {
        return starterIds[selection.index];
      }
      if (selection.kind === "bench") {
        return benchIds[selection.index];
      }
      return reserveIds[selection.index];
    };
    const write = (selection: Selection, value: string): void => {
      if (selection.kind === "starter") {
        starterIds[selection.index] = value;
      } else if (selection.kind === "bench") {
        benchIds[selection.index] = value;
      } else {
        reserveIds[selection.index] = value;
      }
    };
    const fromId = read(from);
    const toId = read(to);
    if (fromId === undefined || toId === undefined) {
      return;
    }
    write(from, toId);
    write(to, fromId);

    const next: TeamSheet = {
      ...sheet,
      startingXI: sheet.startingXI.map((slot, index) => ({
        ...slot,
        playerId: starterIds[index] ?? slot.playerId,
      })),
      bench: benchIds,
      reserves: reserveIds,
    };
    const repaired = repairTakers(next, entry.playersById);
    const errors = validateTeamSheetAgainstData(
      entry.team,
      repaired,
      entry.playersById,
    );
    if (errors.length > 0) {
      this.callbacks.onToast(errors.slice(0, 2).join(" "));
      this.renderPitch();
      this.renderSquadLists();
      this.renderPlayerDetail();
      return;
    }
    this.commit(repaired);
  }

  private changeBenchSize(size: number): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null || size < 5 || size > 9) {
      return;
    }
    const pool = [...sheet.bench, ...sheet.reserves]
      .map((id) => entry.playersById.get(id))
      .filter((player): player is PlayerData => player !== undefined);
    const keeper = pool
      .filter((player) => player.positions.includes("GK"))
      .sort((a, b) => b.overall - a.overall)[0];
    const chosen: PlayerData[] = [];
    if (keeper !== undefined) {
      chosen.push(keeper);
    }
    const outfielders = pool
      .filter((player) => player.id !== keeper?.id && !player.positions.includes("GK"))
      .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
    for (const player of outfielders) {
      if (chosen.length >= size) {
        break;
      }
      chosen.push(player);
    }
    if (chosen.length !== size) {
      this.callbacks.onToast("Not enough available players for that bench size");
      return;
    }
    const bench = chosen.map((player) => player.id);
    const benchSet = new Set(bench);
    const reserves = [...sheet.bench, ...sheet.reserves]
      .filter((id) => !benchSet.has(id))
      .sort();
    const next: TeamSheet = { ...sheet, bench, reserves };
    const errors = validateTeamSheetAgainstData(
      entry.team,
      next,
      entry.playersById,
    );
    if (errors.length > 0) {
      this.callbacks.onToast(errors.slice(0, 2).join(" "));
      return;
    }
    this.commit(next);
  }

  private commit(sheet: TeamSheet): void {
    const entry = this.entry;
    if (entry === null) {
      return;
    }
    const errors = validateTeamSheetAgainstData(
      entry.team,
      sheet,
      entry.playersById,
    );
    if (errors.length > 0) {
      this.callbacks.onToast(errors.slice(0, 2).join(" "));
      return;
    }
    this.sheet = sheet;
    if (this.entry !== null) {
      this.root.style.setProperty(
        "--team-primary",
        kitColor(this.entry, sheet.kit),
      );
    }
    this.formationSelect.value = sheet.formation;
    this.kitSelect.value = sheet.kit;
    this.benchSize.value = String(sheet.bench.length);
    this.syncChip.textContent = "Sending to host…";
    this.syncChip.dataset.state = "pending";
    this.renderClubPreview();
    this.renderPitch();
    this.renderSummary();
    this.renderSquadLists();
    this.renderTactics();
    this.renderPlayerDetail();
    this.callbacks.onUpdateSheet(sheet);
  }

  private renderSettings(room: LobbyRoomWire): void {
    const settings = room.settings;
    this.halfLength.value = String(settings.halfRealMinutes);
    this.strictness.value = settings.refereeStrictness;
    this.aiDifficulty.value = settings.aiDifficulty;
    this.extraTime.checked = settings.extraTime;
    this.shootout.checked = settings.shootout;
    this.varEnabled.checked = settings.varEnabled;
    const host = this.self?.host === true;
    this.halfLength.disabled = !host;
    this.strictness.disabled = !host;
    this.aiDifficulty.disabled = !host;
    this.extraTime.disabled = !host;
    this.shootout.disabled = !host;
    this.varEnabled.disabled = !host;
    this.settingsOwner.textContent = host
      ? "Host controls"
      : "Set by host";
    this.settingsOwner.dataset.state = host ? "ok" : "pending";
  }

  private renderPlayerDetail(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    let playerId: string | undefined;
    if (this.selection?.kind === "starter") {
      playerId = sheet.startingXI[this.selection.index]?.playerId;
    } else if (this.selection?.kind === "bench") {
      playerId = sheet.bench[this.selection.index];
    } else if (this.selection?.kind === "reserve") {
      playerId = sheet.reserves[this.selection.index];
    }
    const player =
      playerId === undefined ? undefined : entry.playersById.get(playerId);
    this.playerDetail.replaceChildren();
    if (player === undefined) {
      const empty = document.createElement("div");
      empty.className = "squad-profile__empty";
      const mark = document.createElement("span");
      mark.className = "squad-profile__empty-mark";
      mark.textContent = "XI";
      const title = document.createElement("h3");
      title.textContent = "Player dossier";
      const copy = document.createElement("p");
      copy.textContent =
        this.selection === null
          ? "Select a starter, substitute or reserve to inspect face stats, attributes and role fit."
          : "This slot is unassigned. Select another player to inspect a dossier.";
      empty.append(mark, title, copy);
      this.playerDetail.append(empty);
      return;
    }

    const head = document.createElement("div");
    head.className = "squad-profile__head";
    const portrait = document.createElement("div");
    portrait.className = "squad-profile__portrait";
    const headshot = document.createElement("img");
    headshot.src = `/data/${player.face}`;
    headshot.alt = player.name;
    headshot.loading = "lazy";
    const shirt = document.createElement("span");
    shirt.className = "squad-profile__shirt";
    shirt.textContent = String(player.kitNumber).padStart(2, "0");
    portrait.append(headshot, shirt);

    const identity = document.createElement("div");
    identity.className = "squad-profile__identity";
    const kicker = document.createElement("p");
    kicker.className = "ui-kicker";
    kicker.textContent = `#${player.kitNumber} · ${player.preferredPosition}`;
    const name = document.createElement("h3");
    name.className = "squad-profile__name";
    name.textContent = player.name;
    const meta = document.createElement("p");
    meta.className = "squad-profile__meta";
    const nation = this.catalog?.nationsById.get(player.nationId);
    const originLine = document.createElement("span");
    originLine.textContent = `${nation?.name ?? player.nationId} · Age ${
      player.age
    }`;
    const footLine = document.createElement("span");
    footLine.textContent =
      player.foot === "both"
        ? "Both feet"
        : `${player.foot === "right" ? "Right" : "Left"} footed`;
    meta.append(originLine, footLine);
    identity.append(kicker, name, meta);

    const selectedRole: PlayerPosition | null =
      this.selection?.kind === "starter"
        ? sheet.startingXI[this.selection.index]?.role ?? null
        : null;
    if (selectedRole !== null) {
      const fit = roleFit(player, selectedRole);
      const fitChip = document.createElement("span");
      fitChip.className = "squad-profile__fit";
      fitChip.dataset.state = fit;
      fitChip.textContent = `${fit} fit · ${selectedRole}`;
      identity.append(fitChip);
    }

    const rating = document.createElement("div");
    rating.className = "squad-profile__rating";
    const ratingLabel = document.createElement("span");
    ratingLabel.textContent = "OVR";
    const ratingValue = document.createElement("strong");
    ratingValue.textContent = String(player.overall);
    rating.append(ratingLabel, ratingValue);
    head.append(portrait, identity, rating);

    const face = document.createElement("div");
    face.className = "squad-profile__face";
    for (const [label, value] of Object.entries(player.faceStats)) {
      const cell = document.createElement("div");
      cell.className = "squad-face-stat";
      const key = document.createElement("span");
      key.textContent = label;
      const score = document.createElement("strong");
      score.textContent = String(value);
      cell.append(key, score);
      face.append(cell);
    }

    const bioLabel = document.createElement("p");
    bioLabel.className = "squad-profile__section-label";
    bioLabel.textContent = "Profile";
    const bio = document.createElement("div");
    bio.className = "squad-profile__bio";
    const bioFields: readonly [string, string][] = [
      ["Weak foot", `${player.weakFoot}★`],
      ["Skill moves", `${player.skillMoves}★`],
      ["Work rate", `${player.workRate.att}/${player.workRate.def}`],
      ["Height", `${player.heightCm} cm`],
      ["Weight", `${player.weightKg} kg`],
      ["Body", player.bodyType],
    ];
    for (const [label, value] of bioFields) {
      const row = document.createElement("div");
      row.className = "squad-bio";
      const key = document.createElement("span");
      key.textContent = label;
      const score = document.createElement("strong");
      score.textContent = value;
      row.append(key, score);
      bio.append(row);
    }

    const attributeLabel = document.createElement("p");
    attributeLabel.className = "squad-profile__section-label";
    attributeLabel.textContent = "Top attributes";
    const attributes = document.createElement("div");
    attributes.className = "squad-profile__attributes";
    const entries = (Object.entries(player.attributes) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const [key, value] of entries) {
      attributes.append(
        attributeRow(ATTRIBUTE_LABELS[key] ?? key, value),
      );
    }

    const allAttributes = document.createElement("details");
    allAttributes.className = "squad-profile__details";
    const summary = document.createElement("summary");
    summary.textContent = "All attributes";
    const fullGrid = document.createElement("div");
    fullGrid.className = "squad-profile__all-grid";
    for (const [key, value] of Object.entries(player.attributes) as [
      string,
      number,
    ][]) {
      fullGrid.append(attributeRow(ATTRIBUTE_LABELS[key] ?? key, value));
    }
    if (player.goalkeeper !== null) {
      for (const [key, value] of Object.entries(player.goalkeeper) as [
        string,
        number,
      ][]) {
        fullGrid.append(
          attributeRow(`GK ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`, value),
        );
      }
    }
    allAttributes.append(summary, fullGrid);

    const styleLabel = document.createElement("p");
    styleLabel.className = "squad-profile__section-label";
    styleLabel.textContent = "PlayStyles";
    const styles = document.createElement("div");
    styles.className = "squad-profile__styles";
    for (const style of player.playStyles.slice(0, 6)) {
      const chip = document.createElement("span");
      chip.className = "ui-badge ui-badge--outline";
      chip.textContent = style;
      styles.append(chip);
    }
    if (styles.childElementCount === 0) {
      styles.append(emptyMessage("No PlayStyles"));
    }

    this.playerDetail.append(
      head,
      face,
      bioLabel,
      bio,
      attributeLabel,
      attributes,
      allAttributes,
      styleLabel,
      styles,
    );
  }

  private renderTactics(): void {
    const sheet = this.sheet;
    if (sheet === null) {
      return;
    }
    this.depthRange.value = String(sheet.tactics.defensiveDepth);
    this.depthValue.textContent = String(sheet.tactics.defensiveDepth);
    this.widthRange.value = String(sheet.tactics.width);
    this.widthValue.textContent = String(sheet.tactics.width);
    this.pressSelect.value = sheet.tactics.pressIntensity;
    this.buildUpSelect.value = sheet.tactics.buildUpStyle;

    const starters = sheet.startingXI
      .map((slot) => this.entry?.playersById.get(slot.playerId))
      .filter((player): player is PlayerData => player !== undefined);
    for (const select of [
      this.captainSelect,
      this.penaltySelect,
      this.freeKickSelect,
      this.cornerLeftSelect,
      this.cornerRightSelect,
    ]) {
      select.replaceChildren();
      for (const player of starters) {
        const option = document.createElement("option");
        option.value = player.id;
        option.textContent = `${player.name} (${player.overall})`;
        select.append(option);
      }
    }
    this.captainSelect.value = sheet.captain;
    this.penaltySelect.value = sheet.penaltyTaker;
    this.freeKickSelect.value = sheet.freeKickTaker;
    this.cornerLeftSelect.value = sheet.cornerLeft;
    this.cornerRightSelect.value = sheet.cornerRight;
  }

  private renderOpponent(): void {
    const opponent = this.opponent;
    const opponentEntry =
      opponent?.teamId === null || opponent?.teamId === undefined
        ? null
        : this.catalog?.teamEntries.get(opponent.teamId) ?? null;
    this.opponentPanel.replaceChildren();
    if (opponent === null) {
      const empty = document.createElement("div");
      empty.className = "squad-opponent__empty";
      const seat = document.createElement("span");
      seat.className = "ui-kicker";
      seat.textContent = "Seat 02";
      const title = document.createElement("strong");
      title.textContent = "Waiting for a second device";
      const copy = document.createElement("p");
      copy.textContent =
        "Share the room code or QR. Their team sheet appears here once they join.";
      empty.append(seat, title, copy);
      this.opponentPanel.append(empty);
      return;
    }
    if (opponentEntry === null || opponent.sheet === null) {
      const empty = document.createElement("div");
      empty.className = "squad-opponent__empty";
      const seat = document.createElement("span");
      seat.className = "ui-kicker";
      seat.textContent = "Seat 02";
      const title = document.createElement("strong");
      title.textContent = "Choosing a team";
      const copy = document.createElement("p");
      copy.textContent = "Their formation and bench will appear here.";
      empty.append(seat, title, copy);
      this.opponentPanel.append(empty);
      return;
    }

    const identity = document.createElement("div");
    identity.className = "squad-opponent__identity";
    const crest = document.createElement("img");
    crest.className = "squad-opponent__crest";
    crest.src = `/data/${opponentEntry.team.crest}`;
    crest.alt = `${opponentEntry.team.name} crest`;
    crest.decoding = "async";
    const copy = document.createElement("div");
    copy.className = "squad-opponent__copy";
    const name = document.createElement("strong");
    name.textContent = opponentEntry.team.name;
    const meta = document.createElement("span");
    meta.textContent = opponent.name;
    copy.append(name, meta);

    const state = document.createElement("span");
    state.className = "ui-badge";
    state.textContent = !opponent.connected
      ? "Offline"
      : opponent.ready
        ? "Ready"
        : "Editing";
    state.dataset.state = !opponent.connected
      ? "warning"
      : opponent.ready
        ? "success"
        : "idle";
    identity.append(crest, copy, state);

    const stats = document.createElement("dl");
    stats.className = "squad-opponent__stats";
    for (const [label, value] of [
      ["Formation", opponent.sheet.formation],
      ["Bench", String(opponent.sheet.bench.length)],
      ["Press", opponent.sheet.tactics.pressIntensity],
    ] as const) {
      const item = document.createElement("div");
      const key = document.createElement("dt");
      key.textContent = label;
      const score = document.createElement("dd");
      score.textContent = value;
      item.append(key, score);
      stats.append(item);
    }

    this.opponentPanel.append(identity, stats);
  }

  private bindTactics(): void {
    this.depthRange.addEventListener("input", () => {
      this.depthValue.textContent = this.depthRange.value;
    });
    this.widthRange.addEventListener("input", () => {
      this.widthValue.textContent = this.widthRange.value;
    });
    const apply = (): void => {
      const sheet = this.sheet;
      if (sheet === null) {
        return;
      }
      this.commit({
        ...sheet,
        tactics: {
          ...sheet.tactics,
          defensiveDepth: Number(this.depthRange.value),
          width: Number(this.widthRange.value),
          pressIntensity:
            this.pressSelect.value as TeamSheet["tactics"]["pressIntensity"],
          buildUpStyle:
            this.buildUpSelect.value as TeamSheet["tactics"]["buildUpStyle"],
        },
      });
    };
    this.depthRange.addEventListener("change", apply);
    this.widthRange.addEventListener("change", apply);
    this.pressSelect.addEventListener("change", apply);
    this.buildUpSelect.addEventListener("change", apply);
  }

  private bindTakerSelects(): void {
    const apply = (): void => {
      const sheet = this.sheet;
      if (sheet === null) {
        return;
      }
      this.commit({
        ...sheet,
        captain: this.captainSelect.value,
        penaltyTaker: this.penaltySelect.value,
        freeKickTaker: this.freeKickSelect.value,
        cornerLeft: this.cornerLeftSelect.value,
        cornerRight: this.cornerRightSelect.value,
      });
    };
    for (const select of [
      this.captainSelect,
      this.penaltySelect,
      this.freeKickSelect,
      this.cornerLeftSelect,
      this.cornerRightSelect,
    ]) {
      select.addEventListener("change", apply);
    }
  }

  private saveSheet(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    try {
      window.localStorage.setItem(
        `${SAVE_PREFIX}${entry.team.id}`,
        JSON.stringify(sheet),
      );
      this.callbacks.onToast("Team sheet saved in this browser");
    } catch {
      this.callbacks.onToast("This browser blocked local storage");
    }
  }

  private loadSheet(): void {
    const entry = this.entry;
    if (entry === null) {
      return;
    }
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(`${SAVE_PREFIX}${entry.team.id}`);
    } catch {
      this.callbacks.onToast("This browser blocked local storage");
      return;
    }
    if (saved === null) {
      this.callbacks.onToast("No saved sheet for this team");
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(saved) as unknown;
    } catch {
      this.callbacks.onToast("The saved sheet is not valid JSON");
      return;
    }
    const sheet = parseTeamSheet(raw);
    if (sheet === null) {
      this.callbacks.onToast("The saved sheet failed validation");
      return;
    }
    const errors = validateTeamSheetAgainstData(
      entry.team,
      sheet,
      entry.playersById,
    );
    if (errors.length > 0) {
      this.callbacks.onToast(errors.slice(0, 2).join(" "));
      return;
    }
    this.commit(sheet);
  }

  private exportSheet(): void {
    const entry = this.entry;
    const sheet = this.sheet;
    if (entry === null || sheet === null) {
      return;
    }
    const blob = new Blob([JSON.stringify(sheet, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${entry.team.id}-sheet.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private async importSheet(): Promise<void> {
    const entry = this.entry;
    const file = this.importFile.files?.[0];
    this.importFile.value = "";
    if (entry === null || file === undefined) {
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text()) as unknown;
    } catch {
      this.callbacks.onToast("Could not parse the selected JSON file");
      return;
    }
    const sheet = parseTeamSheet(raw);
    if (sheet === null) {
      this.callbacks.onToast("That JSON is not a valid team sheet");
      return;
    }
    const errors = validateTeamSheetAgainstData(
      entry.team,
      sheet,
      entry.playersById,
    );
    if (errors.length > 0) {
      this.callbacks.onToast(errors.slice(0, 2).join(" "));
      return;
    }
    this.commit(sheet);
  }

  private isSelected(selection: Selection): boolean {
    return (
      this.selection !== null &&
      this.selection.kind === selection.kind &&
      this.selection.index === selection.index
    );
  }
}

function attributeRow(label: string, value: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "squad-attribute";
  const key = document.createElement("span");
  key.textContent = label;
  const score = document.createElement("strong");
  score.textContent = String(value);
  row.append(key, score);
  return row;
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function readEditorTab(element: HTMLElement): EditorTab {
  const value = element.dataset.squadTab;
  return value === "tactics" || value === "setup" ? value : "squad";
}

function readPoolTab(element: HTMLElement): PoolTab {
  return element.dataset.poolTab === "reserve" ? "reserve" : "bench";
}

function kitColor(entry: TeamCatalogEntry, kit: TeamSheet["kit"]): string {
  if (kit === "away") {
    return entry.team.colours.away;
  }
  if (kit === "third") {
    return entry.team.colours.third;
  }
  return entry.team.colours.home;
}

function roleFit(
  player: PlayerData,
  role: PlayerPosition,
): "natural" | "accomplished" | "warning" {
  if (player.preferredPosition === role) {
    return "natural";
  }
  if (player.positions.includes(role)) {
    return "accomplished";
  }
  return "warning";
}

function repairTakers(
  sheet: TeamSheet,
  players: ReadonlyMap<string, PlayerData>,
): TeamSheet {
  const starters = sheet.startingXI
    .map((slot) => players.get(slot.playerId))
    .filter((player): player is PlayerData => player !== undefined);
  if (starters.length === 0) {
    return sheet;
  }
  const startersSet = new Set(starters.map((player) => player.id));
  const best = (rating: (player: PlayerData) => number): string => {
    const ranked = [...starters].sort(
      (a, b) => rating(b) - rating(a) || a.id.localeCompare(b.id),
    );
    return ranked[0]?.id ?? starters[0]!.id;
  };
  return {
    ...sheet,
    captain: startersSet.has(sheet.captain)
      ? sheet.captain
      : best((player) => player.overall),
    penaltyTaker: startersSet.has(sheet.penaltyTaker)
      ? sheet.penaltyTaker
      : best((player) => player.attributes.penalties),
    freeKickTaker: startersSet.has(sheet.freeKickTaker)
      ? sheet.freeKickTaker
      : best((player) => player.attributes.fkAccuracy),
    cornerLeft: startersSet.has(sheet.cornerLeft)
      ? sheet.cornerLeft
      : best((player) => player.attributes.crossing),
    cornerRight: startersSet.has(sheet.cornerRight)
      ? sheet.cornerRight
      : best(
          (player) =>
            player.attributes.crossing + player.attributes.curve * 0.25,
        ),
  };
}

function emptyMessage(text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "squad-empty";
  element.textContent = text;
  return element;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}
