// packages/server/src/index.ts
import qrcode from "qrcode-terminal";
import {
  APP_VERSION,
  PROTOCOL_VERSION,
  TUNING,
  WS_PATH,
} from "@fb/shared";
import { consoleLogger, startGameServer } from "./create-server";
import { loadServerConfig } from "./config";
import { loadTeamRegistry } from "./data/registry";
import { formatHttpsUrl, listLanIpv4Addresses } from "./lan";
import { RoomManager } from "./rooms/room-manager";
import { ServerTickMetrics } from "./performance";
import { loadTlsMaterial } from "./tls";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const tls = await loadTlsMaterial(config.certPath, config.keyPath);
  const registry = await loadTeamRegistry(config.dataDir);
  const lanAddresses = listLanIpv4Addresses();
  const primaryAddress = lanAddresses[0] ?? "localhost";
  const tickMetrics = new ServerTickMetrics();
  const tickBudgetMs = 1_000 / TUNING.sim.tickHz;
  let runtimePort = config.port;

  const roomManager = new RoomManager({
    logger: consoleLogger,
    registry,
    onRoomCreated: (code) => {
      const base = formatHttpsUrl(primaryAddress, runtimePort);
      const url = `${base}/?room=${code}`;
      const controllerUrl = `${base}/controller.html?room=${code}`;
      console.log("");
      console.log(`Room ${code} join URL: ${url}`);
      console.log(`Room ${code} phone controller: ${controllerUrl}`);
      qrcode.generate(url, { small: true });
      console.log("");
    },
  });

  const running = await startGameServer({
    host: config.host,
    port: config.port,
    staticDir: config.staticDir,
    dataDir: config.dataDir,
    tls,
    getRuntimeMetrics: () => tickMetrics.snapshot(),
    handlers: {
      onReady: (client) => {
        roomManager.onReady(client);
      },
      onMessage: (client, message) => {
        roomManager.onMessage(client, message);
      },
      onBinaryMessage: (client, data) => {
        roomManager.onBinaryMessage(client, data);
      },
      onDisconnect: (client) => {
        roomManager.onDisconnect(client);
      },
    },
  });
  runtimePort = running.port;

  let lastFrameAt = performance.now();
  let lastSlowTickLogAt = 0;
  // Drive the accumulator at the simulated rate instead of waking four times
  // as often. The accumulator still absorbs ordinary timer jitter.
  const simulationLoop = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(
      (now - lastFrameAt) / 1_000,
      TUNING.presentation.maxFrameDeltaSeconds,
    );
    lastFrameAt = now;
    const tickStartedAt = performance.now();
    roomManager.tick(dt);
    const elapsed = performance.now() - tickStartedAt;
    tickMetrics.record(elapsed);
    if (elapsed > tickBudgetMs && now - lastSlowTickLogAt >= 5_000) {
      lastSlowTickLogAt = now;
      console.warn(
        `Server tick over budget: ${elapsed.toFixed(1)} ms > ${tickBudgetMs.toFixed(1)} ms`,
      );
    }
  }, 1_000 / TUNING.sim.tickHz);
  simulationLoop.unref();

  const localUrl = formatHttpsUrl("localhost", running.port);
  const lanUrl = formatHttpsUrl(primaryAddress, running.port);

  console.log("");
  console.log(`Web Football ${APP_VERSION} / protocol ${PROTOCOL_VERSION}`);
  console.log(`Secure server: ${localUrl}`);
  for (const address of lanAddresses) {
    console.log(`LAN:           ${formatHttpsUrl(address, running.port)}`);
  }
  if (lanAddresses.length === 0) {
    console.log("LAN:           no non-loopback IPv4 address found");
  }
  console.log(
    `WebSocket:     ${WS_PATH} (${TUNING.network.snapshotHz} Hz snapshots, ${TUNING.sim.tickHz} Hz loop)`,
  );
  console.log(`Client dist:   ${config.staticDir}`);
  console.log(`Match data:    ${config.dataDir} (${registry.teams.length} teams)`);
  console.log("If the client is missing, run pnpm dev (Vite :5173) or pnpm build.");
  console.log("");
  console.log("Scan to open the lobby:");
  qrcode.generate(lanUrl, { small: true });
  console.log("Create a room, then scan/share the room QR printed below.");
  console.log("Press Ctrl+C to stop.");
  console.log("");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n${signal} received; closing connections...`);
    clearInterval(simulationLoop);
    roomManager.close();
    void running.close().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        console.error("Shutdown failed", error);
        process.exit(1);
      },
    );
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start server: ${message}`);
  process.exitCode = 1;
});
