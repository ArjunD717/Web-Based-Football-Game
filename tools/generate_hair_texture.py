# tools/generate_hair_texture.py
"""Generate a tileable short-hair normal map from a procedural strand field."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures" / "hair"
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 512

y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
u = x / SIZE
v = y / SIZE

# Swept strands: fine across the head, gently waved down the length.
strand = np.sin(2 * np.pi * (u * 34 + 0.045 * np.sin(v * 2 * np.pi * 5)))
fine = np.sin(2 * np.pi * (u * 89 + v * 7))
clump = np.sin(2 * np.pi * (u * 11 + 0.08 * np.sin(v * 2 * np.pi * 2)))
height = 0.55 * strand + 0.22 * fine + 0.45 * clump

dhdu = np.gradient(height, axis=1)
dhdv = np.gradient(height, axis=0)
strength = 2.6
nx = -dhdu * strength
ny = -dhdv * strength
nz = np.ones_like(height)
length = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / length, ny / length, nz / length], axis=-1)
rgb = np.clip((normal * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
Image.fromarray(rgb, "RGB").save(OUT / "hair-normal.png", optimize=True)
print("wrote", OUT / "hair-normal.png")
