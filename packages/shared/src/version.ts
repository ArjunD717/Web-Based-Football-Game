// packages/shared/src/version.ts

/** Display and handshake version for the application. */
export const APP_VERSION = "0.1.0";

/**
 * Wire protocol version. Bump whenever a message shape or meaning changes;
 * the server refuses clients on a different version instead of guessing.
 */
export const PROTOCOL_VERSION = 8;
