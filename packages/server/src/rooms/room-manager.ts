// packages/server/src/rooms/room-manager.ts
import { randomInt } from "node:crypto";
import {
  CLOSE_CODES,
  DEFAULT_MATCH_SETTINGS,
  TUNING,
  applySuspensionsToSheet,
  decodeClientBinaryMessage,
  encodeSnapshot,
  isRoomCode,
  normalizeRoomCode,
  type ClientMessage,
  type LobbyPhase,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type LobbyYouWire,
  type MatchSettingsWire,
  type MatchSetupWire,
  type ServerErrorCode,
  type ServerMessage,
  type SnapshotFrame,
  type TeamSheet,
  type WireTeamSide,
  type WireTieSeries,
} from "@fb/shared";
import {
  isRefereePlayable,
  substitutePlayers,
  substitutionsAllowed,
  stepMatch,
  type MatchState,
  type SubstitutionChange,
} from "@fb/sim";
import {
  controlSnapshotIndices,
  createTeamControlRuntime,
  markControlReconnected,
  prepareTeamControl,
  updateControlInput,
  type TeamControlRuntime,
} from "./control";
import type { ClientConnection } from "../client";
import type { TeamRegistry } from "../data/registry";
import type { Logger } from "../create-server";
import type { ReplayExport } from "../http/request-handler";
import {
  advanceGoalReplay,
  beginGoalReplay,
  finishGoalReplay,
  type GoalReplayCapture,
  type GoalReplayRecord,
} from "./replay-capture";
import {
  buildMatchStats,
  buildShootoutWire,
  buildSnapshotFrame,
  buildWireRoster,
  createServerMatch,
  rulesFromSettings,
} from "./match-stream";

const TICK_SECONDS = 1 / TUNING.sim.tickHz;
const SNAPSHOT_EVERY_TICKS = Math.max(
  1,
  Math.round(TUNING.sim.tickHz / TUNING.network.snapshotHz),
);
const MATCH_PAUSE_REASON = "Opponent disconnected";
const MANUAL_PAUSE_REASON = "A player paused the match";
const HOST_NAME = "Host";
const GUEST_NAME = "Guest";

interface Seat {
  readonly token: string;
  /** Requests wait for the next natural stoppage. */
  pendingSubstitutions: SubstitutionChange[];
  readonly host: boolean;
  readonly name: string;
  readonly team: WireTeamSide;
  teamId: string | null;
  sheet: TeamSheet | null;
  ready: boolean;
  client: ClientConnection | null;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectDeadlineMs: number | null;
  lastAckedSeq: number;
  forceFullSnapshot: boolean;
}

interface RoomMatch {
  readonly setup: MatchSetupWire;
  state: MatchState;
  snapshotSeq: number;
  snapshots: Map<number, SnapshotFrame>;
  accumulator: number;
  finished: boolean;
  resultSent: boolean;
  lastVarSignature: string | null;
  lastShootoutSignature: string | null;
  lastScoreHome: number;
  lastScoreAway: number;
  goalCapture: GoalReplayCapture | null;
  readonly controls: {
    readonly home: TeamControlRuntime;
    readonly away: TeamControlRuntime;
  };
}

interface RoomSeries {
  readonly legs: 2;
  readonly scores: { readonly home: number; readonly away: number }[];
  /** Red-card suspensions carried into the next leg, keyed by data player ID. */
  readonly suspended: {
    readonly home: Set<string>;
    readonly away: Set<string>;
  };
}

interface Room {
  readonly code: string;
  host: Seat | null;
  guest: Seat | null;
  match: RoomMatch | null;
  phase: LobbyPhase;
  /** True while the host has intentionally frozen play. */
  manualPaused: boolean;
  pauseDeadlineMs: number | null;
  settings: MatchSettingsWire;
  /** Two-legged tie state; null for one-off matches. */
  series: RoomSeries | null;
  replayClips: Map<string, StoredGoalReplay>;
  replayClipSeq: number;
}

interface StoredGoalReplay extends GoalReplayRecord {
  readonly setup: MatchSetupWire;
}

export interface RoomManagerOptions {
  readonly logger: Logger;
  readonly registry: TeamRegistry;
  readonly reconnectGraceMs?: number;
  readonly generateCode?: () => string;
  readonly onRoomCreated?: (code: string) => void;
}

/**
 * Owns rooms, seats, match ticking and snapshot streaming. The transport layer
 * only forwards messages; no simulation state lives in create-server.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly membership = new Map<string, Room>();
  private readonly logger: Logger;
  private readonly registry: TeamRegistry;
  private readonly reconnectGraceMs: number;
  private readonly generateCode: () => string;
  private readonly onRoomCreated: (code: string) => void;

  constructor(options: RoomManagerOptions) {
    this.logger = options.logger;
    this.registry = options.registry;
    this.reconnectGraceMs =
      options.reconnectGraceMs ?? TUNING.network.reconnectGraceMs;
    this.generateCode = options.generateCode ?? (() => this.randomCode());
    this.onRoomCreated = options.onRoomCreated ?? (() => undefined);
    if (!Number.isFinite(this.reconnectGraceMs) || this.reconnectGraceMs <= 0) {
      throw new RangeError("reconnectGraceMs must be positive");
    }
  }

  onReady(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    if (room === undefined) {
      this.sendIdle(client);
      return;
    }
    const seat = this.findSeat(room, client.token);
    if (seat === null) {
      this.membership.delete(client.token);
      this.sendIdle(client);
      return;
    }

    const wasPaused = room.phase === "paused";
    seat.client = client;
    seat.reconnectDeadlineMs = null;
    this.clearReconnectTimer(seat);
    this.logger.info(
      `Room ${room.code}: ${seat.name} connected${wasPaused ? " (resume)" : ""}`,
    );

    if (room.match !== null) {
      const teamControl =
        seat.team === "home"
          ? room.match.controls.home
          : room.match.controls.away;
      markControlReconnected(teamControl);
      const both = this.bothConnected(room);
      if (both) {
        room.phase = room.manualPaused ? "paused" : "live";
        room.pauseDeadlineMs = null;
      } else {
        room.phase = "paused";
        room.pauseDeadlineMs = this.earliestReconnectDeadline(room);
      }

      this.sendSetupAndSnapshot(room, seat);
      if (both && room.manualPaused) {
        this.broadcast(room, {
          t: "matchPaused",
          reason: MANUAL_PAUSE_REASON,
          reconnectSeconds: 0,
          manual: true,
        });
      } else if (both && wasPaused) {
        this.broadcast(room, { t: "matchResumed" });
      } else if (!both) {
        seat.client?.send({
          t: "matchPaused",
          reason: MATCH_PAUSE_REASON,
          reconnectSeconds: Math.ceil(this.reconnectGraceMs / 1_000),
          manual: false,
        });
      }
      this.broadcastLobby(room);
      return;
    }

    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
    this.maybeStartMatch(room);
  }

  onMessage(client: ClientConnection, message: ClientMessage): void {
    switch (message.t) {
      case "createRoom":
        this.createRoom(client);
        return;
      case "joinRoom":
        this.joinRoom(client, message.code);
        return;
      case "setReady":
        this.setReady(client, message.ready);
        return;
      case "setTeam":
        this.setTeam(client, message.teamId);
        return;
      case "updateSheet":
        this.updateSheet(client, message.sheet);
        return;
      case "updateSettings":
        this.updateSettings(client, message.settings);
        return;
      case "substitute":
        this.queueSubstitution(client, message.outId, message.inId);
        return;
      case "pauseMatch":
        this.pauseMatch(client);
        return;
      case "resumeMatch":
        this.resumeMatch(client);
        return;
      case "prepareNextLeg":
        this.prepareNextLeg(client);
        return;
      case "leaveRoom":
        this.leaveRoom(client);
        return;
      case "resync":
        this.resync(client);
        return;
      default:
        return;
    }
  }

  onBinaryMessage(client: ClientConnection, data: Uint8Array): void {
    const decoded = decodeClientBinaryMessage(data);
    if (decoded === null) {
      client.close(CLOSE_CODES.BAD_MESSAGE, "bad binary message");
      return;
    }
    if (decoded.kind === "input") {
      this.handleInput(client, decoded.frame);
      return;
    }
    const room = this.membership.get(client.token);
    if (room === undefined || room.match === null) {
      return;
    }
    const seat = this.findSeat(room, client.token);
    if (seat === null) {
      return;
    }
    if (
      room.match.snapshots.has(decoded.seq) &&
      decoded.seq > seat.lastAckedSeq
    ) {
      seat.lastAckedSeq = decoded.seq;
    }
  }

  onDisconnect(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    if (room === undefined) {
      return;
    }
    const seat = this.findSeat(room, client.token);
    if (seat === null || seat.client !== client) {
      return;
    }

    seat.client = null;
    seat.reconnectDeadlineMs = Date.now() + this.reconnectGraceMs;
    this.scheduleReconnectTimer(room, seat);
    this.logger.info(
      `Room ${room.code}: ${seat.name} disconnected; holding seat for ${Math.round(
        this.reconnectGraceMs / 1_000,
      )}s`,
    );

    if (room.match !== null) {
      room.phase = "paused";
      room.pauseDeadlineMs = this.earliestReconnectDeadline(room);
      this.sendToOtherSeat(room, seat, {
        t: "matchPaused",
        reason: MATCH_PAUSE_REASON,
        reconnectSeconds: Math.ceil(this.reconnectGraceMs / 1_000),
        manual: false,
      });
    }

    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  /** Advance all live matches. Called by the server loop, never by transport. */
  tick(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }
    const dt = Math.min(
      dtSeconds,
      TUNING.presentation.maxFrameDeltaSeconds,
    );

    for (const room of this.rooms.values()) {
      const match = room.match;
      if (match === null || room.phase !== "live") {
        continue;
      }

      match.accumulator += dt;
      let steps = 0;

      while (
        !match.finished &&
        match.accumulator >= TICK_SECONDS &&
        steps < TUNING.sim.maxCatchUpTicks
      ) {
        this.flushPendingSubstitutions(room);
        if (isRefereePlayable(match.state)) {
          this.prepareControls(match);
        }
        stepMatch(match.state);
        this.syncMatchNotifications(room);
        match.accumulator -= TICK_SECONDS;
        steps += 1;

        const finished = match.state.referee.phase === "fullTime";
        if (finished) {
          match.finished = true;
        }
        if (
          finished ||
          match.state.tick % SNAPSHOT_EVERY_TICKS === 0
        ) {
          this.broadcastSnapshot(room);
        }
      }

      if (steps === TUNING.sim.maxCatchUpTicks) {
        match.accumulator = 0;
      }
    }
  }

  /** Latest authoritative snapshot window for a room, newest frames last. */
  exportReplay(code: string): ReplayExport | null {
    const room = this.rooms.get(normalizeRoomCode(code));
    if (room === undefined || room.match === null) {
      return null;
    }
    const frames = [...room.match.snapshots.values()].sort(
      (a, b) => a.seq - b.seq,
    );
    if (frames.length === 0) {
      return null;
    }
    return {
      code: room.code,
      generatedAtMs: Date.now(),
      setup: room.match.setup,
      frames,
    };
  }

  exportReplayClip(code: string, clipId: string): ReplayExport | null {
    const room = this.rooms.get(normalizeRoomCode(code));
    const clip = room?.replayClips.get(clipId);
    if (room === null || room === undefined || clip === undefined) {
      return null;
    }
    return {
      code: room.code,
      generatedAtMs: Date.now(),
      setup: clip.setup,
      frames: clip.frames,
      id: clip.id,
      kind: "goal",
      scoreHome: clip.scoreHome,
      scoreAway: clip.scoreAway,
    };
  }

  close(): void {
    for (const room of this.rooms.values()) {
      this.clearSeatTimer(room.host);
      this.clearSeatTimer(room.guest);
    }
    this.rooms.clear();
    this.membership.clear();
  }

  private createRoom(client: ClientConnection): void {
    if (this.membership.has(client.token)) {
      this.sendError(client, "already_in_room", "You are already in a room");
      return;
    }

    const code = this.generateCode();
    const host = this.createSeat(client, true);
    if (host === null) {
      this.sendError(client, "room_unavailable", "Could not create a room");
      return;
    }
    this.assignTeam(host, new Set());
    const room: Room = {
      code,
      host,
      guest: null,
      match: null,
      phase: "waiting",
      manualPaused: false,
      pauseDeadlineMs: null,
      settings: { ...DEFAULT_MATCH_SETTINGS },
      series: null,
      replayClips: new Map(),
      replayClipSeq: 0,
    };
    this.rooms.set(code, room);
    this.membership.set(client.token, room);
    this.logger.info(`Room ${code} created`);
    try {
      this.onRoomCreated(code);
    } catch (error) {
      this.logger.error("Room-created callback failed", error);
    }
    this.broadcastLobby(room);
  }

  private joinRoom(client: ClientConnection, rawCode: string): void {
    if (this.membership.has(client.token)) {
      this.sendError(client, "already_in_room", "You are already in a room");
      return;
    }
    const code = normalizeRoomCode(rawCode);
    if (!isRoomCode(code)) {
      this.sendError(client, "room_not_found", "Room code must be 4 letters");
      return;
    }
    const room = this.rooms.get(code);
    if (room === undefined) {
      this.sendError(client, "room_not_found", `Room ${code} does not exist`);
      return;
    }
    if (room.guest !== null) {
      this.sendError(client, "room_full", `Room ${code} is full`);
      return;
    }
    if (room.host === null || room.host.client === null) {
      this.sendError(
        client,
        "room_unavailable",
        "The host is not connected right now",
      );
      return;
    }

    const guest = this.createSeat(client, false);
    if (guest === null) {
      this.sendError(client, "room_unavailable", "Could not join the room");
      return;
    }
    room.guest = guest;
    this.assignTeam(
      guest,
      new Set(
        [room.host?.teamId, room.guest?.teamId].filter(
          (id): id is string => typeof id === "string",
        ),
      ),
    );
    this.membership.set(client.token, room);
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private setReady(client: ClientConnection, ready: boolean): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === null || room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before readying up");
      return;
    }
    if (room.match !== null) {
      this.sendError(client, "room_unavailable", "The match already started");
      return;
    }
    if (ready) {
      const errors = this.validateSeatSheet(seat);
      if (errors.length > 0) {
        this.sendError(client, "invalid_sheet", errors.join("; "));
        return;
      }
    }

    seat.ready = ready;
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
    this.maybeStartMatch(room);
  }

  private setTeam(client: ClientConnection, teamId: string): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before choosing a team");
      return;
    }
    if (room.match !== null) {
      this.sendError(client, "room_unavailable", "The match already started");
      return;
    }
    if (this.registry.getTeam(teamId) === null) {
      this.sendError(client, "invalid_team", `Unknown team ${teamId}`);
      return;
    }
    const other = this.seats(room).find((candidate) => candidate !== seat);
    if (other?.teamId === teamId) {
      this.sendError(client, "invalid_team", "That team is already selected");
      return;
    }

    seat.teamId = teamId;
    seat.sheet = this.registry.getDefaultSheet(teamId);
    seat.ready = false;
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private updateSheet(client: ClientConnection, sheet: TeamSheet): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before editing a team");
      return;
    }
    if (room.match !== null) {
      this.sendError(client, "room_unavailable", "The match already started");
      return;
    }
    if (seat.teamId === null) {
      this.sendError(client, "invalid_team", "Choose a team first");
      return;
    }
    const errors = this.registry.validateSheet(seat.teamId, sheet);
    if (errors.length > 0) {
      this.sendError(client, "invalid_sheet", errors.join("; "));
      return;
    }

    seat.sheet = sheet;
    seat.ready = false;
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private updateSettings(
    client: ClientConnection,
    settings: MatchSettingsWire,
  ): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before changing settings");
      return;
    }
    if (!seat.host) {
      this.sendError(client, "not_host", "The host controls match settings");
      return;
    }
    if (room.match !== null) {
      this.sendError(client, "room_unavailable", "The match already started");
      return;
    }
    room.settings = { ...settings };
    for (const player of this.seats(room)) {
      player.ready = false;
    }
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private pauseMatch(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before pausing");
      return;
    }
    if (room.match === null || room.match.finished) {
      this.sendError(client, "match_not_live", "There is no live match to pause");
      return;
    }
    if (!this.bothConnected(room)) {
      this.sendError(
        client,
        "room_unavailable",
        "Both players must be connected to pause",
      );
      return;
    }
    if (room.manualPaused) {
      return;
    }

    room.manualPaused = true;
    room.phase = "paused";
    room.pauseDeadlineMs = null;
    room.match.accumulator = 0;
    markControlReconnected(room.match.controls.home);
    markControlReconnected(room.match.controls.away);
    this.broadcast(room, {
      t: "matchPaused",
      reason: MANUAL_PAUSE_REASON,
      reconnectSeconds: 0,
      manual: true,
    });
    this.broadcastLobby(room);
    this.logger.info(
      `Room ${room.code}: ${seat.host ? "host" : "guest"} paused the match`,
    );
  }

  private resumeMatch(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before resuming");
      return;
    }
    if (room.match === null || room.match.finished || !room.manualPaused) {
      this.sendError(
        client,
        "match_not_live",
        "The match is not manually paused",
      );
      return;
    }
    if (!this.bothConnected(room)) {
      this.sendError(
        client,
        "room_unavailable",
        "Both players must be connected to resume",
      );
      return;
    }

    room.manualPaused = false;
    room.phase = "live";
    room.pauseDeadlineMs = null;
    markControlReconnected(room.match.controls.home);
    markControlReconnected(room.match.controls.away);
    this.broadcast(room, { t: "matchResumed" });
    this.broadcastLobby(room);
    this.logger.info(
      `Room ${room.code}: ${seat.host ? "host" : "guest"} resumed the match`,
    );
  }

  private prepareNextLeg(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null) {
      this.sendError(client, "not_in_room", "Join a room before preparing");
      return;
    }
    if (!seat.host) {
      this.sendError(client, "not_host", "Only the host can prepare the next leg");
      return;
    }
    const series = room.series;
    if (
      room.match === null ||
      !room.match.finished ||
      series === null ||
      series.scores.length !== 1
    ) {
      this.sendError(
        client,
        "match_not_live",
        "There is no completed first leg to prepare",
      );
      return;
    }
    const suspendedHome = series.suspended.home.size;
    const suspendedAway = series.suspended.away.size;
    this.broadcast(room, {
      t: "matchEnded",
      message:
        suspendedHome + suspendedAway === 0
          ? "Adjust your lineups, then both players ready up for the second leg."
          : `Suspensions carried: ${suspendedHome} home, ${suspendedAway} away. Adjust lineups, then ready up.`,
      suspendedHome,
      suspendedAway,
    });
    this.stopMatch(room, true);
    for (const player of this.seats(room)) {
      player.ready = false;
    }
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
    this.logger.info(`Room ${room.code}: preparing the second leg`);
  }

  private queueSubstitution(
    client: ClientConnection,
    outId: string,
    inId: string,
  ): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || seat === null || room.match === null) {
      this.sendError(client, "not_in_room", "No active match to change");
      return;
    }
    if (room.match.finished || room.match.state.referee.phase === "fullTime") {
      this.sendError(client, "match_not_live", "The match is complete");
      return;
    }
    const team =
      seat.team === "home"
        ? room.match.state.home
        : room.match.state.away;
    const outgoing = team.players.find((player) => player.id === outId);
    const incoming = team.bench.find(
      (substitute) => substitute.player.id === inId,
    );
    if (outgoing === undefined || incoming === undefined) {
      this.sendError(
        client,
        "invalid_substitution",
        "Choose an active player and an unused substitute",
      );
      return;
    }
    if (
      seat.pendingSubstitutions.some(
        (change) => change.inId === inId || change.outId === outId,
      )
    ) {
      this.sendError(
        client,
        "invalid_substitution",
        "That substitution is already queued",
      );
      return;
    }
    seat.pendingSubstitutions.push({ outId, inId });
    client.send({
      t: "substitution",
      status: "queued",
      message: `${outgoing.name} → ${incoming.player.name}`,
    });
    this.flushPendingSubstitutions(room);
  }

  private flushPendingSubstitutions(room: Room): void {
    const match = room.match;
    if (match === null || !substitutionsAllowed(match.state)) {
      return;
    }
    for (const seat of this.seats(room)) {
      if (seat.pendingSubstitutions.length === 0) {
        continue;
      }
      const changes = seat.pendingSubstitutions;
      const result = substitutePlayers(match.state, seat.team, changes);
      if (!result.ok) {
        seat.pendingSubstitutions = [];
        seat.client?.send({
          t: "substitution",
          status: "rejected",
          message: result.reason ?? "Substitution rejected",
        });
        continue;
      }
      seat.pendingSubstitutions = [];
      seat.client?.send({
        t: "substitution",
        status: "applied",
        message: `${result.applied} substitution${
          result.applied === 1 ? "" : "s"
        } applied`,
      });
      this.broadcastRoster(room, seat.team);
    }
  }

  private broadcastRoster(
    room: Room,
    side: WireTeamSide,
  ): void {
    const match = room.match;
    if (match === null) {
      return;
    }
    const team = side === "home" ? match.state.home : match.state.away;
    const roster = buildWireRoster(team);
    this.broadcast(room, {
      t: "roster",
      side,
      players: roster.players,
      bench: roster.bench,
    });
  }

  private sendRoster(
    client: ClientConnection,
    room: Room,
    side: WireTeamSide,
  ): void {
    const match = room.match;
    if (match === null) {
      return;
    }
    const team = side === "home" ? match.state.home : match.state.away;
    const roster = buildWireRoster(team);
    client.send({
      t: "roster",
      side,
      players: roster.players,
      bench: roster.bench,
    });
  }

  private syncMatchNotifications(room: Room): void {
    const match = room.match;
    if (match === null) {
      return;
    }
    const review = match.state.referee.varReview;
    const varSignature =
      review === null ? null : `${review.kind}:${review.decision}`;
    if (varSignature !== match.lastVarSignature) {
      match.lastVarSignature = varSignature;
      this.broadcast(room, {
        t: "varReview",
        review:
          review === null
            ? null
            : {
                kind: review.kind,
                side: review.side,
                decision: review.decision,
              },
      });
    }
    const shootout = buildShootoutWire(match.state);
    const shootoutSignature =
      shootout === null
        ? null
        : `${shootout.index}:${shootout.homeScore}:${shootout.awayScore}:${
            shootout.winner ?? "-"
          }`;
    if (shootoutSignature !== match.lastShootoutSignature) {
      match.lastShootoutSignature = shootoutSignature;
      this.broadcast(room, { t: "shootout", shootout });
    }
    if (
      match.state.referee.phase === "fullTime" &&
      !match.resultSent
    ) {
      match.resultSent = true;
      this.recordSeriesLeg(room, match.state);
      this.broadcast(room, {
        t: "matchStats",
        stats: buildMatchStats(match.state, this.seriesWire(room)),
      });
    }
  }

  private recordSeriesLeg(room: Room, state: MatchState): void {
    const series = room.series;
    if (series === null || series.scores.length >= series.legs) {
      return;
    }
    const firstLeg = series.scores.length === 0;
    series.scores.push({
      home: state.referee.scoreHome,
      away: state.referee.scoreAway,
    });
    if (firstLeg) {
      this.collectSuspended(
        state.home.players,
        "home",
        series.suspended.home,
      );
      this.collectSuspended(
        state.away.players,
        "away",
        series.suspended.away,
      );
    }
  }

  private collectSuspended(
    players: MatchState["home"]["players"],
    side: WireTeamSide,
    target: Set<string>,
  ): void {
    const prefix = `${side}:`;
    for (const player of players) {
      if (player.sentOff) {
        target.add(
          player.id.startsWith(prefix)
            ? player.id.slice(prefix.length)
            : player.id,
        );
      }
    }
  }

  private seriesWire(room: Room): WireTieSeries | null {
    const series = room.series;
    if (series === null || series.scores.length === 0) {
      return null;
    }
    const homeAggregate = series.scores.reduce(
      (total, score) => total + score.home,
      0,
    );
    const awayAggregate = series.scores.reduce(
      (total, score) => total + score.away,
      0,
    );
    const complete = series.scores.length >= series.legs;
    return {
      legs: series.legs,
      leg: complete ? 2 : 1,
      complete,
      homeAggregate,
      awayAggregate,
      winner: !complete
        ? null
        : homeAggregate === awayAggregate
          ? null
          : homeAggregate > awayAggregate
            ? "home"
            : "away",
    };
  }

  private leaveRoom(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    if (room === undefined) {
      this.sendIdle(client);
      return;
    }
    const seat = this.findSeat(room, client.token);
    if (seat === null) {
      this.membership.delete(client.token);
      this.sendIdle(client);
      return;
    }

    this.clearReconnectTimer(seat);
    this.membership.delete(client.token);

    if (seat.host) {
      this.closeRoom(room, "Host left the room");
      return;
    }

    room.guest = null;
    this.stopMatch(room);
    if (room.host !== null) {
      room.host.ready = false;
    }
    this.refreshLobbyPhase(room);
    this.sendIdle(client);
    this.broadcastLobby(room);
  }

  private resync(client: ClientConnection): void {
    const room = this.membership.get(client.token);
    const seat = room === undefined ? null : this.findSeat(room, client.token);
    if (room === undefined || room === null || seat === null) {
      this.sendError(client, "not_in_room", "No active match to resync");
      return;
    }
    if (room.match === null) {
      this.sendError(client, "room_unavailable", "No active match to resync");
      return;
    }
    this.sendSetupAndSnapshot(room, seat);
  }

  private handleInput(
    client: ClientConnection,
    frame: Parameters<typeof updateControlInput>[1],
  ): void {
    const room = this.membership.get(client.token);
    if (
      room === undefined ||
      room.match === null ||
      room.match.finished ||
      !isRefereePlayable(room.match.state) ||
      room.phase !== "live"
    ) {
      return;
    }
    const seat = this.findSeat(room, client.token);
    if (seat === null) {
      return;
    }
    const control =
      seat.team === "home"
        ? room.match.controls.home
        : room.match.controls.away;
    updateControlInput(control, frame, Date.now());
  }

  private prepareControls(match: RoomMatch): void {
    prepareTeamControl(match.state, "home", match.controls.home, TICK_SECONDS);
    prepareTeamControl(match.state, "away", match.controls.away, TICK_SECONDS);
  }

  private createSeat(
    client: ClientConnection,
    host: boolean,
  ): Seat | null {
    return {
      token: client.token,
      pendingSubstitutions: [],
      host,
      name: host ? HOST_NAME : GUEST_NAME,
      team: host ? "home" : "away",
      teamId: null,
      sheet: null,
      ready: false,
      client,
      reconnectTimer: null,
      reconnectDeadlineMs: null,
      lastAckedSeq: 0,
      forceFullSnapshot: true,
    };
  }

  private maybeStartMatch(room: Room): void {
    if (room.match !== null) {
      return;
    }
    if (
      room.host !== null &&
      room.guest !== null &&
      room.host.client !== null &&
      room.guest.client !== null &&
      room.host.ready &&
      room.guest.ready &&
      room.host.teamId !== null &&
      room.host.sheet !== null &&
      room.guest.teamId !== null &&
      room.guest.sheet !== null
    ) {
      this.startMatch(room);
    }
  }

  /**
   * Rebuild a lineup only when a red card has removed someone from leg two.
   * Keeping the original sheet when nobody is suspended preserves the user's
   * curated XI and bench.
   */
  private sheetForLeg(
    sheet: TeamSheet,
    teamId: string,
    series: RoomSeries | null,
    side: WireTeamSide,
  ): TeamSheet {
    if (series === null || series.scores.length !== 1) {
      return sheet;
    }
    const suspended = series.suspended[side];
    if (suspended.size === 0) {
      return sheet;
    }
    try {
      return applySuspensionsToSheet(
        sheet,
        this.registry.getPlayers(teamId),
        suspended,
      );
    } catch (error) {
      this.logger.warn(
        `Could not apply suspensions for ${teamId}`,
        error,
      );
      return sheet;
    }
  }

  private startMatch(room: Room): void {
    const host = room.host;
    const guest = room.guest;
    if (
      host === null ||
      guest === null ||
      host.teamId === null ||
      host.sheet === null ||
      guest.teamId === null ||
      guest.sheet === null
    ) {
      return;
    }
    const hostTeam = this.registry.getTeam(host.teamId);
    const guestTeam = this.registry.getTeam(guest.teamId);
    if (hostTeam === null || guestTeam === null) {
      this.failMatchStart(room, "Selected team is no longer available");
      return;
    }
    if (room.series === null && room.settings.tieLegs === 2) {
      room.series = {
        legs: 2,
        scores: [],
        suspended: { home: new Set(), away: new Set() },
      };
    }
    if (room.series !== null && room.series.scores.length >= 2) {
      return;
    }
    const baseRules = rulesFromSettings(room.settings);
    const rules =
      room.series === null
        ? baseRules
        : {
            ...baseRules,
            // A two-legged tie is decided across both legs; a knockout finish
            // inside one leg would make the aggregate ambiguous.
            extraTimeEnabled: false,
            shootoutEnabled: false,
          };
    try {
      const serverMatch = createServerMatch({
        rules,
        home: {
          team: hostTeam,
          sheet: this.sheetForLeg(host.sheet, hostTeam.id, room.series, "home"),
          players: this.registry.getPlayers(hostTeam.id),
        },
        away: {
          team: guestTeam,
          sheet: this.sheetForLeg(guest.sheet, guestTeam.id, room.series, "away"),
          players: this.registry.getPlayers(guestTeam.id),
        },
      });
      this.installMatch(room, serverMatch);
    } catch (error) {
      this.logger.error("Could not build the selected match", error);
      this.failMatchStart(
        room,
        error instanceof Error ? error.message : "Could not build the match",
      );
    }
  }

  private installMatch(
    room: Room,
    serverMatch: ReturnType<typeof createServerMatch>,
  ): void {
    room.match = {
      setup: serverMatch.setup,
      state: serverMatch.state,
      snapshotSeq: 0,
      snapshots: new Map(),
      accumulator: 0,
      finished: false,
      resultSent: false,
      lastVarSignature: null,
      lastShootoutSignature: null,
      lastScoreHome: 0,
      lastScoreAway: 0,
      goalCapture: null,
      controls: {
        home: createTeamControlRuntime(),
        away: createTeamControlRuntime(),
      },
    };
    room.phase = "live";
    room.manualPaused = false;
    room.pauseDeadlineMs = null;

    for (const seat of this.seats(room)) {
      seat.lastAckedSeq = 0;
      seat.forceFullSnapshot = true;
      seat.pendingSubstitutions = [];
    }

    this.prepareControls(room.match);
    this.broadcastLobby(room);
    for (const seat of this.seats(room)) {
      if (seat.client !== null) {
        seat.client.send({ t: "matchStart", setup: serverMatch.setup });
      }
    }
    this.broadcastSnapshot(room);
    this.logger.info(`Room ${room.code} started a match`);
  }

  private failMatchStart(room: Room, message: string): void {
    room.match = null;
    for (const seat of this.seats(room)) {
      seat.ready = false;
      if (seat.client !== null) {
        this.sendError(seat.client, "invalid_sheet", message);
      }
    }
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private assignTeam(seat: Seat, excluded: ReadonlySet<string>): void {
    const available = this.registry.teams.filter(
      (item) => !excluded.has(item.id),
    );
    const team =
      available.find((item) => item.kind === "club") ?? available[0];
    if (team === undefined) {
      seat.teamId = null;
      seat.sheet = null;
      return;
    }
    seat.teamId = team.id;
    seat.sheet = this.registry.getDefaultSheet(team.id);
  }

  private validateSeatSheet(seat: Seat): readonly string[] {
    if (seat.teamId === null) {
      return ["Choose a team first"];
    }
    if (seat.sheet === null) {
      return ["Generate a team sheet first"];
    }
    return this.registry.validateSheet(seat.teamId, seat.sheet);
  }

  private stopMatch(room: Room, preserveSeries = false): void {
    room.match = null;
    room.phase = "waiting";
    room.manualPaused = false;
    room.pauseDeadlineMs = null;
    if (!preserveSeries) {
      room.series = null;
    }
  }

  private trackGoalReplay(room: Room, frame: SnapshotFrame): void {
    const match = room.match;
    if (match === null) {
      return;
    }
    const scored =
      frame.match.scoreHome > match.lastScoreHome ||
      frame.match.scoreAway > match.lastScoreAway;
    match.lastScoreHome = frame.match.scoreHome;
    match.lastScoreAway = frame.match.scoreAway;

    if (scored) {
      if (match.goalCapture !== null) {
        this.commitGoalReplay(room, match);
      }
      room.replayClipSeq += 1;
      match.goalCapture = beginGoalReplay(
        `g${room.replayClipSeq}`,
        [...match.snapshots.values()],
        Date.now(),
      );
      if (match.finished) {
        this.commitGoalReplay(room, match);
      }
      return;
    }

    if (match.goalCapture !== null) {
      const clip = advanceGoalReplay(match.goalCapture, frame);
      if (clip !== null) {
        const stored = { ...clip, setup: match.setup };
        room.replayClips.set(clip.id, stored);
        match.goalCapture = null;
        this.pruneReplayClips(room);
        this.broadcastReplayClips(room);
      }
    }
    if (match.finished && match.goalCapture !== null) {
      this.commitGoalReplay(room, match);
    }
  }

  private commitGoalReplay(room: Room, match: RoomMatch): void {
    if (match.goalCapture === null) {
      return;
    }
    const clip = { ...finishGoalReplay(match.goalCapture), setup: match.setup };
    match.goalCapture = null;
    room.replayClips.set(clip.id, clip);
    this.pruneReplayClips(room);
    this.broadcastReplayClips(room);
  }

  private pruneReplayClips(room: Room): void {
    while (room.replayClips.size > TUNING.network.goalReplayClipLimit) {
      const oldest = room.replayClips.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      room.replayClips.delete(oldest);
    }
  }

  private sendReplayClips(
    client: ClientConnection,
    room: Room,
  ): void {
    client.send({
      t: "replayClips",
      clips: [...room.replayClips.values()].map((clip) => ({
        id: clip.id,
        kind: "goal" as const,
        scoreHome: clip.scoreHome,
        scoreAway: clip.scoreAway,
        clockSeconds: clip.clockSeconds,
        half: clip.half,
        createdAtMs: clip.createdAtMs,
        frameCount: clip.frames.length,
      })),
    });
  }

  private broadcastReplayClips(room: Room): void {
    for (const seat of this.seats(room)) {
      if (seat.client !== null) {
        this.sendReplayClips(seat.client, room);
      }
    }
  }

  private broadcastSnapshot(room: Room): void {
    const match = room.match;
    if (match === null) {
      return;
    }
    match.snapshotSeq += 1;
    const frame = buildSnapshotFrame(
      match.state,
      match.snapshotSeq,
      controlSnapshotIndices(
        match.state,
        match.controls.home,
        match.controls.away,
      ),
    );
    match.snapshots.set(frame.seq, frame);
    this.pruneSnapshots(match);

    for (const seat of this.seats(room)) {
      if (seat.client === null) {
        continue;
      }
      const baseline =
        seat.forceFullSnapshot || seat.lastAckedSeq === 0
          ? null
          : match.snapshots.get(seat.lastAckedSeq) ?? null;
      seat.forceFullSnapshot = false;
      try {
        seat.client.sendBinary(encodeSnapshot(frame, baseline));
      } catch (error) {
        this.logger.warn("Failed to encode/send snapshot", error);
      }
    }
    this.trackGoalReplay(room, frame);
  }

  private sendSetupAndSnapshot(room: Room, seat: Seat): void {
    if (room.match === null || seat.client === null) {
      return;
    }
    seat.lastAckedSeq = 0;
    seat.forceFullSnapshot = true;
    seat.client.send({ t: "matchStart", setup: room.match.setup });
    // The immutable setup carries the starting XI; reconnect must also learn
    // about substitutions already made while the client was away.
    this.sendRoster(seat.client, room, "home");
    this.sendRoster(seat.client, room, "away");
    if (room.replayClips.size > 0) {
      this.sendReplayClips(seat.client, room);
    }
    const review = room.match.state.referee.varReview;
    if (review !== null) {
      seat.client.send({
        t: "varReview",
        review: {
          kind: review.kind,
          side: review.side,
          decision: review.decision,
        },
      });
    }
    const shootout = buildShootoutWire(room.match.state);
    if (shootout !== null) {
      seat.client.send({ t: "shootout", shootout });
    }
    if (room.match.state.referee.phase === "fullTime") {
      seat.client.send({
        t: "matchStats",
        stats: buildMatchStats(room.match.state, this.seriesWire(room)),
      });
    }

    room.match.snapshotSeq += 1;
    const frame = buildSnapshotFrame(
      room.match.state,
      room.match.snapshotSeq,
      controlSnapshotIndices(
        room.match.state,
        room.match.controls.home,
        room.match.controls.away,
      ),
    );
    room.match.snapshots.set(frame.seq, frame);
    this.pruneSnapshots(room.match);
    seat.client.sendBinary(encodeSnapshot(frame, null));
    seat.forceFullSnapshot = false;
  }

  private pruneSnapshots(match: RoomMatch): void {
    while (match.snapshots.size > TUNING.network.snapshotHistorySize) {
      const oldest = match.snapshots.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      match.snapshots.delete(oldest);
    }
  }

  private broadcastLobby(room: Room): void {
    for (const seat of this.seats(room)) {
      if (seat.client !== null) {
        this.sendLobbyState(room, seat);
      }
    }
  }

  private broadcast(room: Room, message: ServerMessage): void {
    for (const seat of this.seats(room)) {
      seat.client?.send(message);
    }
  }

  private sendLobbyState(room: Room, seat: Seat): void {
    seat.client?.send({
      t: "lobbyState",
      room: this.buildLobbyRoom(room),
      you: this.buildLobbyYou(seat),
    });
  }

  private buildLobbyRoom(room: Room): LobbyRoomWire {
    const phase = this.currentPhase(room);
    room.phase = phase;
    const players: LobbyPlayerWire[] = [];
    for (const seat of this.seats(room)) {
      players.push({
        seat: seat.host ? 0 : 1,
        name: seat.name,
        team: seat.team,
        ready: seat.ready,
        connected: seat.client !== null,
        host: seat.host,
        teamId: seat.teamId,
        sheet: seat.sheet,
      });
    }
    return {
      code: room.code,
      phase,
      players,
      reconnectSeconds:
        phase === "paused" && room.pauseDeadlineMs !== null
          ? Math.max(
              0,
              Math.ceil((room.pauseDeadlineMs - Date.now()) / 1_000),
            )
          : null,
      settings: room.settings,
    };
  }

  private buildLobbyYou(seat: Seat): LobbyYouWire {
    return {
      seat: seat.host ? 0 : 1,
      team: seat.team,
      host: seat.host,
      ready: seat.ready,
      teamId: seat.teamId,
    };
  }

  private currentPhase(room: Room): LobbyPhase {
    if (room.match !== null) {
      return room.phase === "paused" ? "paused" : "live";
    }
    const host = room.host;
    const guest = room.guest;
    return host !== null &&
      guest !== null &&
      host.client !== null &&
      guest.client !== null &&
      host.ready &&
      guest.ready
      ? "ready"
      : "waiting";
  }

  private refreshLobbyPhase(room: Room): void {
    if (room.match === null) {
      room.phase = this.currentPhase(room);
    }
  }

  private scheduleReconnectTimer(room: Room, seat: Seat): void {
    this.clearReconnectTimer(seat);
    seat.reconnectTimer = setTimeout(() => {
      seat.reconnectTimer = null;
      if (seat.client === null) {
        this.expireSeat(room, seat);
      }
    }, this.reconnectGraceMs);
    seat.reconnectTimer.unref();
  }

  private expireSeat(room: Room, seat: Seat): void {
    if (seat.client !== null) {
      return;
    }
    this.membership.delete(seat.token);
    this.clearSeatTimer(seat);
    room.pauseDeadlineMs = null;
    this.logger.info(`Room ${room.code}: ${seat.name} reconnect window expired`);

    if (seat.host) {
      this.closeRoom(room, "Host did not reconnect");
      return;
    }

    room.guest = null;
    this.stopMatch(room);
    if (room.host !== null) {
      room.host.ready = false;
    }
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
  }

  private closeRoom(room: Room, reason: string): void {
    this.rooms.delete(room.code);
    for (const seat of this.seats(room)) {
      this.clearSeatTimer(seat);
      this.membership.delete(seat.token);
      seat.client?.send({ t: "roomClosed", reason });
      seat.client?.send({ t: "lobbyState", room: null, you: null });
      seat.client = null;
    }
    room.match = null;
  }

  private sendToOtherSeat(
    room: Room,
    seat: Seat,
    message: {
      readonly t: "matchPaused";
      readonly reason: string;
      readonly reconnectSeconds: number;
      readonly manual: boolean;
    },
  ): void {
    for (const other of this.seats(room)) {
      if (other !== seat && other.client !== null) {
        other.client.send(message);
      }
    }
  }

  private sendIdle(client: ClientConnection): void {
    client.send({ t: "lobbyState", room: null, you: null });
  }

  private sendError(
    client: ClientConnection,
    code: ServerErrorCode,
    message: string,
  ): void {
    client.send({ t: "error", code, message });
  }

  private findSeat(room: Room, token: string): Seat | null {
    if (room.host?.token === token) {
      return room.host;
    }
    if (room.guest?.token === token) {
      return room.guest;
    }
    return null;
  }

  private seats(room: Room): Seat[] {
    const seats: Seat[] = [];
    if (room.host !== null) {
      seats.push(room.host);
    }
    if (room.guest !== null) {
      seats.push(room.guest);
    }
    return seats;
  }

  private bothConnected(room: Room): boolean {
    return (
      room.host !== null &&
      room.guest !== null &&
      room.host.client !== null &&
      room.guest.client !== null
    );
  }

  private earliestReconnectDeadline(room: Room): number | null {
    let earliest: number | null = null;
    for (const seat of this.seats(room)) {
      if (
        seat.client === null &&
        seat.reconnectDeadlineMs !== null &&
        (earliest === null || seat.reconnectDeadlineMs < earliest)
      ) {
        earliest = seat.reconnectDeadlineMs;
      }
    }
    return earliest;
  }

  private clearReconnectTimer(seat: Seat): void {
    if (seat.reconnectTimer !== null) {
      clearTimeout(seat.reconnectTimer);
      seat.reconnectTimer = null;
    }
  }

  private clearSeatTimer(seat: Seat | null): void {
    if (seat !== null) {
      this.clearReconnectTimer(seat);
    }
  }

  private randomCode(): string {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      let code = "";
      for (let index = 0; index < 4; index += 1) {
        code += String.fromCharCode(65 + randomInt(0, 26));
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error("Unable to allocate a unique room code");
  }
}
