// packages/client/src/render/ktx2-asset.test.ts

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface GlbContents {
  readonly json: {
    readonly extensionsRequired?: readonly string[];
    readonly images?: readonly {
      readonly mimeType?: string;
      readonly bufferView?: number;
    }[];
    readonly meshes?: readonly { readonly name?: string }[];
    readonly animations?: readonly unknown[];
    readonly bufferViews?: readonly {
      readonly byteOffset?: number;
      readonly byteLength: number;
    }[];
  };
  readonly binary: Buffer;
}

const ASSETS = [
  {
    file: "player-01-match.ktx2.glb",
    imageCount: 5,
    meshes: [
      "eye_decal_l",
      "eye_decal_r",
      "Sphere",
      "Sphere.001",
      "kit_boots",
      "kit_collar",
      "kit_shirt",
      "kit_shorts",
      "kit_socks",
      "player-01-body",
    ],
    maxBytes: 900_000,
  },
  {
    file: "player-01-low.ktx2.glb",
    imageCount: 4,
    meshes: [
      "kit_boots",
      "kit_collar",
      "kit_shirt",
      "kit_shorts",
      "kit_socks",
      "player-01-body",
    ],
    maxBytes: 700_000,
  },
] as const;

function assetUrl(name: string): URL {
  return new URL(`../../../../assets/characters/${name}`, import.meta.url);
}

function readGlb(name: string): GlbContents {
  const data = readFileSync(assetUrl(name));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(
    data.subarray(20, 20 + jsonLength).toString("utf8").trim(),
  ) as GlbContents["json"];
  const binaryStart = 12 + 8 + jsonLength + 8;
  return { json, binary: data.subarray(binaryStart) };
}

function imageBytes(contents: GlbContents, imageIndex: number): Buffer {
  const bufferView = contents.json.images?.[imageIndex]?.bufferView;
  const view =
    bufferView === undefined
      ? undefined
      : contents.json.bufferViews?.[bufferView];
  if (view === undefined) {
    throw new Error(`image buffer view ${imageIndex} missing`);
  }
  const start = view.byteOffset ?? 0;
  return contents.binary.subarray(start, start + view.byteLength);
}

describe("KTX2 authored assets", () => {
  it("ship KTX2 textures with only the Basis extension required", () => {
    for (const asset of ASSETS) {
      const contents = readGlb(asset.file);
      expect(contents.json.extensionsRequired).toContain(
        "KHR_texture_basisu",
      );
      expect(contents.json.extensionsRequired).not.toContain(
        "EXT_texture_webp",
      );
      expect(contents.json.images).toHaveLength(asset.imageCount);
      for (const image of contents.json.images ?? []) {
        expect(image.mimeType).toBe("image/ktx2");
      }
      expect(contents.json.meshes?.map((mesh) => mesh.name)).toEqual(
        asset.meshes,
      );
      expect(contents.json.animations).toHaveLength(15);
    }
  });

  it("embed a valid KTX2 signature in every image", () => {
    for (const asset of ASSETS) {
      const contents = readGlb(asset.file);
      for (
        let index = 0;
        index < (contents.json.images?.length ?? 0);
        index += 1
      ) {
        expect(imageBytes(contents, index).subarray(0, 12).toString("hex")).toBe(
          "ab4b5458203230bb0d0a1a0a",
        );
      }
    }
  });

  it("stays inside the KTX2 byte ceilings", () => {
    for (const asset of ASSETS) {
      expect(readFileSync(assetUrl(asset.file)).byteLength).toBeLessThanOrEqual(
        asset.maxBytes,
      );
    }
  });
});
