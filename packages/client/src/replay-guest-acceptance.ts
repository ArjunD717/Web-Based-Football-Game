// packages/client/src/replay-guest-acceptance.ts

import { connectAcceptanceRoom } from "./acceptance/room-socket";

const result = document.querySelector<HTMLElement>("#result")!;

const socketReport = await connectAcceptanceRoom("guest");
const passed =
  socketReport.role === "guest" &&
  socketReport.secureContext &&
  socketReport.connected &&
  socketReport.welcome &&
  socketReport.pong &&
  socketReport.joined &&
  socketReport.teamSelected &&
  socketReport.ready &&
  socketReport.matchStarted &&
  socketReport.replayNotified;

const report = {
  status: passed ? "PASS" : "FAIL",
  role: "guest",
  tls: {
    protocol: location.protocol,
    secureContext: window.isSecureContext,
  },
  socket: socketReport,
};
result.textContent = JSON.stringify(report, null, 2);
const acceptanceWindow = window as Window & {
  __guestAcceptance?: typeof report;
};
acceptanceWindow.__guestAcceptance = report;
