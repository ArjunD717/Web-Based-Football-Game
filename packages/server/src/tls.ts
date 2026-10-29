// packages/server/src/tls.ts
import { readFile } from "node:fs/promises";

export interface TlsMaterial {
  readonly key: Buffer;
  readonly cert: Buffer;
}

export class MissingTlsMaterialError extends Error {
  constructor(public readonly filePath: string) {
    super(
      `TLS file not found: ${filePath}. Run "pnpm certs" after installing mkcert.`,
    );
    this.name = "MissingTlsMaterialError";
  }
}

/** Load the mkcert output; LAN play has no plaintext fallback. */
export async function loadTlsMaterial(
  certPath: string,
  keyPath: string,
): Promise<TlsMaterial> {
  const [cert, key] = await Promise.all([
    readRequired(certPath),
    readRequired(keyPath),
  ]);
  return { cert, key };
}

async function readRequired(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      throw new MissingTlsMaterialError(filePath);
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
