// packages/client/src/acceptance/room-socket.ts

import {
  PROTOCOL_VERSION,
  WS_PATH,
  encodeClientMessage,
  parseServerMessage,
} from "@fb/shared";

export type AcceptanceRoomRole = "host" | "guest";

export const ACCEPTANCE_ROOM_CODE = "ABCD";
export const ACCEPTANCE_HOST_TEAM = "kingsport-united";
export const ACCEPTANCE_GUEST_TEAM = "northbridge-athletic";

export interface AcceptanceRoomReport {
  readonly role: AcceptanceRoomRole;
  readonly secureContext: boolean;
  readonly connected: boolean;
  readonly welcome: boolean;
  readonly pong: boolean;
  readonly createdRoom: boolean;
  readonly joined: boolean;
  readonly teamSelected: boolean;
  readonly ready: boolean;
  readonly matchStarted: boolean;
  readonly replayNotified: boolean;
  readonly clipId: string | null;
  readonly error: string | null;
}

/**
 * Acceptance-only room client. The host creates the fixed room and both seats
 * choose teams explicitly before readying, so no capture helper pre-seats a
 * fake opponent.
 */
export async function connectAcceptanceRoom(
  role: AcceptanceRoomRole,
): Promise<AcceptanceRoomReport> {
  const secureContext = window.isSecureContext;
  if (!secureContext) {
    return {
      role,
      secureContext,
      connected: false,
      welcome: false,
      pong: false,
      createdRoom: false,
      joined: false,
      teamSelected: false,
      ready: false,
      matchStarted: false,
      replayNotified: false,
      clipId: null,
      error: "page is not a secure context",
    };
  }
  const teamId =
    role === "host" ? ACCEPTANCE_HOST_TEAM : ACCEPTANCE_GUEST_TEAM;

  return new Promise((resolve) => {
    let connected = false;
    let welcome = false;
    let pong = false;
    let createdRoom = false;
    let joined = false;
    let teamRequested = false;
    let teamSelected = false;
    let ready = false;
    let matchStarted = false;
    let replayNotified = false;
    let clipId: string | null = null;
    let settled = false;
    let joinRetryPending = false;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${WS_PATH}`,
    );

    const finish = (error: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
      resolve({
        role,
        secureContext,
        connected,
        welcome,
        pong,
        createdRoom,
        joined,
        teamSelected,
        ready,
        matchStarted,
        replayNotified,
        clipId,
        error,
      });
    };

    const completeIfReady = (): void => {
      if (
        pong &&
        joined &&
        teamSelected &&
        ready &&
        matchStarted &&
        replayNotified
      ) {
        finish(null);
      }
    };

    const sendJoin = (): void => {
      if (settled || joined) {
        return;
      }
      socket.send(
        encodeClientMessage({ t: "joinRoom", code: ACCEPTANCE_ROOM_CODE }),
      );
    };

    const scheduleJoinRetry = (): void => {
      if (settled || role !== "guest" || joined) {
        return;
      }
      if (joinRetryPending) {
        return;
      }
      joinRetryPending = true;
      setTimeout(() => {
        joinRetryPending = false;
        sendJoin();
      }, 250);
    };

    const timeout = setTimeout(() => {
      finish("room socket probe timed out");
    }, 150_000);

    socket.addEventListener("open", () => {
      connected = true;
      socket.send(
        encodeClientMessage({ t: "hello", protocolVersion: PROTOCOL_VERSION }),
      );
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const message = parseServerMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.t === "welcome") {
        welcome = true;
        socket.send(
          encodeClientMessage({ t: "ping", clientTimeMs: Date.now() }),
        );
        if (role === "host") {
          socket.send(encodeClientMessage({ t: "createRoom" }));
        } else {
          sendJoin();
        }
      } else if (message.t === "pong") {
        pong = true;
        completeIfReady();
      } else if (message.t === "lobbyState") {
        if (message.room?.code !== ACCEPTANCE_ROOM_CODE) {
          return;
        }
        joined = true;
        if (role === "host") {
          createdRoom = true;
        }
        if (!teamRequested) {
          teamRequested = true;
          socket.send(encodeClientMessage({ t: "setTeam", teamId }));
          return;
        }
        teamSelected = message.you?.teamId === teamId;
        if (!teamSelected) {
          return;
        }
        if (!ready) {
          ready = true;
          socket.send(encodeClientMessage({ t: "setReady", ready: true }));
        }
        completeIfReady();
      } else if (message.t === "matchStart") {
        matchStarted = true;
        completeIfReady();
      } else if (message.t === "replayClips") {
        const latest = message.clips.at(-1);
        if (latest !== undefined) {
          replayNotified = true;
          clipId = latest.id;
        }
        completeIfReady();
      } else if (message.t === "error") {
        if (
          role === "guest" &&
          !joined &&
          message.code === "room_not_found"
        ) {
          scheduleJoinRetry();
          return;
        }
        finish(`${message.code}: ${message.message}`);
      }
    });
    socket.addEventListener("error", () => {
      finish("socket error");
    });
    socket.addEventListener("close", () => {
      if (!settled) {
        finish("socket closed before the room completed");
      }
    });
  });
}
