// packages/server/src/lan.ts
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export type NetworkInterfaceMap = Readonly<
  Record<string, readonly NetworkInterfaceInfo[] | undefined>
>;

/**
 * LAN IPv4 addresses in deterministic order.
 * Loopback, IPv6 and link-local (169.254/16) addresses are not joinable URLs.
 */
export function listLanIpv4Addresses(
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      if (entry.address.startsWith("169.254.")) {
        continue;
      }
      addresses.add(entry.address);
    }
  }

  return [...addresses].sort((a, b) => ipv4ToNumber(a) - ipv4ToNumber(b));
}

export function formatHttpsUrl(host: string, port: number): string {
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return `https://${displayHost}:${port}`;
}

function ipv4ToNumber(address: string): number {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}
