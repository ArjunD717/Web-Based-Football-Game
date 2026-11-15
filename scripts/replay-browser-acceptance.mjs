// scripts/replay-browser-acceptance.mjs

import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `https://${HOST}:${PORT}`;
const HOST_URL = `${BASE_URL}/replay-acceptance.html`;
const GUEST_URL = `${BASE_URL}/replay-guest-acceptance.html`;
const FIXTURE_PATH = "packages/client/public/fixtures/server-goal-replay.json";

function stopPreview(child) {
  if (child === null || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

function getInsecure(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    request.setTimeout(2_000, () => {
      request.destroy(new Error("request timed out"));
    });
    request.on("error", reject);
  });
}

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await getInsecure(HOST_URL);
      if (response.status === 200) {
        return;
      }
    } catch {
      // The TLS server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`HTTPS replay server did not serve ${HOST_URL} within 30s`);
}

async function waitForReport(page, name) {
  await page.waitForFunction(
    (key) => {
      const report = globalThis[key];
      return report !== undefined && report !== null;
    },
    name,
    { timeout: 180_000 },
  );
  return page.evaluate((key) => globalThis[key], name);
}

const preview = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@fb/server", "serve:replay"],
  { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
);

let browser = null;
try {
  await waitForPreview();
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const hostContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });
  const guestContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const hostErrors = [];
  const guestErrors = [];
  hostPage.on("pageerror", (error) => hostErrors.push(error.message));
  guestPage.on("pageerror", (error) => guestErrors.push(error.message));

  await Promise.all([
    hostPage.goto(HOST_URL, { waitUntil: "networkidle" }),
    guestPage.goto(GUEST_URL, { waitUntil: "networkidle" }),
  ]);
  const [hostReport, guestReport] = await Promise.all([
    waitForReport(hostPage, "__replayAcceptance"),
    waitForReport(guestPage, "__guestAcceptance"),
  ]);

  console.log("HOST");
  console.log(JSON.stringify(hostReport, null, 2));
  console.log("GUEST");
  console.log(JSON.stringify(guestReport, null, 2));

  if (hostErrors.length > 0) {
    throw new Error(`Host page errors: ${hostErrors.join(" | ")}`);
  }
  if (guestErrors.length > 0) {
    throw new Error(`Guest page errors: ${guestErrors.join(" | ")}`);
  }
  if (hostReport.status !== "PASS") {
    throw new Error(`Host replay acceptance failed: ${hostReport.status}`);
  }
  if (guestReport.status !== "PASS") {
    throw new Error(`Guest room acceptance failed: ${guestReport.status}`);
  }
  if (hostReport.replayCode !== "ABCD" || hostReport.frameCount < 90) {
    throw new Error("Host did not load the exported fixture");
  }
  if (!hostReport.taaSupported || hostReport.timelineResets !== 5) {
    throw new Error("Host did not observe all TAA timeline resets");
  }
  if (
    hostReport.source !== "http" ||
    hostReport.endpoint !== "/api/replay/ABCD/g1.json"
  ) {
    throw new Error("Host did not load through the HTTP replay route");
  }
  if (
    hostReport.tls?.protocol !== "https:" ||
    hostReport.tls?.secureContext !== true
  ) {
    throw new Error("Host page is not in a secure context");
  }
  if (
    hostReport.socket?.role !== "host" ||
    hostReport.socket?.secureContext !== true ||
    hostReport.socket?.connected !== true ||
    hostReport.socket?.welcome !== true ||
    hostReport.socket?.pong !== true ||
    hostReport.socket?.createdRoom !== true ||
    hostReport.socket?.joined !== true ||
    hostReport.socket?.teamSelected !== true ||
    hostReport.socket?.ready !== true ||
    hostReport.socket?.matchStarted !== true ||
    hostReport.socket?.replayNotified !== true
  ) {
    throw new Error("Host WSS room lifecycle did not complete");
  }
  if (
    guestReport.tls?.protocol !== "https:" ||
    guestReport.tls?.secureContext !== true
  ) {
    throw new Error("Guest page is not in a secure context");
  }
  if (
    guestReport.socket?.role !== "guest" ||
    guestReport.socket?.secureContext !== true ||
    guestReport.socket?.connected !== true ||
    guestReport.socket?.welcome !== true ||
    guestReport.socket?.pong !== true ||
    guestReport.socket?.joined !== true ||
    guestReport.socket?.teamSelected !== true ||
    guestReport.socket?.ready !== true ||
    guestReport.socket?.matchStarted !== true ||
    guestReport.socket?.replayNotified !== true
  ) {
    throw new Error("Guest WSS room lifecycle did not complete");
  }
  if (
    hostReport.socket.clipId === null ||
    guestReport.socket.clipId !== hostReport.socket.clipId
  ) {
    throw new Error("Host and guest did not receive the same replay notification");
  }

  const liveResponse = await getInsecure(
    `${BASE_URL}/api/replay/${hostReport.replayCode}/${hostReport.clipId}.json`,
  );
  if (liveResponse.status !== 200) {
    throw new Error(`Live replay endpoint returned ${liveResponse.status}`);
  }
  const live = JSON.parse(liveResponse.body);
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const sameSetup =
    live.setup.tickHz === fixture.setup.tickHz &&
    live.setup.snapshotHz === fixture.setup.snapshotHz &&
    JSON.stringify(live.setup.pitch) === JSON.stringify(fixture.setup.pitch) &&
    JSON.stringify(live.setup.home) === JSON.stringify(fixture.setup.home) &&
    JSON.stringify(live.setup.away) === JSON.stringify(fixture.setup.away);
  if (
    live.id !== fixture.id ||
    live.kind !== fixture.kind ||
    live.frameCount !== fixture.frameCount ||
    JSON.stringify(live.frames) !== JSON.stringify(fixture.frames) ||
    !sameSetup
  ) {
    throw new Error("Live HTTP replay payload does not match the fixture");
  }
  if (
    hostReport.motion === null ||
    hostReport.motion === undefined ||
    !hostReport.motion.moved ||
    hostReport.motion.toOffsetMs <= hostReport.motion.fromOffsetMs ||
    (hostReport.motion.playerDeltaM <= 0 &&
      hostReport.motion.ballDeltaM <= 0)
  ) {
    throw new Error("Host did not observe sub-frame replay motion");
  }
} finally {
  await browser?.close();
  stopPreview(preview);
}
