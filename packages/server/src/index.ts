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
import { ReplayStore } from "./replays/replay-store";
import { RoomManager } from "./rooms/room-manager";
import { startSimulationLoop } from "./rooms/simulation-loop";
import { ServerTickMetrics } from "./performance";
import { loadTlsMaterial } from "./tls";

async function main(): Promise<void> {
  const config = loadServerConfig();
  const tls = await loadTlsMaterial(config.certPath, config.keyPath);
  const registry = await loadTeamRegistry(config.dataDir);
  const replayStore = new ReplayStore({
    dir: config.replayDir,
    logger: consoleLogger,
  });
  await replayStore.initialize();
  const lanAddresses = listLanIpv4Addresses();
  const primaryAddress = lanAddresses[0] ?? "localhost";
  const tickMetrics = new ServerTickMetrics();
  const tickBudgetMs = 1_000 / TUNING.sim.tickHz;
  let runtimePort = config.port;

  const roomManager = new RoomManager({
    logger: consoleLogger,
    registry,
    replayStore,
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
    devNetwork: config.devNetwork,
    getRuntimeMetrics: () => tickMetrics.snapshot(),
    getReplayExport: (code) => roomManager.exportReplay(code),
    getReplayClip: (code, clipId) =>
      roomManager.exportReplayClip(code, clipId),
    getReplayLibrary: () => ({ rooms: replayStore.listRooms() }),
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

  let lastSlowTickLogAt = 0;
  // One timer drives every room. Timers only measure wall time; the match
  // still advances through the fixed-step accumulator in RoomManager.
  const simulationLoop = startSimulationLoop(roomManager, {
    onTick: (elapsed) => {
      tickMetrics.record(elapsed);
      const now = performance.now();
      if (elapsed > tickBudgetMs && now - lastSlowTickLogAt >= 5_000) {
        lastSlowTickLogAt = now;
        console.warn(
          `Server tick over budget: ${elapsed.toFixed(1)} ms > ${tickBudgetMs.toFixed(1)} ms`,
        );
      }
    },
  });

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
  console.log(`Replay library: ${config.replayDir}`);
  if (
    config.devNetwork.latencyMs > 0 ||
    config.devNetwork.jitterMs > 0 ||
    config.devNetwork.lossPct > 0
  ) {
    console.warn(
      `Dev network:   ${config.devNetwork.latencyMs} ms +-${config.devNetwork.jitterMs} ms, ${config.devNetwork.lossPct}% snapshot loss`,
    );
  }
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
    simulationLoop.stop();
    roomManager.close();
    void replayStore
      .flush()
      .then(() => running.close())
      .then(
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
