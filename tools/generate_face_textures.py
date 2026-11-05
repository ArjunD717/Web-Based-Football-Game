# tools/generate_face_textures.py
"""Generate the small transparent eye decal used by the character lab.

The mesh already carries eyelids and a socket; a painted almond inside that
socket reads more cleanly at gameplay distance than intersecting eyeballs.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures" / "face"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 512, 256


def rounded_almond(draw: ImageDraw.ImageDraw, inset: float, fill) -> None:
    cx, cy = W / 2, H / 2
    half_w = W / 2 - inset
    half_h = H / 2 - inset
    points: list[tuple[float, float]] = []
    # Upper and lower lids share a pointed inner/outer canthus.
    for index in range(65):
        t = index / 64
        x = cx + half_w * (1.0 - 2.0 * t)
        lift = math.sin(math.pi * t) ** 1.25
        points.append((x, cy - half_h * lift * 0.62))
    for index in range(64, -1, -1):
        t = index / 64
        x = cx + half_w * (1.0 - 2.0 * t)
        drop = math.sin(math.pi * t) ** 1.35
        points.append((x, cy + half_h * drop * 0.52))
    draw.polygon(points, fill=fill)


def main() -> None:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # A soft shadow inside the socket grounds the decal.
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    rounded_almond(sd, 12, (45, 28, 18, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    im.alpha_composite(shadow)

    rounded_almond(d, 22, (196, 189, 174, 255))
    # Warm lower-lid reflected light.
    d.arc([64, 104, W - 64, 214], start=16, end=164, fill=(154, 127, 103, 160), width=6)

    cx, cy = W // 2, H // 2
    iris_r = 76
    d.ellipse(
        [cx - iris_r, cy - iris_r, cx + iris_r, cy + iris_r],
        fill=(92, 112, 78, 255),
        outline=(47, 61, 38, 255),
        width=7,
    )
    # Limbal ring and iris fibres.
    for i in range(18):
        a = i / 18 * math.tau
        x1 = cx + math.cos(a) * (iris_r * 0.45)
        y1 = cy + math.sin(a) * (iris_r * 0.45)
        x2 = cx + math.cos(a) * (iris_r * 0.92)
        y2 = cy + math.sin(a) * (iris_r * 0.92)
        d.line([(x1, y1), (x2, y2)], fill=(126, 143, 99, 100), width=2)
    d.ellipse([cx - 32, cy - 34, cx + 32, cy + 34], fill=(12, 10, 8, 255))
    d.ellipse([cx - 24, cy - 22, cx + 2, cy + 2], fill=(235, 240, 227, 170))
    d.ellipse([cx + 19, cy + 18, cx + 29, cy + 30], fill=(214, 225, 210, 80))

    # Upper lid and lashes.
    d.arc([58, 56, W - 58, 198], start=194, end=346, fill=(35, 23, 16, 255), width=15)
    d.arc([58, 56, W - 58, 198], start=200, end=340, fill=(237, 219, 196, 90), width=4)
    for i in range(13):
        t = i / 12
        x = 96 + t * (W - 192)
        y = 74 + math.sin(math.pi * t) * 12
        d.line([(x, y), (x + 2, y - 10)], fill=(36, 24, 17, 155), width=3)
    d.arc([84, 120, W - 84, 220], start=18, end=162, fill=(105, 75, 58, 155), width=5)

    # Eyelid crease above the lash line.
    d.arc([72, 82, W - 72, 208], start=208, end=332, fill=(133, 99, 79, 95), width=4)

    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(OUT / "eye-decal.png", optimize=True)
    print("wrote", OUT / "eye-decal.png")


if __name__ == "__main__":
    main()
