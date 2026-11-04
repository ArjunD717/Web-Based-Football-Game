// packages/client/src/render/screen-indicators.ts

import type { Camera, Vector3 } from "three";
import type { ScreenIndicator } from "./renderer";


const EDGE_FRACTION = 0.9;
const MIN_DIRECTION = 0.0001;

/**
 * Project a world point into the HUD edge ring. Returns null while the point
 * is inside the frame; the renderer uses the normalized result for DOM arrows.
 */
export function projectScreenIndicator(
  id: ScreenIndicator["id"],
  world: Vector3,
  camera: Camera,
): ScreenIndicator | null {
  camera.updateMatrixWorld();
  const local = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const projected = world.clone().project(camera);
  const onScreen =
    local.z < 0 &&
    Math.abs(projected.x) <= 1 &&
    Math.abs(projected.y) <= 1;
  if (onScreen) {
    return null;
  }
  let ndcX = projected.x;
  let ndcY = projected.y;
  if (local.z >= 0) {
    ndcX = -local.x;
    ndcY = local.y;
  }
  if (
    Math.abs(ndcX) < MIN_DIRECTION &&
    Math.abs(ndcY) < MIN_DIRECTION
  ) {
    ndcY = -1;
  }
  const magnitude = Math.max(
    Math.abs(ndcX),
    Math.abs(ndcY),
    MIN_DIRECTION,
  );
  ndcX = (ndcX / magnitude) * EDGE_FRACTION;
  ndcY = (ndcY / magnitude) * EDGE_FRACTION;
  return {
    id,
    x: (ndcX + 1) / 2,
    y: (1 - ndcY) / 2,
    angle: Math.atan2(-ndcY, ndcX),
  };
}
