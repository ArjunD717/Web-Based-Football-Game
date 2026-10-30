// scripts/start.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build") || process.env.FB_SKIP_BUILD === "1";
const skipCerts = args.has("--skip-certs") || process.env.FB_SKIP_CERTS === "1";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pnpmScript =
  process.env.npm_execpath !== undefined &&
  process.env.npm_execpath.endsWith(".cjs") &&
  existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : null;
const pnpmCommand = pnpmScript === null ? pnpm : process.execPath;
const pnpmPrefix = pnpmScript === null ? [] : [pnpmScript];
const pnpmOptions = {
  shell: pnpmScript === null && process.platform === "win32",
};
const env = { ...process.env };

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: pnpm start [--skip-build] [--skip-certs]

Builds the client, generates mkcert certificates when missing, ensures the
generated data exists, then serves the packaged game over HTTPS/WSS.

Environment:
  FB_PORT, FB_HOST, FB_CERT_DIR, FB_STATIC_DIR, FB_DATA_DIR
  FB_SKIP_BUILD=1 / FB_SKIP_CERTS=1`);
  process.exit(0);
}

const staticDir = env.FB_STATIC_DIR
  ? path.resolve(env.FB_STATIC_DIR)
  : path.join(repoRoot, "packages", "client", "dist");
const customStatic = env.FB_STATIC_DIR !== undefined;
if (!skipBuild && !customStatic) {
  console.log("Building client...");
  run(["--filter", "@fb/client", "build"], "Client build failed");
}
if (!existsSync(path.join(staticDir, "index.html"))) {
  fail(
    customStatic
      ? `FB_STATIC_DIR is missing index.html: ${staticDir}`
      : "Client build is missing; run without --skip-build first.",
  );
}

const certPath = path.join(
  env.FB_CERT_DIR ? path.resolve(env.FB_CERT_DIR) : path.join(repoRoot, "certs"),
  "dev-cert.pem",
);
const keyPath = path.join(path.dirname(certPath), "dev-key.pem");
if (!existsSync(certPath) || !existsSync(keyPath)) {
  if (skipCerts || env.FB_AUTO_CERTS === "0") {
    fail(
      "TLS certificate is missing. Run `pnpm certs` (requires mkcert), then retry.",
    );
  }
  console.log("TLS certificate missing; generating one with mkcert...");
  runNode(
    [path.join(repoRoot, "scripts", "setup-certs.mjs")],
    "Certificate setup failed",
  );
}

const dataDir = env.FB_DATA_DIR
  ? path.resolve(env.FB_DATA_DIR)
  : path.join(repoRoot, "data");
if (
  !existsSync(path.join(dataDir, "manifest.json")) ||
  !existsSync(path.join(dataDir, "teams.json"))
) {
  if (env.FB_DATA_DIR !== undefined) {
    fail(`FB_DATA_DIR has no generated registry: ${dataDir}`);
  }
  console.log("Generated football data missing; building the sample registry...");
  run(["data:build"], "Data build failed");
}

const child = spawn(
  pnpmCommand,
  [...pnpmPrefix, "--filter", "@fb/server", "start"],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    ...pnpmOptions,
  },
);

let stopping = false;
const stop = (signal) => {
  if (stopping) {
    return;
  }
  stopping = true;
  child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

child.once("error", (error) => {
  console.error(`Could not start the server: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) {
    console.log(`Server stopped by ${signal}.`);
  }
  process.exitCode = code ?? (signal === null ? 1 : 0);
});

function run(commandArgs, failureMessage) {
  const result = spawnSync(pnpmCommand, [...pnpmPrefix, ...commandArgs], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    ...pnpmOptions,
  });
  if (result.error !== undefined) {
    fail(`${failureMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(failureMessage);
  }
}

function runNode(commandArgs, failureMessage) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    fail(`${failureMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(failureMessage);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
