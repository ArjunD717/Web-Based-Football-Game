// packages/client/src/render/factory.ts

import { createCanvasRenderer } from "./canvas-renderer";
import type { MatchRenderer } from "./renderer";
import { createThreeRenderer } from "./three-renderer";

export type RendererMode = "2d" | "3d";

export const RENDERER_STORAGE_KEY = "fb.renderer";
const DEFAULT_MODE: RendererMode = "3d";

export interface MountedRenderer {
  readonly renderer: MatchRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly mode: RendererMode;
  /** True when a requested 3D context was unavailable. */
  readonly fellBack: boolean;
}

export function preferredRendererMode(): RendererMode {
  const requested = new URLSearchParams(window.location.search).get("renderer");
  if (requested === "2d" || requested === "3d") {
    return requested;
  }
  try {
    const stored = window.localStorage.getItem(RENDERER_STORAGE_KEY);
    if (stored === "2d" || stored === "3d") {
      return stored;
    }
  } catch {
    // Storage may be unavailable in private/incognito contexts.
  }
  return DEFAULT_MODE;
}

export function saveRendererMode(mode: RendererMode): void {
  try {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, mode);
  } catch {
    // Rendering still works for this session.
  }
}

/**
 * Replacing the canvas on every mount is deliberate: a canvas that has held a
 * WebGL context can never fall back to Canvas 2D, and a failed 3D probe must
 * not poison the 2D renderer.
 */
export function mountMatchRenderer(
  stage: HTMLElement,
  preferred: RendererMode,
): MountedRenderer {
  if (preferred === "3d") {
    const canvas = freshCanvas(stage, "3D football pitch");
    try {
      const renderer = createThreeRenderer(canvas);
      return { renderer, canvas, mode: "3d", fellBack: false };
    } catch {
      canvas.remove();
    }
  }

  const canvas = freshCanvas(stage, "Top-down football pitch");
  const renderer = createCanvasRenderer(canvas);
  return {
    renderer,
    canvas,
    mode: "2d",
    fellBack: preferred === "3d",
  };
}

function freshCanvas(stage: HTMLElement, label: string): HTMLCanvasElement {
  const previous = stage.querySelector<HTMLCanvasElement>("#pitch");
  const canvas = document.createElement("canvas");
  canvas.id = "pitch";
  canvas.setAttribute("aria-label", label);
  if (previous === null) {
    stage.prepend(canvas);
  } else {
    previous.replaceWith(canvas);
  }
  return canvas;
}
