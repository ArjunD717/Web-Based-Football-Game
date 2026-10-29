// packages/server/src/client.ts
import type { ClientMessage, ServerMessage } from "@fb/shared";

/** Stable identity for one browser session, resumable via its token. */
export interface ClientConnection {
  readonly token: string;
  send(message: ServerMessage): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

/** Application callbacks layered above the transport handshake. */
export interface GameServerHandlers {
  onReady?(client: ClientConnection): void;
  onMessage?(client: ClientConnection, message: ClientMessage): void;
  onBinaryMessage?(client: ClientConnection, data: Uint8Array): void;
  onDisconnect?(client: ClientConnection): void;
}
