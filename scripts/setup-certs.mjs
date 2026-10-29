// scripts/setup-certs.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const certDir = path.join(repoRoot, "certs");
const certPath = path.join(certDir, "dev-cert.pem");
const keyPath = path.join(certDir, "dev-key.pem");
const skipCaInstall = process.argv.includes("--no-ca-install");
const mkcert = process.env.MKCERT_BIN ?? "mkcert";

const lanIps = listLanIpv4Addresses();
const hosts = [
  "localhost",
  "127.0.0.1",
  "::1",
  ...lanIps.filter((ip) => !["127.0.0.1", "::1"].includes(ip)),
];

if (!probeMkcert()) {
  console.error(`
mkcert was not found on PATH.

Install it, then run this script again:
  Windows:  winget install --id FiloSottile.mkcert -e
  macOS:    brew install mkcert nss
  Linux:    https://github.com/FiloSottile/mkcert#installation

If mkcert lives somewhere else, set MKCERT_BIN to its full path.
`);
  process.exit(1);
}

mkdirSync(certDir, { recursive: true });

if (!skipCaInstall) {
  console.log("Installing the mkcert local CA (may prompt for permission)...");
  const install = spawnSync(mkcert, ["-install"], { stdio: "inherit" });
  if (install.status !== 0) {
    console.error(`
mkcert -install failed. On Windows, run this command once from an elevated
terminal to trust mkcert's CA, then rerun:
  pnpm certs -- --no-ca-install
`);
    process.exit(1);
  }
}

console.log(`Generating a certificate for: ${hosts.join(", ")}`);
const result = spawnSync(
  mkcert,
  ["-key-file", keyPath, "-cert-file", certPath, ...hosts],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  console.error("mkcert failed to generate the development certificate.");
  process.exit(1);
}

console.log(`
Development certificate ready:
  cert: ${certPath}
  key:  ${keyPath}

These files are git-ignored. Rerun "pnpm certs" whenever your LAN IP changes.
Next:
  1. pnpm dev
  2. Open the Vite HTTPS URL printed by the client, or copy it to a phone
     that is on the same network.
  3. Allow Node through the OS firewall when prompted (private networks).
`);

function probeMkcert() {
  const probe = spawnSync(mkcert, ["-version"], { encoding: "utf8" });
  return probe.error === undefined && probe.status === 0;
}

function listLanIpv4Addresses() {
  const addresses = new Set();
  for (const entries of Object.values(networkInterfaces())) {
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
  return [...addresses].sort();
}
