// packages/server/src/rooms/room-manager.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  CONTROL_BUTTONS,
  PLAYER_STATE_CODES,
  encodeInputFrame,
  encodeSnapshotAck,
  decodeSnapshot,
  isRoomCode,
  type ServerMessage,
  type ServerLobbyStateMessage,
  type ServerMatchStartMessage,
} from "@fb/shared";
import type { ClientConnection } from "../client";
import type { Logger } from "../create-server";
import { RoomManager } from "./room-manager";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeClient implements ClientConnection {
  readonly json: ServerMessage[] = [];
  readonly binary: Uint8Array[] = [];
  closed = false;

  constructor(readonly token: string) {}

  send(message: ServerMessage): void {
    this.json.push(message);
  }

  sendBinary(data: Uint8Array): void {
    this.binary.push(data);
  }

  close(): void {
    this.closed = true;
  }

  lastLobby(): ServerLobbyStateMessage {
    const message = this.findLast("lobbyState");
    if (message === null) {
      throw new Error("No lobby state received");
    }
    return message;
  }

  lastMatchStart(): ServerMatchStartMessage {
    const message = this.findLast("matchStart");
    if (message === null) {
      throw new Error("No match start received");
    }
    return message;
  }

  lastMessageType<T extends ServerMessage["t"]>(
    type: T,
  ): Extract<ServerMessage, { t: T }> | null {
    return this.findLast(type);
  }

  private findLast<T extends ServerMessage["t"]>(
    type: T,
  ): Extract<ServerMessage, { t: T }> | null {
    for (let index = this.json.length - 1; index >= 0; index -= 1) {
      const message = this.json[index];
      if (message?.t === type) {
        return message as Extract<ServerMessage, { t: T }>;
      }
    }
    return null;
  }
}

interface Fixture {
  readonly manager: RoomManager;
  readonly host: FakeClient;
  readonly guest: FakeClient;
  readonly code: string;
  readonly created: string[];
}

function setupRoom(options: { reconnectGraceMs?: number } = {}): Fixture {
  const created: string[] = [];
  const manager = new RoomManager({
    logger: silentLogger,
    generateCode: () => (created.length === 0 ? "ABCD" : "EFGH"),
    onRoomCreated: (code) => created.push(code),
    ...options,
  });
  const host = new FakeClient("host-token");
  const guest = new FakeClient("guest-token");
  manager.onReady(host);
  manager.onMessage(host, { t: "createRoom" });
  const code = host.lastLobby().room?.code ?? "";
  manager.onReady(guest);
  manager.onMessage(guest, { t: "joinRoom", code });
  return { manager, host, guest, code, created };
}

function startReadyMatch(fixture: Fixture): void {
  fixture.manager.onMessage(fixture.host, { t: "setReady", ready: true });
  fixture.manager.onMessage(fixture.guest, { t: "setReady", ready: true });
}

function latestFullSnapshot(fixture: Fixture, client = fixture.host) {
  fixture.manager.onMessage(client, { t: "resync" });
  return decodeSnapshot(client.binary.at(-1)!);
}

function advanceToLive(fixture: Fixture): void {
  for (let tick = 0; tick < 90; tick += 1) {
    fixture.manager.tick(1 / 60);
  }
  expect(latestFullSnapshot(fixture).match.phase).toBe("live");
}

describe("room lifecycle", () => {
  it("creates a room, joins a guest and starts when both ready", () => {
    const fixture = setupRoom();
    expect(isRoomCode(fixture.code)).toBe(true);
    expect(fixture.created).toEqual([fixture.code]);

    const hostLobby = fixture.host.lastLobby();
    const guestLobby = fixture.guest.lastLobby();
    expect(hostLobby.room?.players).toHaveLength(2);
    expect(hostLobby.you?.host).toBe(true);
    expect(hostLobby.you?.team).toBe("home");
    expect(guestLobby.you?.host).toBe(false);
    expect(guestLobby.you?.team).toBe("away");
    expect(hostLobby.room?.phase).toBe("waiting");

    fixture.manager.onMessage(fixture.host, { t: "setReady", ready: true });
    expect(fixture.host.lastLobby().room?.phase).toBe("waiting");

    fixture.manager.onMessage(fixture.guest, { t: "setReady", ready: true });
    expect(fixture.host.lastLobby().room?.phase).toBe("live");
    expect(fixture.guest.lastLobby().room?.phase).toBe("live");

    const setup = fixture.host.lastMatchStart().setup;
    expect(setup.home.players).toHaveLength(11);
    expect(setup.away.players).toHaveLength(11);
    expect(setup.tickHz).toBe(60);
    expect(fixture.host.binary).toHaveLength(1);
    expect(fixture.guest.binary).toHaveLength(1);
  });

  it("rejects duplicate, unknown and full rooms", () => {
    const fixture = setupRoom();
    const intruder = new FakeClient("intruder");
    fixture.manager.onReady(intruder);
    fixture.manager.onMessage(intruder, {
      t: "joinRoom",
      code: fixture.code,
    });
    expect(intruder.lastMessageType("error")?.code).toBe("room_full");

    const missing = new FakeClient("missing");
    fixture.manager.onReady(missing);
    fixture.manager.onMessage(missing, { t: "joinRoom", code: "ZZZZ" });
    expect(missing.lastMessageType("error")?.code).toBe("room_not_found");

    fixture.manager.onMessage(fixture.host, { t: "createRoom" });
    expect(
      fixture.host.lastMessageType("error")?.code,
    ).toBe("already_in_room");
  });

  it("returns a player to idle when they leave", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.guest, { t: "leaveRoom" });
    expect(fixture.guest.lastLobby().room).toBeNull();
    expect(fixture.host.lastLobby().room?.players).toHaveLength(1);
    expect(fixture.host.lastLobby().room?.phase).toBe("waiting");
  });

  it("closes the room when the host leaves", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.host, { t: "leaveRoom" });
    expect(fixture.host.lastMessageType("roomClosed")?.reason).toContain(
      "Host",
    );
    expect(fixture.guest.lastMessageType("roomClosed")).not.toBeNull();
  });
});

describe("match snapshots", () => {
  it("streams full and delta snapshots and acks them", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);

    const firstFrame = decodeSnapshot(fixture.host.binary[0]!);
    expect(firstFrame.players).toHaveLength(22);
    expect(PLAYER_STATE_CODES).toContain(firstFrame.players[0]!.state);
    expect(firstFrame.match).toMatchObject({
      phase: "deadBall",
      half: 1,
      clockSeconds: 0,
      scoreHome: 0,
      scoreAway: 0,
      restartType: "kickoff",
      restartSide: "home",
    });
    fixture.manager.onBinaryMessage(
      fixture.host,
      encodeSnapshotAck(firstFrame.seq),
    );

    fixture.manager.tick(2 / 60);
    expect(fixture.host.binary.length).toBeGreaterThanOrEqual(2);
    const second = fixture.host.binary.at(-1)!;
    expect((second[1]! & 1) === 1).toBe(true);
    const secondFrame = decodeSnapshot(second, firstFrame);
    expect(secondFrame.tick).toBeGreaterThan(firstFrame.tick);
    expect(secondFrame.baseSeq).toBe(firstFrame.seq);
  });

  it("resyncs with a fresh full snapshot", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const before = fixture.host.binary.length;
    fixture.manager.onMessage(fixture.host, { t: "resync" });
    expect(fixture.host.binary.length).toBe(before + 1);
    const frame = decodeSnapshot(fixture.host.binary.at(-1)!);
    expect(frame.players).toHaveLength(22);
  });

  it("routes input only once the referee starts play", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const initial = decodeSnapshot(fixture.host.binary[0]!);
    expect(initial.controlledHome).toBeGreaterThanOrEqual(0);

    fixture.manager.onBinaryMessage(
      fixture.host,
      encodeInputFrame({
        seq: 1,
        moveX: 1,
        moveY: 0,
        buttons: CONTROL_BUTTONS.SWITCH,
        chargePower: 0,
      }),
    );
    fixture.manager.tick(2 / 60);
    expect(latestFullSnapshot(fixture).controlledHome).toBe(
      initial.controlledHome,
    );

    advanceToLive(fixture);
    const liveBefore = latestFullSnapshot(fixture);
    expect(liveBefore.match.clockSeconds).toBeGreaterThan(0);
    fixture.manager.onBinaryMessage(
      fixture.host,
      encodeInputFrame({
        seq: 2,
        moveX: 1,
        moveY: 0,
        buttons: CONTROL_BUTTONS.SWITCH,
        chargePower: 0,
      }),
    );
    fixture.manager.tick(2 / 60);
    const after = latestFullSnapshot(fixture);
    expect(after.controlledHome).not.toBe(liveBefore.controlledHome);
    expect(after.controlledAway).toBe(liveBefore.controlledAway);
  });
});

describe("disconnect and reconnect", () => {
  it("pauses when a player drops and resumes on token reconnect", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    fixture.manager.tick(2 / 60);
    const snapshotsBefore = fixture.host.binary.length;

    fixture.manager.onDisconnect(fixture.guest);
    expect(fixture.host.lastMessageType("matchPaused")?.reconnectSeconds).toBe(
      60,
    );
    expect(fixture.host.lastLobby().room?.phase).toBe("paused");
    expect(fixture.host.lastLobby().room?.reconnectSeconds).toBe(60);

    fixture.manager.tick(1 / 60);
    expect(fixture.host.binary.length).toBe(snapshotsBefore);

    const resumedGuest = new FakeClient(fixture.guest.token);
    fixture.manager.onReady(resumedGuest);
    expect(fixture.host.lastMessageType("matchResumed")).not.toBeNull();
    expect(fixture.host.lastLobby().room?.phase).toBe("live");
    expect(resumedGuest.lastMatchStart().setup.home.players).toHaveLength(11);
    expect(resumedGuest.binary).toHaveLength(1);

    fixture.manager.tick(2 / 60);
    expect(resumedGuest.binary.length).toBeGreaterThan(1);
  });

  it("expires a guest after the reconnect grace and preserves the host room", () => {
    vi.useFakeTimers();
    try {
      const fixture = setupRoom({ reconnectGraceMs: 50 });
      startReadyMatch(fixture);
      fixture.manager.onDisconnect(fixture.guest);
      vi.advanceTimersByTime(60);
      const lobby = fixture.host.lastLobby();
      expect(lobby.room?.players).toHaveLength(1);
      expect(lobby.room?.phase).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("input validation", () => {
  it("requires membership before ready or resync", () => {
    const manager = new RoomManager({ logger: silentLogger });
    const client = new FakeClient("solo");
    manager.onReady(client);
    manager.onMessage(client, { t: "setReady", ready: true });
    expect(client.lastMessageType("error")?.code).toBe("not_in_room");
    manager.onMessage(client, { t: "resync" });
    expect(client.lastMessageType("error")?.code).toBe("not_in_room");
  });

  it("rejects malformed binary acks", () => {
    const manager = new RoomManager({ logger: silentLogger });
    const client = new FakeClient("solo");
    manager.onReady(client);
    manager.onBinaryMessage(client, new Uint8Array([1, 2, 3]));
    expect(client.closed).toBe(true);
  });
});
