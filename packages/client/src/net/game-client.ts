// packages/client/src/net/game-client.ts
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  TUNING,
  WS_PATH,
  decodeSnapshot,
  encodeClientMessage,
  encodeInputFrame,
  encodeSnapshotAck,
  normalizeRoomCode,
  parseServerMessage,
  readSnapshotHeader,
  type ClientMessage,
  type InputFrame,
  type MatchSetupWire,
  type ServerLobbyStateMessage,
  type ServerMessage,
  type SnapshotFrame,
} from "@fb/shared";
import { SnapshotInterpolator } from "./interpolation";

export type InputCommand = Omit<InputFrame, "seq">;

export type GameLinkStatus =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline"
  | "fatal";

export interface GameClientState {
  readonly status: GameLinkStatus;
  readonly detail: string;
  readonly pingMs: number | null;
  readonly lobby: ServerLobbyStateMessage | null;
  readonly setup: MatchSetupWire | null;
  readonly pausedReason: string | null;
  readonly pausedUntilMs: number | null;
  readonly lastSnapshotSeq: number;
  readonly lastServerTick: number;
  readonly bufferedSnapshots: number;
  readonly notice: string | null;
}

const SESSION_TOKEN_KEY = "fb.session-token";
const MAX_FRAMES = TUNING.network.snapshotHistorySize;

export class GameClient {
  private readonly listeners = new Set<(state: GameClientState) => void>();
  private readonly interpolator = new SnapshotInterpolator();
  private readonly framesBySeq = new Map<number, SnapshotFrame>();
  private state: GameClientState = {
    status: "connecting",
    detail: "Opening secure WebSocket",
    pingMs: null,
    lobby: null,
    setup: null,
    pausedReason: null,
    pausedUntilMs: null,
    lastSnapshotSeq: 0,
    lastServerTick: 0,
    bufferedSnapshots: 0,
    notice: null,
  };
  private socket: WebSocket | null = null;
  private stopped = true;
  private protocolFailed = false;
  private token: string | null = loadStoredToken();
  private reconnectDelayMs: number = TUNING.network.reconnectBaseDelayMs;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private inputSequence = 0;

  subscribe(listener: (state: GameClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.protocolFailed = false;
    this.reconnectDelayMs = TUNING.network.reconnectBaseDelayMs;
    this.connect();
  }

  stop(detail = "Disconnected by user"): void {
    this.stopped = true;
    this.protocolFailed = false;
    this.clearReconnectTimer();
    this.clearPingTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, "client stop");
    }
    this.update({ status: "offline", detail });
  }

  createRoom(): void {
    this.send({ t: "createRoom" });
  }

  joinRoom(code: string): void {
    this.send({ t: "joinRoom", code: normalizeRoomCode(code) });
  }

  setReady(ready: boolean): void {
    this.send({ t: "setReady", ready });
  }

  leaveRoom(): void {
    this.send({ t: "leaveRoom" });
  }

  requestResync(): void {
    this.send({ t: "resync" });
  }

  /** Send one 60 Hz input frame; no-op while the socket is not open. */
  sendInput(command: InputCommand): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.inputSequence = (this.inputSequence + 1) >>> 0;
    if (this.inputSequence === 0) {
      this.inputSequence = 1;
    }
    this.socket.send(
      encodeInputFrame({
        seq: this.inputSequence,
        moveX: command.moveX,
        moveY: command.moveY,
        buttons: command.buttons,
        chargePower: command.chargePower,
      }),
    );
  }

  sampleSnapshot(nowMs: number): SnapshotFrame | null {
    return this.interpolator.sample(nowMs);
  }

  latestSnapshot(): SnapshotFrame | null {
    return this.interpolator.latest();
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.update({
      status:
        this.state.status === "online" || this.state.status === "reconnecting"
          ? "reconnecting"
          : "connecting",
      detail: "Opening secure WebSocket",
    });

    const socket = new WebSocket(webSocketEndpoint());
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.update({ status: "connecting", detail: "Waiting for handshake" });
      const hello =
        this.token === null
          ? { t: "hello" as const, protocolVersion: PROTOCOL_VERSION }
          : {
              t: "hello" as const,
              protocolVersion: PROTOCOL_VERSION,
              sessionToken: this.token,
            };
      this.send(hello);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleFrame(event.data);
    };

    socket.onerror = () => {
      if (this.socket === socket) {
        this.update({ detail: "Socket error" });
      }
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.handleClose(event);
    };
  }

  private handleFrame(data: unknown): void {
    if (typeof data === "string") {
      this.handleText(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleBinary(new Uint8Array(data));
      return;
    }
    if (data instanceof Uint8Array) {
      this.handleBinary(data);
    }
  }

  private handleText(text: string): void {
    const message = parseServerMessage(text);
    if (message === null) {
      this.update({ notice: "Ignored malformed server message" });
      return;
    }

    switch (message.t) {
      case "welcome":
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          this.protocolFailed = true;
          this.update({
            status: "fatal",
            detail: `Server protocol ${message.protocolVersion} does not match ${PROTOCOL_VERSION}`,
          });
          this.socket?.close(1002, "protocol mismatch");
          return;
        }
        this.token = message.sessionId;
        saveStoredToken(message.sessionId);
        this.reconnectDelayMs = TUNING.network.reconnectBaseDelayMs;
        this.inputSequence = 0;
        this.update({
          status: "online",
          detail: "Connected",
          pausedReason: null,
          pausedUntilMs: null,
          notice: null,
        });
        this.startPing();
        break;
      case "lobbyState":
        this.applyLobby(message);
        break;
      case "matchStart":
        this.applyMatchStart(message.setup);
        break;
      case "matchPaused":
        this.update({
          pausedReason: message.reason,
          pausedUntilMs: Date.now() + message.reconnectSeconds * 1_000,
          detail: "Match paused",
        });
        break;
      case "matchResumed":
        this.update({
          pausedReason: null,
          pausedUntilMs: null,
          detail: "Match resumed",
        });
        break;
      case "roomClosed":
        this.clearMatch();
        this.update({
          notice: message.reason,
          lobby: null,
          setup: null,
          pausedReason: null,
          pausedUntilMs: null,
        });
        break;
      case "error":
        if (message.code === "protocol_mismatch") {
          this.protocolFailed = true;
        }
        this.update({ notice: `${message.code}: ${message.message}` });
        break;
      case "pong":
        this.update({
          pingMs: Math.max(0, Date.now() - message.clientTimeMs),
        });
        break;
      case "presence":
        break;
    }
  }

  private handleBinary(bytes: Uint8Array): void {
    const header = readSnapshotHeader(bytes);
    if (header === null) {
      return;
    }
    const baseline = header.isDelta
      ? this.framesBySeq.get(header.baseSeq) ?? null
      : null;
    if (header.isDelta && baseline === null) {
      this.requestResync();
      return;
    }

    let frame: SnapshotFrame;
    try {
      frame = decodeSnapshot(bytes, baseline);
    } catch {
      this.requestResync();
      return;
    }

    this.framesBySeq.set(frame.seq, frame);
    while (this.framesBySeq.size > MAX_FRAMES) {
      const oldest = this.framesBySeq.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.framesBySeq.delete(oldest);
    }
    this.interpolator.add(frame, performance.now());

    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeSnapshotAck(frame.seq));
    }

    this.update({
      lastSnapshotSeq: frame.seq,
      lastServerTick: frame.tick,
      bufferedSnapshots: this.interpolator.bufferedCount,
    });
  }

  private applyLobby(
    message: Extract<ServerMessage, { t: "lobbyState" }>,
  ): void {
    if (message.room === null) {
      this.clearMatch();
      this.update({
        lobby: message,
        setup: null,
        pausedReason: null,
        pausedUntilMs: null,
        detail: "Connected",
      });
      return;
    }
    if (
      (message.room.phase === "waiting" ||
        message.room.phase === "ready") &&
      this.state.setup !== null
    ) {
      this.clearMatch();
    }
    this.update({
      lobby: message,
      notice: null,
      detail:
        message.room.phase === "paused"
          ? "Match paused"
          : message.room.phase === "live"
            ? "Match live"
            : "In room",
    });
  }

  private applyMatchStart(setup: MatchSetupWire): void {
    this.framesBySeq.clear();
    this.interpolator.reset();
    this.update({
      setup,
      lastSnapshotSeq: 0,
      lastServerTick: 0,
      bufferedSnapshots: 0,
      pausedReason: null,
      pausedUntilMs: null,
      detail: "Match live",
    });
  }

  private clearMatch(): void {
    this.framesBySeq.clear();
    this.interpolator.reset();
    this.update({
      setup: null,
      lastSnapshotSeq: 0,
      lastServerTick: 0,
      bufferedSnapshots: 0,
      pausedReason: null,
      pausedUntilMs: null,
    });
  }

  private handleClose(event: CloseEvent): void {
    this.clearPingTimer();
    if (this.stopped) {
      return;
    }

    if (
      this.protocolFailed ||
      event.code === 4006 ||
      event.code === CLOSE_CODES.PROTOCOL_MISMATCH
    ) {
      this.update({
        status: "fatal",
        detail:
          event.code === 4006
            ? "Session replaced in another tab"
            : "Protocol mismatch; reload the client",
      });
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      delay * 2,
      TUNING.network.reconnectMaxDelayMs,
    );
    this.update({
      status: "reconnecting",
      detail: `Connection lost. Retrying in ${(delay / 1_000).toFixed(1)} s`,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.clearPingTimer();
    const ping = (): void => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          encodeClientMessage({
            t: "ping",
            clientTimeMs: Date.now(),
          }),
        );
      }
    };
    ping();
    this.pingTimer = window.setInterval(
      ping,
      TUNING.network.clientPingIntervalMs,
    );
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.update({ notice: "Not connected to the server yet" });
      return;
    }
    this.socket.send(encodeClientMessage(message));
  }

  private update(patch: Partial<GameClientState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

function webSocketEndpoint(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${WS_PATH}`;
}

function loadStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveStoredToken(token: string): void {
  try {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // Storage may be unavailable in private/restricted contexts.
  }
}
