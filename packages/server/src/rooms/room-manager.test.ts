// packages/server/src/rooms/room-manager.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTROL_BUTTONS,
  PLAYER_STATE_CODES,
  applySuspensionsToSheet,
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
import { ReplayStore } from "../replays/replay-store";
import { RoomManager } from "./room-manager";
import { hashMatchState, type MatchState } from "@fb/sim";
import { parseReplayExport } from "../../../client/src/match/replay-gallery";
import { WireViewBuilder } from "../../../client/src/match/view-from-wire";
import { MatchReplayBuffer } from "../../../client/src/presentation/replay";

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

function setupRoom(
  options: {
    reconnectGraceMs?: number;
    replayStore?: ReplayStore;
    matchSeed?: number;
    aiOnly?: boolean;
  } = {},
): Fixture {
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

describe("server replay export", () => {
  it("exports the retained authoritative snapshot window", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    for (let tick = 0; tick < 30; tick += 1) {
      fixture.manager.tick(1 / 60);
    }

    const replay = fixture.manager.exportReplay(fixture.code.toLowerCase());
    expect(replay).not.toBeNull();
    expect(replay?.code).toBe(fixture.code);
    expect(replay?.setup.matchId).toBe(
      fixture.host.lastMatchStart().setup.matchId,
    );
    expect(replay?.frames.length).toBeGreaterThan(0);
    const sequences = replay?.frames.map((frame) => frame.seq) ?? [];
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it("captures and announces a goal-triggered clip", () => {
    const fixture = setupRoom();
    startReadyMatch(fixture);
    const internal = fixture.manager as unknown as {
      rooms: Map<
        string,
        {
          match: {
            state: MatchState;
            finished: boolean;
          } | null;
        }
      >;
    };
    const match = [...internal.rooms.values()][0]?.match;
    if (match === null || match === undefined) {
      throw new Error("Room has no match");
    }
    match.state.referee.scoreHome = 1;
    for (let tick = 0; tick < 100; tick += 1) {
      fixture.manager.tick(1 / 60);
    }
    match.state.referee.scoreHome = 2;
    for (let tick = 0; tick < 100; tick += 1) {
      fixture.manager.tick(1 / 60);
    }

    const message = fixture.host.lastMessageType("replayClips");
    expect(message?.clips).toHaveLength(2);
    const latest = message?.clips.at(-1);
    expect(latest).toMatchObject({
      kind: "goal",
      scoreHome: 2,
      scoreAway: 0,
    });
    expect(latest?.clockSeconds).toBeGreaterThanOrEqual(0);
    expect(latest?.frameCount).toBeGreaterThan(0);

    const clip = fixture.manager.exportReplayClip(
      fixture.code,
      latest?.id ?? "",
    );
    expect(clip?.id).toBe(latest?.id);
    expect(clip?.kind).toBe("goal");
    expect(clip?.frames.length).toBe(latest?.frameCount);
    expect(fixture.manager.exportReplayClip(fixture.code, "missing")).toBeNull();

    // Cross-package acceptance: the real room export must survive the same
    // JSON, parser, view-builder and replay-buffer path used by the browser.
    const parsed = parseReplayExport(JSON.parse(JSON.stringify(clip)));
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(parsed.setup.snapshotHz).toBe(30);
    expect(parsed.frames.length).toBeGreaterThan(90);
    const builder = new WireViewBuilder(parsed.setup, null);
    const views = parsed.frames.flatMap((frame) => {
      const view = builder.build(frame);
      return view === null ? [] : [view];
    });
    expect(views).toHaveLength(parsed.frames.length);
    expect(views[0]?.home.players).toHaveLength(11);
    expect(views[0]?.away.players).toHaveLength(11);
    for (let index = 1; index < parsed.frames.length; index += 1) {
      const previous = parsed.frames[index - 1];
      const current = parsed.frames[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect(current.tick).toBeGreaterThan(previous.tick);
      expect(current.match.clockSeconds).toBeGreaterThanOrEqual(
        previous.match.clockSeconds,
      );
      expect(current.tick - previous.tick).toBe(2);
    }
    const replay = new MatchReplayBuffer({ speed: 1 });
    const replayFrames = views.map((view, index) => ({
      view,
      recordedAtMs: index * (1_000 / parsed.setup.snapshotHz),
    }));
    expect(replay.loadSaved(replayFrames)).toBe(true);
    expect(replay.startSaved(0)).toBe(true);
    const sampled = replay.sample(3_000);
    expect(sampled?.view.tick).toBeGreaterThan(parsed.frames[0]?.tick ?? 0);
  });

  it("writes captured clips into the durable replay library", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fb-room-replays-"));
    const store = new ReplayStore({ dir, logger: silentLogger });
    await store.initialize();
    try {
      const fixture = setupRoom({ replayStore: store });
      startReadyMatch(fixture);
      const internal = fixture.manager as unknown as {
        rooms: Map<
          string,
          {
            match: {
              state: MatchState;
              finished: boolean;
            } | null;
          }
        >;
      };
      const match = [...internal.rooms.values()][0]?.match;
      if (match === null || match === undefined) {
        throw new Error("Room has no match");
      }
      match.state.referee.scoreHome = 1;
      for (let tick = 0; tick < 100; tick += 1) {
        fixture.manager.tick(1 / 60);
      }
      await store.flush();

      expect(store.listRooms()[0]?.code).toBe(fixture.code);
      expect(store.getClip(fixture.code, "g1")).toMatchObject({
        id: "g1",
        scoreHome: 1,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs deterministic AI-only capture rooms", () => {
    const matchSeed = 20_261_108;
    const first = setupRoom({ matchSeed, aiOnly: true });
    const second = setupRoom({ matchSeed, aiOnly: true });
    startReadyMatch(first);
    startReadyMatch(second);
    const stateOf = (fixture: Fixture): MatchState => {
      const internal = fixture.manager as unknown as {
        rooms: Map<string, { match: { state: MatchState } | null }>;
      };
      const state = internal.rooms.get(fixture.code)?.match?.state;
      if (state === undefined) {
        throw new Error("Room has no match state");
      }
      return state;
    };
    expect(stateOf(first).seed).toBe(matchSeed);
    expect(stateOf(second).seed).toBe(matchSeed);
    for (let tick = 0; tick < 600; tick += 1) {
      first.manager.tick(1 / 60);
      second.manager.tick(1 / 60);
    }
    expect(hashMatchState(stateOf(first))).toBe(
      hashMatchState(stateOf(second)),
    );
    for (const team of [stateOf(first).home, stateOf(first).away]) {
      expect(team.players.every((player) => !player.isUserControlled)).toBe(
        true,
      );
    }
  });

  it("captures a natural AI-only goal without touching the score", () => {
    const fixture = setupRoom({ matchSeed: 20_261_108, aiOnly: true });
    startReadyMatch(fixture);
    for (let tick = 0; tick < 8_000; tick += 1) {
      fixture.manager.tick(1 / 60);
      if (tick % 60 === 0 && fixture.host.lastMessageType("replayClips") !== null) {
        break;
      }
    }
    const message = fixture.host.lastMessageType("replayClips");
    expect(message?.clips.length).toBeGreaterThan(0);
    const latest = message?.clips.at(-1);
    expect(latest).toMatchObject({ kind: "goal" });
    expect((latest?.scoreHome ?? 0) + (latest?.scoreAway ?? 0)).toBe(1);
    const clip = fixture.manager.exportReplayClip(
      fixture.code,
      latest?.id ?? "",
    );
    expect(clip?.frames.length).toBe(latest?.frameCount);
    expect(clip?.frames.length).toBeGreaterThan(90);
  });

  it("returns null for an unknown room", () => {
    expect(setupRoom().manager.exportReplay("ZZZZ")).toBeNull();
  });
});

describe("match management", () => {
  it("applies host settings and rejects guest changes", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.host, { t: "setReady", ready: true });

    const hostSettings = {
      halfRealMinutes: 8 as const,
      tieLegs: 1 as const,
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
        tieLegs: 1,
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

  it("lets either seat pause and resume a live match", () => {
    const fixture = setupRoom();
    fixture.manager.onMessage(fixture.host, { t: "pauseMatch" });
    expect(fixture.host.lastMessageType("error")?.code).toBe("match_not_live");

    startReadyMatch(fixture);
    advanceToLive(fixture);
    fixture.manager.tick(2 / 60);
    const before = latestFullSnapshot(fixture).tick;
    const snapshotsBefore = fixture.host.binary.length;

    fixture.manager.onMessage(fixture.guest, { t: "pauseMatch" });
    const pausedForHost = fixture.host.lastMessageType("matchPaused");
    expect(pausedForHost?.manual).toBe(true);
    expect(pausedForHost?.reason).toBe("A player paused the match");
    expect(fixture.guest.lastMessageType("matchPaused")?.manual).toBe(true);
    expect(fixture.host.lastLobby().room?.phase).toBe("paused");
    expect(fixture.host.lastLobby().room?.reconnectSeconds).toBeNull();

    fixture.manager.tick(2 / 60);
    expect(fixture.host.binary.length).toBe(snapshotsBefore);
    expect(latestFullSnapshot(fixture).tick).toBe(before);

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

  it("records both legs and declares the aggregate winner", () => {
    const fixture = setupRoom();
    const settings = fixture.host.lastLobby().room?.settings;
    if (settings === undefined) {
      throw new Error("Room settings missing");
    }
    fixture.manager.onMessage(fixture.host, {
      t: "updateSettings",
      settings: {
        ...settings,
        tieLegs: 2,
        extraTime: true,
        shootout: true,
      },
    });
    startReadyMatch(fixture);
    const internal = fixture.manager as unknown as {
      rooms: Map<
        string,
        {
          match: {
            state: MatchState;
            finished: boolean;
          } | null;
        }
      >;
    };
    const room = [...internal.rooms.values()][0];
    const first = room?.match;
    if (first === null || first === undefined) {
      throw new Error("Room has no first leg");
    }
    expect(first.state.rules.extraTimeEnabled).toBe(false);
    expect(first.state.rules.shootoutEnabled).toBe(false);
    const suspended = first.state.home.players.find(
      (player) => player.role !== "GK",
    );
    if (suspended === undefined) {
      throw new Error("No outfield player to suspend");
    }
    suspended.sentOff = true;
    const suspendedId = suspended.id;
    first.state.referee.scoreHome = 2;
    first.state.referee.scoreAway = 1;
    first.state.referee.phase = "fullTime";
    fixture.manager.tick(1 / 60);

    const firstStats = fixture.host.lastMessageType("matchStats");
    expect(firstStats?.stats.series).toMatchObject({
      legs: 2,
      leg: 1,
      complete: false,
      homeAggregate: 2,
      awayAggregate: 1,
      winner: null,
    });

    fixture.manager.onMessage(fixture.guest, { t: "prepareNextLeg" });
    expect(fixture.guest.lastMessageType("error")?.code).toBe("not_host");
    fixture.manager.onMessage(fixture.host, { t: "prepareNextLeg" });
    const ended = fixture.host.lastMessageType("matchEnded");
    expect(ended?.suspendedHome).toBe(1);
    expect(ended?.suspendedAway).toBe(0);
    expect(room?.match).toBeNull();
    expect(fixture.host.lastLobby().room?.phase).toBe("waiting");

    const startsBefore = fixture.host.json.filter(
      (message) => message.t === "matchStart",
    ).length;
    startReadyMatch(fixture);
    expect(
      fixture.host.json.filter((message) => message.t === "matchStart"),
    ).toHaveLength(startsBefore + 1);

    const second = room?.match;
    if (second === null || second === undefined || second === first) {
      throw new Error("Second leg did not start");
    }
    expect(second.state.rules.extraTimeEnabled).toBe(false);
    expect(second.state.rules.shootoutEnabled).toBe(false);
    expect(
      second.state.home.players.some((player) => player.id === suspendedId),
    ).toBe(false);
    expect(second.state.home.players).toHaveLength(11);
    second.state.referee.scoreHome = 1;
    second.state.referee.scoreAway = 1;
    second.state.referee.phase = "fullTime";
    fixture.manager.tick(1 / 60);

    const finalStats = fixture.host.lastMessageType("matchStats");
    expect(finalStats?.stats.series).toEqual({
      legs: 2,
      leg: 2,
      complete: true,
      homeAggregate: 3,
      awayAggregate: 2,
      winner: "home",
    });
  });
});

describe("suspension lineups", () => {
  it("replaces only suspended starters and keeps the rest of the XI", () => {
    const team = registry.getTeam("kingsport-united");
    if (team === null) {
      throw new Error("Sample team missing");
    }
    const players = registry.getPlayers(team.id);
    const sheet = buildDefaultSheet(players).sheet;
    const suspendedSlot = sheet.startingXI[7];
    if (suspendedSlot === undefined) {
      throw new Error("Sheet has no seventh starter");
    }
    const suspended = new Set([suspendedSlot.playerId]);
    const next = applySuspensionsToSheet(sheet, players, suspended);

    expect(next.startingXI).toHaveLength(11);
    expect(
      next.startingXI.some((slot) => slot.playerId === suspendedSlot.playerId),
    ).toBe(false);
    for (const slot of sheet.startingXI) {
      if (!suspended.has(slot.playerId)) {
        expect(next.startingXI[slot.slot]?.playerId).toBe(slot.playerId);
      }
    }
    expect(next.bench).toHaveLength(sheet.bench.length);
    expect(
      [...next.startingXI.map((slot) => slot.playerId), ...next.bench].some(
        (id) => suspended.has(id),
      ),
    ).toBe(false);
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
