# tools/generate_pbr_textures.py
"""Generate the tileable skin and fabric PBR support maps.

The character must be reproducible from source in this repository: no
unlicensed texture downloads sit in the shipping tree. Both maps are procedural,
seeded and tileable enough for the small UV islands used by the kit.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SKIN = ROOT / "assets" / "textures" / "skin"
FABRIC = ROOT / "assets" / "textures" / "fabric"
SIZE = 512


def normal_from_height(height: np.ndarray, strength: float) -> np.ndarray:
    """Convert a height field to a tangent-space RGB normal map."""
    dy, dx = np.gradient(height)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack(
        [
            np.clip((nx / length * 0.5 + 0.5) * 255.0, 0, 255),
            np.clip((ny / length * 0.5 + 0.5) * 255.0, 0, 255),
            np.clip((nz / length * 0.5 + 0.5) * 255.0, 0, 255),
        ],
        axis=-1,
    ).astype(np.uint8)


def save_maps(directory: Path, name: str, height: np.ndarray, strength: float) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    gray = np.clip(height * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(gray, "L").save(directory / f"{name}-height.png", optimize=True)
    Image.fromarray(normal_from_height(height, strength), "RGB").save(
        directory / f"{name}-normal.png", optimize=True
    )


def skin_pores() -> np.ndarray:
    rng = np.random.default_rng(1307)
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    # A fine cross-hatch of pores plus a broader dermal undulation.
    pores = np.sin(2 * math.pi * (x * 41 + 0.22 * np.sin(y * 0.09))) * np.sin(
        2 * math.pi * (y * 47 + 0.18 * np.sin(x * 0.11))
    )
    grain = rng.normal(0.0, 0.25, (SIZE, SIZE))
    grain = (grain + np.roll(grain, 1, axis=0) + np.roll(grain, 1, axis=1)) / 3.0
    height = 0.50 + 0.055 * pores + 0.075 * grain
    # Smooth the peaks so the normal map reads as pores, not sandpaper.
    for _ in range(2):
        height = (
            height
            + np.roll(height, 1, axis=0)
            + np.roll(height, -1, axis=0)
            + np.roll(height, 1, axis=1)
            + np.roll(height, -1, axis=1)
        ) / 5.0
    return height


def shirt_weave() -> np.ndarray:
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    u = x / SIZE
    v = y / SIZE
    warp = 0.5 + 0.5 * np.sin(2 * math.pi * u * 96)
    weft = 0.5 + 0.5 * np.sin(2 * math.pi * v * 84)
    # Alternate warp/weft dominance in a twill-like two-row repeat.
    over = (np.floor(v * 84) + np.floor(u * 96)) % 2
    basket = np.where(over > 0.5, warp, weft)
    rib = 0.5 + 0.5 * np.sin(2 * math.pi * v * 8)
    return 0.50 + 0.075 * basket + 0.025 * rib


def main() -> None:
    save_maps(SKIN, "pores", skin_pores(), 2.4)
    save_maps(FABRIC, "weave", shirt_weave(), 1.8)
    print("wrote", SKIN, "and", FABRIC)


if __name__ == "__main__":
    main()
