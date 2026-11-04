// packages/client/src/camera/cameraTuning.test.ts

import { describe, expect, it } from "vitest";
import {
  CAMERA_TUNING,
  CAMERA_TUNING_RANGES,
  type CameraTuning,
} from "./cameraTuning";

function numericPaths(
  object: Record<string, unknown>,
  prefix = "",
): readonly { path: string; value: number }[] {
  const found: { path: string; value: number }[] = [];
  for (const [key, value] of Object.entries(object)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "number") {
      found.push({ path, value });
    } else if (typeof value === "object" && value !== null) {
      found.push(
        ...numericPaths(value as Record<string, unknown>, path),
      );
    }
  }
  return found;
}

describe("camera tuning", () => {
  it("has an editor range for every numeric value", () => {
    const tuning = CAMERA_TUNING as unknown as Record<string, unknown>;
    const paths = numericPaths(tuning);
    expect(paths.length).toBeGreaterThan(0);
    for (const entry of paths) {
      expect(
        CAMERA_TUNING_RANGES[entry.path],
        `missing range for ${entry.path}`,
      ).toBeDefined();
    }
  });

  it("keeps every default inside its editor range", () => {
    const tuning = CAMERA_TUNING as unknown as Record<string, unknown>;
    for (const entry of numericPaths(tuning)) {
      const range = CAMERA_TUNING_RANGES[entry.path]!;
      expect(entry.value, entry.path).toBeGreaterThanOrEqual(range.min);
      expect(entry.value, entry.path).toBeLessThanOrEqual(range.max);
    }
  });

  it("covers the camera and broadcast sections", () => {
    const tuning: CameraTuning = CAMERA_TUNING;
    expect(tuning.broadcast.ballWeight).toBeGreaterThan(0);
    expect(tuning.camera.nearClipM).toBeGreaterThan(0);
    expect(tuning.camera.farClipM).toBeGreaterThan(
      tuning.camera.nearClipM,
    );
  });
});
