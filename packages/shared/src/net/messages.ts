// packages/shared/src/net/messages.ts
import type { TeamSheet } from "../domain/football-data";
import { parseTeamSheet } from "../domain/team-sheet";
import { PROTOCOL_VERSION } from "../version";

/** WebSocket endpoint shared by the dev proxy, phone controller and server. */
export const WS_PATH = "/ws";

/**
 * Application close codes live in the private-use range 4000-4999.
 * Reasons stay short because the WebSocket close frame caps them at 123 bytes.
 */
export const CLOSE_CODES = {
  PROTOCOL_MISMATCH: 4001,
  BAD_MESSAGE: 4002,
  HELLO_TIMEOUT: 4003,
  UNSUPPORTED_MESSAGE: 4004,
  SESSION_REPLACED: 4006,
} as const;

export const SERVER_ERROR_CODES = [
  "bad_message",
  "protocol_mismatch",
  "unsupported_message",
  "hello_timeout",
  "room_not_found",
  "room_full",
  "room_unavailable",
  "already_in_room",
  "not_in_room",
  "invalid_team",
  "invalid_sheet",
  "invalid_substitution",
  "invalid_settings",
  "not_host",
  "match_not_live",
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export const ROOM_CODE_LENGTH = 4;

export function isRoomCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === ROOM_CODE_LENGTH &&
    /^[A-Z]+$/.test(value)
  );
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface ClientHelloMessage {
  readonly t: "hello";
  readonly protocolVersion: number;
  /** Stable token from a previous welcome; enables seat/room resume. */
  readonly sessionToken?: string;
}

export interface ClientPingMessage {
  readonly t: "ping";
  /** Sender's epoch clock; echoed back to compute round-trip latency. */
  readonly clientTimeMs: number;
}

export interface ClientCreateRoomMessage {
  readonly t: "createRoom";
}

export interface ClientJoinRoomMessage {
  readonly t: "joinRoom";
  readonly code: string;
}

export interface ClientSetReadyMessage {
  readonly t: "setReady";
  readonly ready: boolean;
}

export interface ClientSetTeamMessage {
  readonly t: "setTeam";
  readonly teamId: string;
}

export interface ClientUpdateSheetMessage {
  readonly t: "updateSheet";
  readonly sheet: TeamSheet;
}

/** Host-only competition options chosen in the draft room. */
export interface MatchSettingsWire {
  /** Real-time half length in minutes: one of 4, 6, 8 or 10. */
  readonly halfRealMinutes: 4 | 6 | 8 | 10;
  readonly extraTime: boolean;
  readonly shootout: boolean;
  readonly varEnabled: boolean;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettingsWire = {
  halfRealMinutes: 6,
  extraTime: false,
  shootout: false,
  varEnabled: false,
};

export interface ClientUpdateSettingsMessage {
  readonly t: "updateSettings";
  readonly settings: MatchSettingsWire;
}

export interface ClientSubstituteMessage {
  readonly t: "substitute";
  /** Simulation player ID, for example `home:p17`. */
  readonly outId: string;
  readonly inId: string;
}

export interface ClientLeaveRoomMessage {
  readonly t: "leaveRoom";
}

export interface ClientResyncMessage {
  readonly t: "resync";
}

export type ClientMessage =
  | ClientHelloMessage
  | ClientPingMessage
  | ClientCreateRoomMessage
  | ClientJoinRoomMessage
  | ClientSetReadyMessage
  | ClientSetTeamMessage
  | ClientUpdateSheetMessage
  | ClientUpdateSettingsMessage
  | ClientSubstituteMessage
  | ClientLeaveRoomMessage
  | ClientResyncMessage;

export interface ServerWelcomeMessage {
  readonly t: "welcome";
  readonly protocolVersion: number;
  readonly serverVersion: string;
  /** Stable session token. Persist it and resend in hello to resume. */
  readonly sessionId: string;
  /** Server epoch clock for clock-offset estimation. */
  readonly serverTimeMs: number;
}

export interface ServerPresenceMessage {
  readonly t: "presence";
  readonly connectedClients: number;
}

export interface ServerPongMessage {
  readonly t: "pong";
  readonly clientTimeMs: number;
  readonly serverTimeMs: number;
}

export interface ServerErrorMessage {
  readonly t: "error";
  readonly code: ServerErrorCode;
  readonly message: string;
}

export type WireTeamSide = "home" | "away";

export const LOBBY_PHASES = [
  "waiting",
  "ready",
  "live",
  "paused",
] as const;

export type LobbyPhase = (typeof LOBBY_PHASES)[number];

export interface WireTeamColors {
  readonly primary: string;
  readonly secondary: string;
  readonly keeper: string;
}

export interface WireRosterPlayer {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly goalkeeper: boolean;
}

export interface WireTeam {
  readonly side: WireTeamSide;
  readonly name: string;
  readonly colors: WireTeamColors;
  readonly players: readonly WireRosterPlayer[];
  readonly bench: readonly WireRosterPlayer[];
}

/** Pitch dimensions as sent over the wire; renderer rebuilds derived geometry. */
export interface WirePitch {
  readonly lengthM: number;
  readonly widthM: number;
  readonly goalWidthM: number;
  readonly goalHeightM: number;
  readonly goalPostRadiusM: number;
  readonly goalNetDepthM: number;
  readonly penaltyAreaLengthM: number;
  readonly penaltyAreaWidthM: number;
  readonly goalAreaLengthM: number;
  readonly goalAreaWidthM: number;
  readonly penaltySpotDistanceM: number;
  readonly penaltyArcRadiusM: number;
  readonly cornerArcRadiusM: number;
}

export const MATCH_PLAYERS_PER_TEAM = 11;
export const MATCH_TOTAL_PLAYERS = MATCH_PLAYERS_PER_TEAM * 2;

export interface MatchSetupWire {
  readonly matchId: string;
  readonly seed: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly pitch: WirePitch;
  readonly home: WireTeam;
  readonly away: WireTeam;
}

export interface LobbyPlayerWire {
  readonly seat: number;
  readonly name: string;
  readonly team: WireTeamSide;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly host: boolean;
  readonly teamId: string | null;
  readonly sheet: TeamSheet | null;
}

export interface LobbyRoomWire {
  readonly code: string;
  readonly phase: LobbyPhase;
  readonly players: readonly LobbyPlayerWire[];
  readonly reconnectSeconds: number | null;
  readonly settings: MatchSettingsWire;
}

export interface LobbyYouWire {
  readonly seat: number;
  readonly team: WireTeamSide;
  readonly host: boolean;
  readonly ready: boolean;
  readonly teamId: string | null;
}

export interface ServerLobbyStateMessage {
  readonly t: "lobbyState";
  readonly room: LobbyRoomWire | null;
  readonly you: LobbyYouWire | null;
}

export interface ServerMatchStartMessage {
  readonly t: "matchStart";
  readonly setup: MatchSetupWire;
}

export interface ServerMatchPausedMessage {
  readonly t: "matchPaused";
  readonly reason: string;
  readonly reconnectSeconds: number;
}

export interface ServerMatchResumedMessage {
  readonly t: "matchResumed";
}

export interface ServerRoomClosedMessage {
  readonly t: "roomClosed";
  readonly reason: string;
}

export interface WireTeamMatchStats {
  readonly goals: number;
  readonly shots: number;
  readonly shotsOnTarget: number;
  readonly fouls: number;
  readonly offsides: number;
  readonly yellowCards: number;
  readonly redCards: number;
  readonly saves: number;
  readonly passes: number;
  readonly passesCompleted: number;
  readonly possessionTicks: number;
}

export interface WireShootout {
  readonly firstSide: WireTeamSide;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly index: number;
  readonly suddenDeath: boolean;
  readonly winner: WireTeamSide | null;
}

export interface WireMatchStats {
  readonly home: WireTeamMatchStats;
  readonly away: WireTeamMatchStats;
  readonly shootout: WireShootout | null;
  readonly forfeitSide: WireTeamSide | null;
  readonly winner: WireTeamSide | null;
}

export interface ServerRosterMessage {
  readonly t: "roster";
  readonly side: WireTeamSide;
  readonly players: readonly WireRosterPlayer[];
  readonly bench: readonly WireRosterPlayer[];
}

export interface ServerSubstitutionMessage {
  readonly t: "substitution";
  readonly status: "queued" | "applied" | "rejected";
  readonly message: string;
}

export interface ServerMatchStatsMessage {
  readonly t: "matchStats";
  readonly stats: WireMatchStats;
}

export interface WireVarReview {
  readonly kind: "goal" | "penalty" | "redCard";
  readonly side: WireTeamSide;
  readonly decision: "checking" | "confirmed" | "overturned";
}

export interface ServerVarReviewMessage {
  readonly t: "varReview";
  readonly review: WireVarReview | null;
}

export interface ServerShootoutMessage {
  readonly t: "shootout";
  readonly shootout: WireShootout | null;
}

export type ServerMessage =
  | ServerWelcomeMessage
  | ServerPresenceMessage
  | ServerPongMessage
  | ServerErrorMessage
  | ServerLobbyStateMessage
  | ServerMatchStartMessage
  | ServerMatchPausedMessage
  | ServerMatchResumedMessage
  | ServerRoomClosedMessage
  | ServerRosterMessage
  | ServerSubstitutionMessage
  | ServerMatchStatsMessage
  | ServerVarReviewMessage
  | ServerShootoutMessage;

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseClientMessage(text: string): ClientMessage | null {
  const value = parseObject(text);
  if (value === null) {
    return null;
  }

  switch (value.t) {
    case "hello": {
      if (!isProtocolVersion(value.protocolVersion)) {
        return null;
      }
      const token = value.sessionToken;
      if (token !== undefined) {
        if (
          typeof token !== "string" ||
          token.length === 0 ||
          token.length > 128
        ) {
          return null;
        }
        return {
          t: "hello",
          protocolVersion: value.protocolVersion,
          sessionToken: token,
        };
      }
      return { t: "hello", protocolVersion: value.protocolVersion };
    }
    case "ping":
      return isTimestamp(value.clientTimeMs)
        ? { t: "ping", clientTimeMs: value.clientTimeMs }
        : null;
    case "createRoom":
      return { t: "createRoom" };
    case "joinRoom":
      return isRoomCode(value.code)
        ? { t: "joinRoom", code: value.code }
        : null;
    case "setReady":
      return typeof value.ready === "boolean"
        ? { t: "setReady", ready: value.ready }
        : null;
    case "setTeam":
      return isEntityId(value.teamId)
        ? { t: "setTeam", teamId: value.teamId }
        : null;
    case "updateSheet": {
      const sheet = parseTeamSheet(value.sheet);
      return sheet === null ? null : { t: "updateSheet", sheet };
    }
    case "updateSettings": {
      const settings = parseMatchSettings(value.settings);
      return settings === null
        ? null
        : { t: "updateSettings", settings };
    }
    case "substitute":
      return isPlayerRef(value.outId) && isPlayerRef(value.inId)
        ? { t: "substitute", outId: value.outId, inId: value.inId }
        : null;
    case "leaveRoom":
      return { t: "leaveRoom" };
    case "resync":
      return { t: "resync" };
    default:
      return null;
  }
}

export function parseServerMessage(text: string): ServerMessage | null {
  const value = parseObject(text);
  if (value === null) {
    return null;
  }

  switch (value.t) {
    case "welcome":
      return isProtocolVersion(value.protocolVersion) &&
        typeof value.serverVersion === "string" &&
        typeof value.sessionId === "string" &&
        isTimestamp(value.serverTimeMs)
        ? {
            t: "welcome",
            protocolVersion: value.protocolVersion,
            serverVersion: value.serverVersion,
            sessionId: value.sessionId,
            serverTimeMs: value.serverTimeMs,
          }
        : null;
    case "presence":
      return isCount(value.connectedClients)
        ? { t: "presence", connectedClients: value.connectedClients }
        : null;
    case "pong":
      return isTimestamp(value.clientTimeMs) && isTimestamp(value.serverTimeMs)
        ? {
            t: "pong",
            clientTimeMs: value.clientTimeMs,
            serverTimeMs: value.serverTimeMs,
          }
        : null;
    case "error":
      return isServerErrorCode(value.code) && typeof value.message === "string"
        ? { t: "error", code: value.code, message: value.message }
        : null;
    case "lobbyState": {
      const room = parseLobbyRoom(value.room);
      const you = parseLobbyYou(value.you);
      if (room === undefined || you === undefined) {
        return null;
      }
      if ((room === null) !== (you === null)) {
        return null;
      }
      if (room !== null && you !== null) {
        const self = room.players.find((player) => player.seat === you.seat);
        if (
          self === undefined ||
          self.team !== you.team ||
          self.host !== you.host
        ) {
          return null;
        }
      }
      return { t: "lobbyState", room, you };
    }
    case "matchStart": {
      const setup = parseMatchSetup(value.setup);
      return setup === null ? null : { t: "matchStart", setup };
    }
    case "matchPaused":
      return typeof value.reason === "string" && isCount(value.reconnectSeconds)
        ? {
            t: "matchPaused",
            reason: value.reason,
            reconnectSeconds: value.reconnectSeconds,
          }
        : null;
    case "matchResumed":
      return { t: "matchResumed" };
    case "roomClosed":
      return typeof value.reason === "string"
        ? { t: "roomClosed", reason: value.reason }
        : null;
    case "roster": {
      if (!isWireTeamSide(value.side) || !Array.isArray(value.players) || !Array.isArray(value.bench)) {
        return null;
      }
      const players = parseRosterList(value.players, MATCH_PLAYERS_PER_TEAM);
      const bench = parseRosterList(value.bench, Number.POSITIVE_INFINITY);
      return players === null || bench === null
        ? null
        : { t: "roster", side: value.side, players, bench };
    }
    case "substitution":
      return (value.status === "queued" ||
        value.status === "applied" ||
        value.status === "rejected") &&
        typeof value.message === "string"
        ? {
            t: "substitution",
            status: value.status,
            message: value.message,
          }
        : null;
    case "matchStats": {
      const stats = parseMatchStats(value.stats);
      return stats === null ? null : { t: "matchStats", stats };
    }
    case "varReview": {
      if (value.review === null) {
        return { t: "varReview", review: null };
      }
      if (value.review === undefined) {
        return null;
      }
      const review = parseVarReview(value.review);
      return review === null ? null : { t: "varReview", review };
    }
    case "shootout": {
      if (value.shootout === null) {
        return { t: "shootout", shootout: null };
      }
      if (value.shootout === undefined) {
        return null;
      }
      const shootout = parseShootout(value.shootout);
      return shootout === null ? null : { t: "shootout", shootout };
    }
    default:
      return null;
  }
}

export function isCompatibleProtocol(version: number): boolean {
  return version === PROTOCOL_VERSION;
}

function parseLobbyRoom(value: unknown): LobbyRoomWire | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isRoomCode(record.code) || !isLobbyPhase(record.phase)) {
    return undefined;
  }
  if (!Array.isArray(record.players) || record.players.length > 2) {
    return undefined;
  }
  const players: LobbyPlayerWire[] = [];
  for (const item of record.players) {
    const player = parseLobbyPlayer(item);
    if (player === null) {
      return undefined;
    }
    players.push(player);
  }
  const reconnectSeconds = record.reconnectSeconds;
  if (
    reconnectSeconds !== null &&
    (typeof reconnectSeconds !== "number" ||
      !Number.isFinite(reconnectSeconds) ||
      reconnectSeconds < 0)
  ) {
    return undefined;
  }
  const settings = parseMatchSettings(record.settings);
  if (settings === null) {
    return undefined;
  }
  return {
    code: record.code,
    phase: record.phase,
    players,
    reconnectSeconds,
    settings,
  };
}

function parseLobbyPlayer(value: unknown): LobbyPlayerWire | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.seat !== 0 && record.seat !== 1) ||
    typeof record.name !== "string" ||
    !isWireTeamSide(record.team) ||
    typeof record.ready !== "boolean" ||
    typeof record.connected !== "boolean" ||
    typeof record.host !== "boolean" ||
    !isNullableEntityId(record.teamId)
  ) {
    return null;
  }
  const sheet = record.sheet === null ? null : parseTeamSheet(record.sheet);
  if ((record.teamId === null) !== (sheet === null)) {
    return null;
  }
  return {
    seat: record.seat,
    name: record.name,
    team: record.team,
    ready: record.ready,
    connected: record.connected,
    host: record.host,
    teamId: record.teamId,
    sheet,
  };
}

function parseLobbyYou(value: unknown): LobbyYouWire | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.seat !== 0 && record.seat !== 1) ||
    !isWireTeamSide(record.team) ||
    typeof record.host !== "boolean" ||
    typeof record.ready !== "boolean" ||
    !isNullableEntityId(record.teamId)
  ) {
    return undefined;
  }
  return {
    seat: record.seat,
    team: record.team,
    host: record.host,
    ready: record.ready,
    teamId: record.teamId,
  };
}

function parseMatchSetup(value: unknown): MatchSetupWire | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.matchId !== "string" ||
    !isUint32(record.seed) ||
    !isPositiveInteger(record.tickHz) ||
    !isPositiveInteger(record.snapshotHz)
  ) {
    return null;
  }
  const pitch = parsePitch(record.pitch);
  const home = parseWireTeam(record.home, "home");
  const away = parseWireTeam(record.away, "away");
  if (pitch === null || home === null || away === null) {
    return null;
  }
  return {
    matchId: record.matchId,
    seed: record.seed,
    tickHz: record.tickHz,
    snapshotHz: record.snapshotHz,
    pitch,
    home,
    away,
  };
}

const PITCH_KEYS = [
  "lengthM",
  "widthM",
  "goalWidthM",
  "goalHeightM",
  "goalPostRadiusM",
  "goalNetDepthM",
  "penaltyAreaLengthM",
  "penaltyAreaWidthM",
  "goalAreaLengthM",
  "goalAreaWidthM",
  "penaltySpotDistanceM",
  "penaltyArcRadiusM",
  "cornerArcRadiusM",
] as const;

type PitchKey = (typeof PITCH_KEYS)[number];

function parsePitch(value: unknown): WirePitch | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pitch: Partial<Record<PitchKey, number>> = {};
  for (const key of PITCH_KEYS) {
    const field = record[key];
    if (
      typeof field !== "number" ||
      !Number.isFinite(field) ||
      field <= 0
    ) {
      return null;
    }
    pitch[key] = field;
  }
  return pitch as WirePitch;
}

function parseWireTeam(
  value: unknown,
  side: WireTeamSide,
): WireTeam | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.side !== side ||
    typeof record.name !== "string" ||
    !Array.isArray(record.players) ||
    record.players.length !== MATCH_PLAYERS_PER_TEAM ||
    !Array.isArray(record.bench)
  ) {
    return null;
  }
  const colors = parseWireColors(record.colors);
  if (colors === null) {
    return null;
  }
  const players = parseRosterList(record.players, MATCH_PLAYERS_PER_TEAM);
  const bench = parseRosterList(record.bench, Number.POSITIVE_INFINITY);
  if (players === null || bench === null) {
    return null;
  }
  return { side, name: record.name, colors, players, bench };
}

function parseRosterList(
  value: unknown,
  maxLength: number,
): WireRosterPlayer[] | null {
  if (!Array.isArray(value) || value.length > maxLength) {
    return null;
  }
  const players: WireRosterPlayer[] = [];
  for (const item of value) {
    const player = parseRosterPlayer(item);
    if (player === null) {
      return null;
    }
    players.push(player);
  }
  return players;
}

function parseWireColors(value: unknown): WireTeamColors | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.primary !== "string" ||
    typeof record.secondary !== "string" ||
    typeof record.keeper !== "string"
  ) {
    return null;
  }
  return {
    primary: record.primary,
    secondary: record.secondary,
    keeper: record.keeper,
  };
}

function parseRosterPlayer(value: unknown): WireRosterPlayer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !isPositiveInteger(record.number) ||
    typeof record.goalkeeper !== "boolean"
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    number: record.number,
    goalkeeper: record.goalkeeper,
  };
}

function parseMatchSettings(value: unknown): MatchSettingsWire | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.halfRealMinutes !== 4 &&
      record.halfRealMinutes !== 6 &&
      record.halfRealMinutes !== 8 &&
      record.halfRealMinutes !== 10) ||
    typeof record.extraTime !== "boolean" ||
    typeof record.shootout !== "boolean" ||
    typeof record.varEnabled !== "boolean"
  ) {
    return null;
  }
  return {
    halfRealMinutes: record.halfRealMinutes,
    extraTime: record.extraTime,
    shootout: record.shootout,
    varEnabled: record.varEnabled,
  };
}

function parseTeamStats(value: unknown): WireTeamMatchStats | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "goals",
    "shots",
    "shotsOnTarget",
    "fouls",
    "offsides",
    "yellowCards",
    "redCards",
    "saves",
    "passes",
    "passesCompleted",
    "possessionTicks",
  ] as const;
  const stats: Record<string, number> = {};
  for (const key of keys) {
    if (!isCount(record[key])) {
      return null;
    }
    stats[key] = record[key];
  }
  return stats as unknown as WireTeamMatchStats;
}

function parseShootout(value: unknown): WireShootout | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isWireTeamSide(record.firstSide) ||
    !isCount(record.homeScore) ||
    !isCount(record.awayScore) ||
    !isCount(record.index) ||
    typeof record.suddenDeath !== "boolean" ||
    (record.winner !== null && !isWireTeamSide(record.winner))
  ) {
    return null;
  }
  return {
    firstSide: record.firstSide,
    homeScore: record.homeScore,
    awayScore: record.awayScore,
    index: record.index,
    suddenDeath: record.suddenDeath,
    winner: record.winner,
  };
}

function parseVarReview(value: unknown): WireVarReview | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.kind !== "goal" &&
      record.kind !== "penalty" &&
      record.kind !== "redCard") ||
    !isWireTeamSide(record.side) ||
    (record.decision !== "checking" &&
      record.decision !== "confirmed" &&
      record.decision !== "overturned")
  ) {
    return null;
  }
  return {
    kind: record.kind,
    side: record.side,
    decision: record.decision,
  };
}

function parseMatchStats(value: unknown): WireMatchStats | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const home = parseTeamStats(record.home);
  const away = parseTeamStats(record.away);
  const shootout =
    record.shootout === null ? null : parseShootout(record.shootout);
  if (
    home === null ||
    away === null ||
    (record.shootout !== null && shootout === null) ||
    (record.forfeitSide !== null && !isWireTeamSide(record.forfeitSide)) ||
    (record.winner !== null && !isWireTeamSide(record.winner))
  ) {
    return null;
  }
  return {
    home,
    away,
    shootout,
    forfeitSide: record.forfeitSide,
    winner: record.winner,
  };
}

function isPlayerRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(home|away):[a-z0-9][a-z0-9-]{0,63}$/.test(value)
  );
}

function isLobbyPhase(value: unknown): value is LobbyPhase {
  return (
    typeof value === "string" &&
    (LOBBY_PHASES as readonly string[]).includes(value)
  );
}

function isWireTeamSide(value: unknown): value is WireTeamSide {
  return value === "home" || value === "away";
}

function parseObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function isProtocolVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
  );
}

function isNullableEntityId(value: unknown): value is string | null {
  return value === null || isEntityId(value);
}

function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return (
    typeof value === "string" &&
    (SERVER_ERROR_CODES as readonly string[]).includes(value)
  );
}
