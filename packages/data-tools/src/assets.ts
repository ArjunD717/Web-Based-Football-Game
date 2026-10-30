// packages/data-tools/src/assets.ts

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PlayerData, TeamData } from "@fb/shared";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function crestSvg(team: TeamData): string {
  const label = escapeXml(initials(team.name) || team.short);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" role="img" aria-label="${escapeXml(`${team.name} placeholder crest`)}">
  <path d="M64 4 120 24v54c0 30-22 54-56 66C30 132 8 108 8 78V24Z" fill="${team.colours.home}" stroke="${team.colours.away}" stroke-width="6"/>
  <path d="M64 18 106 33v43c0 22-16 41-42 52-26-11-42-30-42-52V33Z" fill="${team.colours.away}" opacity=".35"/>
  <circle cx="64" cy="68" r="31" fill="${team.colours.third}" opacity=".9"/>
  <text x="64" y="79" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="700" fill="${team.colours.home}">${label}</text>
</svg>
`;
}

function kitSvg(team: TeamData, body: string, trim: string): string {
  const label = escapeXml(team.short);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" role="img" aria-label="${escapeXml(`${team.name} placeholder shirt`)}">
  <path d="M34 18 48 10c5 7 19 7 24 0l14 8 22 17-15 21-11-8v72H38V48l-11 8L12 35Z" fill="${body}" stroke="${trim}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M48 10c5 7 19 7 24 0" fill="none" stroke="${team.colours.third}" stroke-width="5"/>
  <text x="60" y="94" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="${trim}">${label}</text>
</svg>
`;
}

function faceSvg(player: PlayerData, index: number): string {
  const hue = (index * 47) % 360;
  const label = escapeXml(initials(player.name));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${escapeXml(`${player.name} placeholder portrait`)}">
  <rect width="96" height="96" rx="18" fill="hsl(${hue} 42% 24%)"/>
  <circle cx="48" cy="38" r="18" fill="hsl(${hue} 56% 72%)"/>
  <path d="M16 92c4-20 17-30 32-30s28 10 32 30Z" fill="hsl(${hue} 56% 58%)"/>
  <text x="48" y="84" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#fff">${label}</text>
</svg>
`;
}

async function writeSvg(absolutePath: string, content: string): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

export async function generateAssets(
  dataDir: string,
  teams: readonly TeamData[],
  nationalTeams: readonly TeamData[],
  players: readonly PlayerData[],
): Promise<{ crests: number; kits: number; faces: number }> {
  const allTeams = [...teams, ...nationalTeams];
  for (const team of allTeams) {
    await writeSvg(join(dataDir, team.crest), crestSvg(team));
    await writeSvg(
      join(dataDir, team.kits.home),
      kitSvg(team, team.colours.home, team.colours.away),
    );
    await writeSvg(
      join(dataDir, team.kits.away),
      kitSvg(team, team.colours.away, team.colours.home),
    );
    await writeSvg(
      join(dataDir, team.kits.third),
      kitSvg(team, team.colours.third, team.colours.home),
    );
  }

  await Promise.all(
    players.map((player, index) =>
      writeSvg(join(dataDir, player.face), faceSvg(player, index)),
    ),
  );

  return {
    crests: allTeams.length,
    kits: allTeams.length * 3,
    faces: players.length,
  };
}
