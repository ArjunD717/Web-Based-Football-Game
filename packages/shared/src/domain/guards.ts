// packages/shared/src/domain/guards.ts

/** Canonical object guard for untrusted JSON boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
