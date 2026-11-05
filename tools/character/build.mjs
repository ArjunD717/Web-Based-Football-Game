// tools/character/build.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const preview = process.argv.includes("--preview");
const blender = process.env.BLENDER_BIN ?? findBlender();
const python = process.env.PYTHON_BIN ?? findPython();

const scripts = [
  "generate_pbr_textures.py",
  "generate_face_textures.py",
  "generate_hair_texture.py",
  "generate_kit_textures.py",
];

for (const script of scripts) {
  run(python.command, [...python.prefix, path.join("tools", script)]);
}

run(process.execPath, [
  path.join(repoRoot, "packages", "sim", "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(repoRoot, "tools", "character", "bake_animations.ts"),
]);

run(blender, [
  "-b",
  "--factory-startup",
  "--python",
  path.join("tools", "blender", "build_player.py"),
]);

const source = path.join(repoRoot, "assets", "characters", "player-01.glb");
if (!existsSync(source) || statSync(source).size < 1_000_000) {
  fail(`Blender did not produce a usable player GLB at ${source}`);
}
const publicDir = path.join(repoRoot, "packages", "client", "public", "characters");
mkdirSync(publicDir, { recursive: true });
copyFileSync(source, path.join(publicDir, "player-01.glb"));
const matchSource = path.join(repoRoot, "assets", "characters", "player-01-match.glb");
if (!existsSync(matchSource) || statSync(matchSource).size < 500_000) {
  fail(`Blender did not produce a usable match LOD at ${matchSource}`);
}
copyFileSync(matchSource, path.join(publicDir, "player-01-match.glb"));
console.log(`copied ${path.relative(repoRoot, source)} and player-01-match.glb -> packages/client/public/characters/`);

if (preview) {
  run(blender, [
    "-b",
    "--factory-startup",
    "--python",
    path.join("tools", "blender", "render_preview.py"),
  ]);
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    fail(`${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`\ncharacter build failed: ${message}`);
  process.exit(1);
}

function findBlender() {
  if (process.env.BLENDER_BIN) {
    return process.env.BLENDER_BIN;
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe",
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  const probe = spawnSync("blender", ["--version"], { stdio: "ignore" });
  if (probe.status === 0) {
    return "blender";
  }
  fail(
    "Blender 4.5+ not found. Set BLENDER_BIN to the Blender executable and rerun `pnpm character:build`.",
  );
}

function findPython() {
  if (process.env.PYTHON_BIN) {
    return { command: process.env.PYTHON_BIN, prefix: [] };
  }
  for (const candidate of ["python", "python3"]) {
    const probe = spawnSync(candidate, ["-c", "import PIL, numpy"], { stdio: "ignore" });
    if (probe.status === 0) {
      return { command: candidate, prefix: [] };
    }
  }
  fail(
    "Python with Pillow and NumPy not found. Set PYTHON_BIN and install the character build requirements.",
  );
}
