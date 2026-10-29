// packages/client/src/link/main.ts
import { PROTOCOL_VERSION } from "@fb/shared";
import {
  ServerLink,
  type LinkSnapshot,
  type LinkStatus,
} from "../net/connection";
import "./link.css";

const MAX_LOG_ENTRIES = 40;

const STATUS_LABELS: Record<LinkStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  online: "Online",
  retrying: "Retrying",
  offline: "Offline",
};

const statusDot = byId<HTMLSpanElement>("status-dot");
const statusText = byId<HTMLElement>("status");
const statusDetail = byId<HTMLParagraphElement>("status-detail");
const endpoint = byId<HTMLElement>("endpoint");
const latency = byId<HTMLElement>("latency");
const clients = byId<HTMLElement>("clients");
const protocol = byId<HTMLElement>("protocol");
const serverVersion = byId<HTMLElement>("server-version");
const session = byId<HTMLElement>("session");
const reconnectButton = byId<HTMLButtonElement>("reconnect");
const disconnectButton = byId<HTMLButtonElement>("disconnect");
const securityNote = byId<HTMLParagraphElement>("security-note");
const log = byId<HTMLOListElement>("log");
const expectedProtocol = byId<HTMLElement>("expected-protocol");

expectedProtocol.textContent = String(PROTOCOL_VERSION);

if (!window.isSecureContext) {
  securityNote.hidden = false;
}

const link = new ServerLink();
let lastLogKey = "";

link.subscribe((snapshot) => {
  render(snapshot);

  const key = `${snapshot.status}|${snapshot.detail}`;
  if (key !== lastLogKey) {
    lastLogKey = key;
    appendLog(snapshot.status, snapshot.detail);
  }
});

reconnectButton.addEventListener("click", () => {
  link.restart();
});

disconnectButton.addEventListener("click", () => {
  link.stop();
});

link.start();

function render(snapshot: LinkSnapshot): void {
  statusDot.dataset.status = snapshot.status;
  statusText.textContent = STATUS_LABELS[snapshot.status];
  statusDetail.textContent = snapshot.detail;

  endpoint.textContent = snapshot.endpoint;
  latency.textContent =
    snapshot.latencyMs === null ? "—" : `${Math.round(snapshot.latencyMs)} ms`;
  clients.textContent =
    snapshot.connectedClients === null
      ? "—"
      : String(snapshot.connectedClients);
  protocol.textContent =
    snapshot.protocolVersion === null
      ? "—"
      : String(snapshot.protocolVersion);
  serverVersion.textContent = snapshot.serverVersion ?? "—";
  session.textContent =
    snapshot.sessionId === null ? "—" : snapshot.sessionId.slice(0, 8);

  disconnectButton.disabled =
    snapshot.status === "idle" || snapshot.status === "offline";
}

function appendLog(status: LinkStatus, detail: string): void {
  const item = document.createElement("li");
  const time = document.createElement("time");
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString([], { hour12: false });

  const label = document.createElement("span");
  label.className = "log-status";
  label.dataset.status = status;
  label.textContent = STATUS_LABELS[status];

  const message = document.createElement("span");
  message.textContent = detail;

  item.append(time, label, message);
  log.prepend(item);

  while (log.children.length > MAX_LOG_ENTRIES) {
    log.lastElementChild?.remove();
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}
