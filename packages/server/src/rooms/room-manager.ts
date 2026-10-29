// packages/server/src/rooms/room-manager.ts
import { randomInt } from "node:crypto";
import {
  CLOSE_CODES,
  TUNING,
  decodeClientBinaryMessage,
  encodeSnapshot,
  isRoomCode,
  normalizeRoomCode,
  type ClientMessage,
  type LobbyPhase,
  type LobbyPlayerWire,
  type LobbyRoomWire,
  type LobbyYouWire,
  type MatchSetupWire,
  type ServerErrorCode,
  type SnapshotFrame,
  type WireTeamSide,
} from "@fb/shared";
import {
  isRefereePlayable,
  stepMatch,
  type MatchState,
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
import type { Logger } from "../create-server";
import {
  buildSnapshotFrame,
  createServerMatch,
} from "./match-stream";

const TICK_SECONDS = 1 / TUNING.sim.tickHz;
const SNAPSHOT_EVERY_TICKS = Math.max(
  1,
  Math.round(TUNING.sim.tickHz / TUNING.network.snapshotHz),
);
const MATCH_PAUSE_REASON = "Opponent disconnected";
const HOST_NAME = "Host";
const GUEST_NAME = "Guest";

interface Seat {
  readonly token: string;
  readonly host: boolean;
  readonly name: string;
  readonly team: WireTeamSide;
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
  readonly controls: {
    readonly home: TeamControlRuntime;
    readonly away: TeamControlRuntime;
  };
}

interface Room {
  readonly code: string;
  host: Seat | null;
  guest: Seat | null;
  match: RoomMatch | null;
  phase: LobbyPhase;
  pauseDeadlineMs: number | null;
}

export interface RoomManagerOptions {
  readonly logger: Logger;
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
  private readonly reconnectGraceMs: number;
  private readonly generateCode: () => string;
  private readonly onRoomCreated: (code: string) => void;

  constructor(options: RoomManagerOptions) {
    this.logger = options.logger;
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
        room.phase = "live";
        room.pauseDeadlineMs = null;
      } else {
        room.pauseDeadlineMs = this.earliestReconnectDeadline(room);
      }

      this.sendSetupAndSnapshot(room, seat);
      if (both && wasPaused) {
        this.broadcast(room, { t: "matchResumed" });
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
        if (isRefereePlayable(match.state)) {
          this.prepareControls(match);
        }
        stepMatch(match.state);
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
    const room: Room = {
      code,
      host,
      guest: null,
      match: null,
      phase: "waiting",
      pauseDeadlineMs: null,
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

    seat.ready = ready;
    this.refreshLobbyPhase(room);
    this.broadcastLobby(room);
    this.maybeStartMatch(room);
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
      host,
      name: host ? HOST_NAME : GUEST_NAME,
      team: host ? "home" : "away",
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
      room.guest.ready
    ) {
      this.startMatch(room);
    }
  }

  private startMatch(room: Room): void {
    const serverMatch = createServerMatch();
    room.match = {
      setup: serverMatch.setup,
      state: serverMatch.state,
      snapshotSeq: 0,
      snapshots: new Map(),
      accumulator: 0,
      finished: false,
      controls: {
        home: createTeamControlRuntime(),
        away: createTeamControlRuntime(),
      },
    };
    room.phase = "live";
    room.pauseDeadlineMs = null;

    for (const seat of this.seats(room)) {
      seat.lastAckedSeq = 0;
      seat.forceFullSnapshot = true;
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

  private stopMatch(room: Room): void {
    room.match = null;
    room.phase = "waiting";
    room.pauseDeadlineMs = null;
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
  }

  private sendSetupAndSnapshot(room: Room, seat: Seat): void {
    if (room.match === null || seat.client === null) {
      return;
    }
    seat.lastAckedSeq = 0;
    seat.forceFullSnapshot = true;
    seat.client.send({ t: "matchStart", setup: room.match.setup });

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

  private broadcast(
    room: Room,
    message: { readonly t: "matchResumed" },
  ): void {
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
    };
  }

  private buildLobbyYou(seat: Seat): LobbyYouWire {
    return {
      seat: seat.host ? 0 : 1,
      team: seat.team,
      host: seat.host,
      ready: seat.ready,
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
    message: { readonly t: "matchPaused"; readonly reason: string; readonly reconnectSeconds: number },
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
