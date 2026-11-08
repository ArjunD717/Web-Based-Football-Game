// scripts/replay-browser-acceptance.mjs

import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = 4173;
const URL = `http://${HOST}:${PORT}/replay-acceptance.html`;

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
  throw new Error(`Vite preview did not serve ${URL} within 30s`);
}

const preview = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  [
    "--filter",
    "@fb/client",
    "exec",
    "vite",
    "preview",
    "--host",
    HOST,
    "--port",
    String(PORT),
    "--strictPort",
  ],
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
} finally {
  await browser?.close();
  stopPreview(preview);
}
