// tools/character/bake_animations.ts

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORED_CLIP_PLAN } from "../../packages/client/src/render/character-clip-plan";
import { computeCharacterPose } from "../../packages/client/src/render/character-animation";
import { PLAYER_STATE_CODES } from "../../packages/shared/src/domain/player-state";

const FPS = 30;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(repoRoot, ".tmp-assets", "player-animations.json");

interface Sample {
  readonly frame: number;
  readonly rotation: readonly [number, number, number];
}

function sampleClip(spec: (typeof AUTHORED_CLIP_PLAN)[number]): {
  readonly name: string;
  readonly loop: boolean;
  readonly frameCount: number;
  readonly tracks: Record<string, Sample[]>;
} {
  const sampleCount = Math.max(2, Math.round(spec.durationSeconds * FPS));
  const rotations = new Map<string, [number, number, number][]>();
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = (index / sampleCount) * spec.durationSeconds;
    const phase =
      (Math.PI * 2 * index * spec.phaseScale) / sampleCount;
    const pose = computeCharacterPose(spec.state, phase, 1, t);
    for (const [bone, rotation] of Object.entries(pose.rotations)) {
      const track = rotations.get(bone) ?? [];
      track.push([rotation.x, rotation.y, rotation.z]);
      rotations.set(bone, track);
    }
  }
  const tracks: Record<string, Sample[]> = {};
  for (const [bone, values] of [...rotations.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    tracks[bone] = values.map((rotation, frame) => ({ frame, rotation }));
  }
  return {
    name: spec.state,
    loop: spec.loop,
    frameCount: sampleCount,
    tracks,
  };
}

const seen = new Set<string>();
for (const spec of AUTHORED_CLIP_PLAN) {
  if (seen.has(spec.state)) {
    throw new Error(`Duplicate authored clip for ${spec.state}`);
  }
  seen.add(spec.state);
}
for (const state of PLAYER_STATE_CODES) {
  if (!seen.has(state)) {
    throw new Error(`Missing authored clip for ${state}`);
  }
}

const clips = AUTHORED_CLIP_PLAN.map(sampleClip);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify({
    fps: FPS,
    clips,
  }),
);
console.log(
  `wrote ${clips.length} clips, ${clips.reduce(
    (total, clip) => total + clip.frameCount + 1,
    0,
  )} samples -> ${path.relative(repoRoot, output)}`,
);
