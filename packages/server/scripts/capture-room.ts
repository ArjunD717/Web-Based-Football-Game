// packages/server/scripts/capture-room.ts

import {
  TUNING,
  type ClientMessage,
  type ServerMessage,
  type WireReplayClip,
} from "@fb/shared";
import type { ClientConnection } from "../src/client";
import type { Logger } from "../src/create-server";
import type { TeamRegistry } from "../src/data/registry";
import { RoomManager } from "../src/rooms/room-manager";

export const CAPTURE_CODE = "ABCD";
export const CAPTURE_SEED = 20_261_108;
export const CAPTURE_MAX_TICKS = TUNING.sim.tickHz * 60 * 20;

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class CaptureClient implements ClientConnection {
  readonly json: ServerMessage[] = [];

  constructor(readonly token: string) {}

  send(message: ServerMessage): void {
    this.json.push(message);
  }

  sendBinary(_data: Uint8Array): void {}

  close(_code: number, _reason: string): void {}
}

export interface AiCaptureRoom {
  readonly manager: RoomManager;
  readonly host: CaptureClient;
  readonly code: string;
}

function latestReplayClips(client: CaptureClient): readonly WireReplayClip[] {
  for (let index = client.json.length - 1; index >= 0; index -= 1) {
    const message = client.json[index];
    if (message?.t === "replayClips") {
      return message.clips;
    }
  }
  return [];
}

/** Creates a ready host waiting for a real client to occupy the guest seat. */
export function createAiCaptureHost(
  registry: TeamRegistry,
  seed = CAPTURE_SEED,
  code = CAPTURE_CODE,
): AiCaptureRoom {
  const manager = new RoomManager({
    logger: silentLogger,
    registry,
    generateCode: () => code,
    matchSeed: seed,
    aiOnly: true,
  });
  const host = new CaptureClient("capture-host");
  manager.onReady(host);
  manager.onMessage(host, { t: "createRoom" });
  manager.onMessage(host, { t: "setReady", ready: true });
  return { manager, host, code };
}

/** Starts a deterministic AI-vs-AI room; both seats stay connected. */
export function createAiCaptureRoom(
  registry: TeamRegistry,
  seed = CAPTURE_SEED,
  code = CAPTURE_CODE,
): AiCaptureRoom {
  const room = createAiCaptureHost(registry, seed, code);
  const guest = new CaptureClient("capture-guest");
  room.manager.onReady(guest);
  room.manager.onMessage(guest, {
    t: "joinRoom",
    code,
  } satisfies ClientMessage);
  room.manager.onMessage(guest, { t: "setReady", ready: true });
  return room;
}

/** Advances the room until its normal score-change hook publishes a clip. */
export function waitForNaturalGoal(
  room: AiCaptureRoom,
  maxTicks = CAPTURE_MAX_TICKS,
): WireReplayClip {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    room.manager.tick(1 / TUNING.sim.tickHz);
    const clips = latestReplayClips(room.host);
    const latest = clips.at(-1);
    if (latest !== undefined) {
      return latest;
    }
  }
  throw new Error(
    `No natural goal was captured in room ${room.code} within ${maxTicks} ticks`,
  );
}
