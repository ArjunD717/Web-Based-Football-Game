// packages/server/src/rooms/room-manager.test.ts
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTROL_BUTTONS,
  PLAYER_STATE_CODES,
  buildDefaultSheet,
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
import { loadTeamRegistry, type TeamRegistry } from "../data/registry";
import { RoomManager } from "./room-manager";
import type { MatchState } from "@fb/sim";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let registry: TeamRegistry;

beforeAll(async () => {
  registry = await loadTeamRegistry(
    fileURLToPath(new URL("../../../../data/", import.meta.url)),
  );
});

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
    registry,
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

describe("team selection and live sheets", () => {
  it("assigns distinct teams with parseable default sheets", () => {
    const fixture = setupRoom();
    const host = fixture.host.lastLobby().room?.players.find(
      (player) => player.seat === 0,
    );
    const guest = fixture.host.lastLobby().room?.players.find(
      (player) => player.seat === 1,
    );
    expect(host?.teamId).toBeTruthy();
    expect(guest?.teamId).toBeTruthy();
    expect(host?.teamId).not.toBe(guest?.teamId);
    expect(registry.getTeam(host?.teamId ?? "")?.kind).toBe("club");
    expect(registry.getTeam(guest?.teamId ?? "")?.kind).toBe("club");
    expect(host?.sheet?.startingXI).toHaveLength(11);
    expect(guest?.sheet?.startingXI).toHaveLength(11);
  });

  it("syncs a valid sheet to the opponent and rejects a broken sheet", () => {
    const fixture = setupRoom();
    const host = fixture.host.lastLobby().room?.players.find(
      (player) => player.seat === 0,
    );
    if (host?.sheet === null || host?.sheet === undefined) {
      throw new Error("Host has no sheet");
    }
    const next = {
      ...host.sheet,
      bench: [...host.sheet.bench].reverse(),
      tactics: {
        ...host.sheet.tactics,
        defensiveDepth: 72,
        pressIntensity: "high" as const,
      },
    };
    fixture.manager.onMessage(fixture.host, {
      t: "updateSheet",
      sheet: next,
    });

    const guestView = fixture.guest.lastLobby().room?.players.find(
      (player) => player.seat === 0,
    );
    expect(guestView?.sheet?.bench).toEqual(next.bench);
    expect(guestView?.sheet?.tactics.defensiveDepth).toBe(72);
    expect(guestView?.sheet?.tactics.pressIntensity).toBe("high");

    const duplicate = {
      ...next,
      startingXI: next.startingXI.map((slot, index) =>
        index === 1
          ? { ...slot, playerId: next.startingXI[0]!.playerId }
          : slot,
      ),
    };
    fixture.manager.onMessage(fixture.host, {
      t: "updateSheet",
      sheet: duplicate,
    });
    expect(fixture.host.lastMessageType("error")?.code).toBe("invalid_sheet");
    const after = fixture.host.lastLobby().room?.players.find(
      (player) => player.seat === 0,
    );
    expect(after?.sheet?.tactics.defensiveDepth).toBe(72);
  });

  it("rejects a team already selected by the opponent", () => {
    const fixture = setupRoom();
    const lobby = fixture.host.lastLobby().room;
    const hostTeam = lobby?.players.find((player) => player.seat === 0)?.teamId;
    const guestTeam = lobby?.players.find((player) => player.seat === 1)?.teamId;
    if (hostTeam === null || hostTeam === undefined || guestTeam == null) {
      throw new Error("Teams were not assigned");
    }
    fixture.manager.onMessage(fixture.host, {
      t: "setTeam",
      teamId: guestTeam,
    });
    expect(fixture.host.lastMessageType("error")?.code).toBe("invalid_team");
    expect(
      fixture.host.lastLobby().room?.players.find(
        (player) => player.seat === 0,
      )?.teamId,
    ).toBe(hostTeam);

    fixture.manager.onMessage(fixture.host, {
      t: "setTeam",
      teamId: "not-a-team",
    });
    expect(fixture.host.lastMessageType("error")?.code).toBe("invalid_team");
  });

  it("starts a national team against a club with the call-up XI", () => {
    const fixture = setupRoom();
    const nation = registry.teams.find((team) => team.kind === "nation");
    const club = registry.teams.find((team) => team.kind === "club");
    if (nation === undefined || club === undefined) {
      throw new Error("Sample data must include a nation and a club");
    }
    fixture.manager.onMessage(fixture.host, {
      t: "setTeam",
      teamId: nation.id,
    });
    fixture.manager.onMessage(fixture.guest, {
      t: "setTeam",
      teamId: club.id,
    });
    startReadyMatch(fixture);
    const setup = fixture.host.lastMatchStart().setup;
    expect(setup.home.name).toBe(nation.name);
    expect(setup.away.name).toBe(club.name);
    expect(setup.home.players).toHaveLength(11);
    expect(setup.home.players[0]?.id).toBe(
      `home:${nation.defaultSheet.startingXI[0]!.playerId}`,
    );
    expect(
      fixture.host.lastLobby().room?.players.find(
        (player) => player.seat === 0,
      )?.teamId,
    ).toBe(nation.id);
  });

  it("starts with the authoritative selected starting XI", () => {
    const fixture = setupRoom();
    const host = fixture.host.lastLobby().room?.players.find(
      (player) => player.seat === 0,
    );
    if (host?.teamId === null || host?.teamId === undefined) {
      throw new Error("Host has no team");
    }
    const team = registry.getTeam(host.teamId);
    if (team === null) {
      throw new Error("Host team is missing");
    }
    const players = registry.getPlayers(host.teamId);
    const built = buildDefaultSheet(players, "4-4-2");
    const sheet = { ...built.sheet, kit: "away" as const };
    fixture.manager.onMessage(fixture.host, {
      t: "updateSheet",
      sheet,
    });
    startReadyMatch(fixture);
    const setup = fixture.host.lastMatchStart().setup;
    expect(setup.home.players.map((player) => player.id)).toEqual(
      sheet.startingXI.map((slot) => `home:${slot.playerId}`),
    );
    expect(setup.home.colors.primary).toBe(team.colours.away);
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

describe("match management", () => {
  it("applies host settings and rejects guest changes", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.host, { t: "setReady", ready: true });

    const hostSettings = {
      halfRealMinutes: 8 as const,
      extraTime: true,
      shootout: true,
      varEnabled: true,
      refereeStrictness: "strict" as const,
      aiDifficulty: "legendary" as const,
    };
    fixture.manager.onMessage(fixture.host, {
      t: "updateSettings",
      settings: hostSettings,
    });
    expect(fixture.host.lastLobby().room?.settings).toEqual(hostSettings);
    expect(fixture.guest.lastLobby().room?.settings).toEqual(hostSettings);
    expect(
      fixture.host.lastLobby().room?.players.find(
        (player) => player.seat === 0,
      )?.ready,
    ).toBe(false);

    fixture.manager.onMessage(fixture.guest, {
      t: "updateSettings",
      settings: {
        halfRealMinutes: 4,
        extraTime: false,
        shootout: false,
        varEnabled: false,
        refereeStrictness: "lenient",
        aiDifficulty: "beginner",
      },
    });
    expect(fixture.guest.lastMessageType("error")?.code).toBe("not_host");
    expect(fixture.host.lastLobby().room?.settings.halfRealMinutes).toBe(8);
  });

  it("lets only the host pause and resume a live match", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.host, { t: "pauseMatch" });
    expect(fixture.host.lastMessageType("error")?.code).toBe("match_not_live");

    startReadyMatch(fixture);
    advanceToLive(fixture);
    fixture.manager.tick(2 / 60);
    const before = latestFullSnapshot(fixture).tick;
    const snapshotsBefore = fixture.host.binary.length;

    fixture.manager.onMessage(fixture.guest, { t: "pauseMatch" });
    expect(fixture.guest.lastMessageType("error")?.code).toBe("not_host");

    fixture.manager.onMessage(fixture.host, { t: "pauseMatch" });
    const pausedForHost = fixture.host.lastMessageType("matchPaused");
    expect(pausedForHost?.manual).toBe(true);
    expect(pausedForHost?.reason).toContain("Host");
    expect(fixture.guest.lastMessageType("matchPaused")?.manual).toBe(true);
    expect(fixture.host.lastLobby().room?.phase).toBe("paused");
    expect(fixture.host.lastLobby().room?.reconnectSeconds).toBeNull();

    fixture.manager.tick(2 / 60);
    expect(fixture.host.binary.length).toBe(snapshotsBefore);
    expect(latestFullSnapshot(fixture).tick).toBe(before);

    fixture.manager.onMessage(fixture.guest, { t: "resumeMatch" });
    expect(fixture.guest.lastMessageType("error")?.code).toBe("not_host");

    fixture.manager.onMessage(fixture.host, { t: "resumeMatch" });
    expect(fixture.host.lastMessageType("matchResumed")).not.toBeNull();
    expect(fixture.guest.lastMessageType("matchResumed")).not.toBeNull();
    expect(fixture.host.lastLobby().room?.phase).toBe("live");

    fixture.manager.tick(10 / 60);
    expect(latestFullSnapshot(fixture).tick).toBeGreaterThan(before);
  });

  it("keeps a manual pause while one seat reconnects", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    advanceToLive(fixture);
    fixture.manager.onMessage(fixture.host, { t: "pauseMatch" });

    fixture.manager.onDisconnect(fixture.guest);
    expect(fixture.host.lastMessageType("matchPaused")?.manual).toBe(false);

    fixture.manager.onMessage(fixture.host, { t: "resumeMatch" });
    expect(fixture.host.lastMessageType("error")?.code).toBe(
      "room_unavailable",
    );

    const resumedGuest = new FakeClient(fixture.guest.token);
    fixture.manager.onReady(resumedGuest);
    expect(resumedGuest.lastMessageType("matchPaused")?.manual).toBe(true);
    expect(fixture.host.lastLobby().room?.phase).toBe("paused");
    expect(fixture.host.lastMessageType("matchResumed")).toBeNull();

    fixture.manager.onMessage(fixture.host, { t: "resumeMatch" });
    expect(resumedGuest.lastMessageType("matchResumed")).not.toBeNull();
    expect(fixture.host.lastLobby().room?.phase).toBe("live");
  });

  it("applies a queued substitution at a stoppage and updates the roster", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const setup = fixture.host.lastMatchStart().setup;
    const outgoing = setup.home.players[1];
    const incoming = setup.home.bench[0];
    if (outgoing === undefined || incoming === undefined) {
      throw new Error("Match setup is missing players");
    }

    fixture.manager.onMessage(fixture.host, {
      t: "substitute",
      outId: outgoing.id,
      inId: incoming.id,
    });

    const notice = fixture.host.lastMessageType("substitution");
    expect(notice?.status).toBe("applied");
    const roster = fixture.host.lastMessageType("roster");
    expect(roster?.side).toBe("home");
    expect(roster?.players.some((player) => player.id === incoming.id)).toBe(
      true,
    );
    expect(roster?.players.some((player) => player.id === outgoing.id)).toBe(
      false,
    );
    expect(roster?.bench.some((player) => player.id === incoming.id)).toBe(
      false,
    );
    expect(fixture.guest.lastMessageType("roster")?.players).toEqual(
      roster?.players,
    );

    fixture.manager.onMessage(fixture.host, { t: "resync" });
    const homeRosters = fixture.host.json.filter(
      (
        message,
      ): message is Extract<ServerMessage, { t: "roster" }> =>
        message.t === "roster" && message.side === "home",
    );
    expect(homeRosters.at(-1)?.players).toEqual(
      roster?.players,
    );
  });

  it("rejects a substitution after the player has left the pitch", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const setup = fixture.host.lastMatchStart().setup;
    const outgoing = setup.home.players[1];
    const incoming = setup.home.bench[0];
    if (outgoing === undefined || incoming === undefined) {
      throw new Error("Match setup is missing players");
    }
    fixture.manager.onMessage(fixture.host, {
      t: "substitute",
      outId: outgoing.id,
      inId: incoming.id,
    });
    fixture.manager.onMessage(fixture.host, {
      t: "substitute",
      outId: outgoing.id,
      inId: incoming.id,
    });
    expect(fixture.host.lastMessageType("error")?.code).toBe(
      "invalid_substitution",
    );
  });

  it("broadcasts match statistics once at full time", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const internal = fixture.manager as unknown as {
      rooms: Map<
        string,
        {
          match: {
            state: MatchState;
            resultSent: boolean;
            finished: boolean;
          } | null;
        }
      >;
    };
    const match = [...internal.rooms.values()][0]?.match;
    if (match === null || match === undefined) {
      throw new Error("Room has no match");
    }
    match.state.referee.phase = "fullTime";
    fixture.manager.tick(1 / 60);

    const stats = fixture.host.lastMessageType("matchStats");
    expect(stats).not.toBeNull();
    expect(stats?.stats.home.shots).toBe(0);
    expect(stats?.stats.away.shots).toBe(0);
    expect(stats?.stats.winner).toBeNull();
    expect(
      fixture.host.json.filter((message) => message.t === "matchStats"),
    ).toHaveLength(1);
    expect(fixture.guest.lastMessageType("matchStats")).not.toBeNull();

    fixture.manager.onMessage(fixture.host, { t: "resync" });
    expect(
      fixture.host.json.filter((message) => message.t === "matchStats"),
    ).toHaveLength(2);
  });
});

describe("input validation", () => {
  it("requires membership before ready or resync", () => {
    const manager = new RoomManager({ logger: silentLogger, registry });
    const client = new FakeClient("solo");
    manager.onReady(client);
    manager.onMessage(client, { t: "setReady", ready: true });
    expect(client.lastMessageType("error")?.code).toBe("not_in_room");
    manager.onMessage(client, { t: "resync" });
    expect(client.lastMessageType("error")?.code).toBe("not_in_room");
  });

  it("rejects malformed binary acks", () => {
    const manager = new RoomManager({ logger: silentLogger, registry });
    const client = new FakeClient("solo");
    manager.onReady(client);
    manager.onBinaryMessage(client, new Uint8Array([1, 2, 3]));
    expect(client.closed).toBe(true);
  });
});
