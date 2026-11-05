# tools/generate_kit_textures.py
"""Generate self-made fictional kit artwork and PBR support maps."""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures" / "kits"
FONT_DIR = ROOT / "assets" / "fonts"
BOLD = FONT_DIR / "BarlowCondensed-Bold.ttf"
SEMI = FONT_DIR / "BarlowCondensed-SemiBold.ttf"

TEAL_DARK = (7, 55, 60)
TEAL = (12, 76, 82)
TEAL_LIGHT = (20, 96, 101)
AMBER = (232, 158, 52)
IVORY = (226, 219, 201)
INK = (8, 14, 14)
WHITE = (242, 240, 231)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def add_fabric_noise(image: Image.Image, amount: int = 10) -> Image.Image:
    rng = random.Random(7)
    px = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = px[x, y][:3]
            n = rng.randint(-amount, amount)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return image


def draw_arched_text(
    image: Image.Image,
    text: str,
    center_x: int,
    baseline_y: int,
    font_obj: ImageFont.FreeTypeFont,
    radius: int,
    fill: tuple[int, int, int],
    stroke: tuple[int, int, int],
    stroke_width: int = 3,
) -> None:
    """Place characters along a shallow upward arch, baseline by baseline."""
    widths = [ImageDraw.Draw(image).textlength(ch, font=font_obj) for ch in text]
    total = sum(widths)
    if total <= 0:
        return
    angle_span = total / radius
    start = -angle_span / 2
    offset = 0.0
    for char, width in zip(text, widths):
        angle = start + (offset + width / 2) / radius
        layer = Image.new("RGBA", (font_obj.size * 3, font_obj.size * 3), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.text(
            (layer.width / 2, layer.height / 2),
            char,
            font=font_obj,
            fill=(*fill, 255),
            stroke_width=stroke_width,
            stroke_fill=(*stroke, 255),
            anchor="mm",
        )
        rotated = layer.rotate(
            -math.degrees(angle),
            resample=Image.Resampling.BICUBIC,
            expand=False,
        )
        x = center_x + math.sin(angle) * radius
        y = baseline_y + radius - math.cos(angle) * radius
        image.paste(
            rotated,
            (int(x - rotated.width / 2), int(y - rotated.height / 2)),
            rotated,
        )
        offset += width


def crest(size: int = 150) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    shield = [
        (size * 0.12, size * 0.12),
        (size * 0.88, size * 0.12),
        (size * 0.82, size * 0.58),
        (size * 0.50, size * 0.92),
        (size * 0.18, size * 0.58),
    ]
    d.polygon(shield, fill=IVORY + (255,), outline=AMBER + (255,), width=max(2, size // 22))
    d.polygon(
        [(size * 0.20, size * 0.40), (size * 0.50, size * 0.28), (size * 0.80, size * 0.40),
         (size * 0.50, size * 0.50)],
        fill=TEAL + (255,),
    )
    d.text((size * 0.50, size * 0.56), "NA", font=font(BOLD, int(size * 0.35)), fill=TEAL_DARK + (255,), anchor="mm")
    # Four-point star charge.
    cx, cy, r1, r2 = size * 0.50, size * 0.22, size * 0.11, size * 0.035
    star = []
    for i in range(8):
        a = -math.pi / 2 + i * math.pi / 4
        r = r1 if i % 2 == 0 else r2
        star.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.polygon(star, fill=AMBER + (255,))
    return im


def make_shirt() -> Image.Image:
    w, h = 2048, 1024
    im = Image.new("RGB", (w, h), TEAL)
    d = ImageDraw.Draw(im)
    # Subtle tonal vertical stripes, wrapping at the side seam.
    stripe = 170
    for i in range(0, w + stripe, stripe * 2):
        d.rectangle([i, 0, i + stripe, h], fill=TEAL_LIGHT)
    # Side panels at the right seam (x=0/end) and left seam (x=1024).
    for x in (0, 1024, w - 42):
        d.rectangle([x - 42 if x else 0, 0, x + 42 if x else 42, h], fill=IVORY)
        d.rectangle([x - 8 if x else 0, 0, x + 8 if x else 8, h], fill=AMBER)
    # The collar cut samples the top of this map all the way around, so keep
    # the shoulder yoke solid teal; otherwise the side-panel stripes print on
    # the neckline as a bright zig-zag.
    d.rectangle([0, 0, w, 78], fill=TEAL)
    d.line([(0, 78), (w, 78)], fill=TEAL_DARK, width=3)
    # Hem and shoulder seam shading.
    d.rectangle([0, h - 22, w, h], fill=AMBER)
    # Front: chest sponsor, crest and fictional maker mark.
    front = int(w * 0.25)
    back = int(w * 0.75)
    d.text((front, 360), "AURORA", font=font(SEMI, 72), fill=WHITE, anchor="mm", stroke_width=2, stroke_fill=TEAL_DARK)
    d.text((front, 415), "ENGINEERING", font=font(SEMI, 25), fill=AMBER, anchor="mm")
    im.paste(crest(148), (front - 204, 220), crest(148))
    # Maker mark: a simple wing/chevron, never a real manufacturer logo.
    mx, my = front + 190, 270
    d.line([(mx - 40, my + 22), (mx, my - 20), (mx + 40, my + 22)], fill=AMBER, width=8)
    d.text((mx, my + 38), "VANTA", font=font(BOLD, 30), fill=IVORY, anchor="mm")
    # Back: arched surname and large number.
    draw_arched_text(im, "NORTHBRIDGE", back, 238, font(BOLD, 66), 520, WHITE, TEAL_DARK, 3)
    number_font = font(BOLD, 500)
    d.text((back, 560), "9", font=number_font, fill=WHITE, anchor="mm", stroke_width=12, stroke_fill=TEAL_DARK)
    # Nape detail and small sleeve badge.
    d.text((back, 90), "N A F C", font=font(SEMI, 28), fill=AMBER, anchor="mm")
    # Fine seams around side panels and shoulder yokes.
    for x in (42, 982, 1066, 2006):
        d.line([(x, 0), (x, h)], fill=(4, 31, 34), width=2)
    d.line([(0, 150), (w, 150)], fill=(4, 31, 34), width=2)
    add_fabric_noise(im, 7)
    return im


def make_shorts() -> Image.Image:
    w, h = 1024, 512
    im = Image.new("RGB", (w, h), TEAL_DARK)
    d = ImageDraw.Draw(im)
    # Continuous side stripes and a contrast waistband.
    for x in (0, w - 36):
        d.rectangle([x, 0, x + 36, h], fill=IVORY)
        d.rectangle([x + 12 if x == 0 else x + 12, 0, x + 22 if x == 0 else x + 22, h], fill=AMBER)
    d.rectangle([0, 0, w, 46], fill=TEAL)
    d.rectangle([0, 44, w, 54], fill=AMBER)
    # Shorts number on the left leg, front-facing.
    d.text((250, 355), "9", font=font(BOLD, 190), fill=IVORY, anchor="mm", stroke_width=4, stroke_fill=TEAL)
    d.text((250, 470), "NORTHBRIDGE", font=font(SEMI, 22), fill=IVORY, anchor="mm")
    add_fabric_noise(im, 6)
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_shirt().save(OUT / "shirt.png", optimize=True)
    make_shorts().save(OUT / "shorts.png", optimize=True)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
