// scripts/replay-browser-acceptance.mjs

import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const URL = `${BASE_URL}/replay-acceptance.html`;
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

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`HTTP replay server did not serve ${URL} within 30s`);
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__replayAcceptance !== null, null, {
    timeout: 30_000,
  });
  const report = await page.evaluate(() => globalThis.__replayAcceptance);
  if (pageErrors.length > 0) {
    throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
  }
  if (report === null || report === undefined) {
    throw new Error("Replay acceptance page did not publish a report");
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") {
    throw new Error(`Replay acceptance failed: ${report.status}`);
  }
  if (report.replayCode !== "ABCD" || report.frameCount < 90) {
    throw new Error("Replay acceptance did not load the exported fixture");
  }
  if (!report.taaSupported || report.timelineResets !== 5) {
    throw new Error("Replay acceptance did not observe all TAA timeline resets");
  }
  if (report.source !== "http" || report.endpoint !== "/api/replay/ABCD/g1.json") {
    throw new Error("Replay acceptance did not load through the HTTP replay route");
  }
  const liveResponse = await fetch(
    `${BASE_URL}/api/replay/${report.replayCode}/${report.clipId}.json`,
  );
  if (!liveResponse.ok) {
    throw new Error(`Live replay endpoint returned ${liveResponse.status}`);
  }
  const live = await liveResponse.json();
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
    report.motion === null ||
    report.motion === undefined ||
    !report.motion.moved ||
    report.motion.toOffsetMs <= report.motion.fromOffsetMs ||
    (report.motion.playerDeltaM <= 0 && report.motion.ballDeltaM <= 0)
  ) {
    throw new Error("Replay acceptance did not observe sub-frame motion");
  }
} finally {
  await browser?.close();
  stopPreview(preview);
}
