# tools/character/pack_ktx2.py
#!/usr/bin/env python3
"""Convert an authored GLB's WebP images to PNG, encode KTX2 textures with
gltfpack, then repair the gltfpack texture extension and mesh names."""
from __future__ import annotations

import io
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, _total = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 GLB")
    offset = 12
    json_length, json_type = struct.unpack_from("<II", data, offset)
    if json_type != JSON_CHUNK:
        raise ValueError(f"{path} has no JSON chunk")
    doc = json.loads(data[offset + 8 : offset + 8 + json_length].decode("utf-8").rstrip())
    offset += 8 + json_length
    bin_length, bin_type = struct.unpack_from("<II", data, offset)
    if bin_type != BIN_CHUNK:
        raise ValueError(f"{path} has no BIN chunk")
    return doc, data[offset + 8 : offset + 8 + bin_length]


def write_glb(path: Path, doc: dict, binary: bytes) -> None:
    while len(binary) % 4:
        binary += b"\x00"
    doc.setdefault("buffers", [{}])[0]["byteLength"] = len(binary)
    encoded = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    while len(encoded) % 4:
        encoded += b" "
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    data = struct.pack("<III", GLB_MAGIC, 2, total)
    data += struct.pack("<II", len(encoded), JSON_CHUNK) + encoded
    data += struct.pack("<II", len(binary), BIN_CHUNK) + binary
    path.write_bytes(data)


def png_only_glb(source: Path, target: Path) -> None:
    doc, binary = read_glb(source)
    views = doc["bufferViews"]
    appended = bytearray(binary)
    while len(appended) % 4:
        appended.append(0)
    new_views: list[dict] = []
    for image in doc.get("images", []):
        view = views[image["bufferView"]]
        start = view.get("byteOffset", 0)
        raw = binary[start : start + view["byteLength"]]
        rgba = Image.open(io.BytesIO(raw)).convert("RGBA")
        encoded = io.BytesIO()
        rgba.save(encoded, format="PNG", optimize=True)
        payload = encoded.getvalue()
        while len(appended) % 4:
            appended.append(0)
        new_views.append(
            {"buffer": 0, "byteOffset": len(appended), "byteLength": len(payload)}
        )
        appended.extend(payload)
        image["bufferView"] = len(views) + len(new_views) - 1
        image["mimeType"] = "image/png"
    doc["bufferViews"] = views + new_views
    write_glb(target, doc, bytes(appended))


def pack(source: Path, target: Path, gltfpack: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="fb-ktx2-") as temporary:
        png = Path(temporary) / "source-png.glb"
        packed = Path(temporary) / "packed.glb"
        png_only_glb(source, png)
        subprocess.run(
            [
                str(gltfpack),
                "-i",
                str(png),
                "-o",
                str(packed),
                "-tc",
                "-noq",
                "-kn",
                "-km",
                "-ke",
            ],
            check=True,
        )
        source_doc, _ = read_glb(source)
        doc, binary = read_glb(packed)

    source_meshes = source_doc.get("meshes", [])
    meshes = doc.get("meshes", [])
    if len(source_meshes) != len(meshes):
        raise ValueError(
            f"gltfpack changed mesh count: {len(source_meshes)} -> {len(meshes)}"
        )
    for index, mesh in enumerate(meshes):
        mesh["name"] = source_meshes[index].get("name", f"mesh-{index}")

    images = doc.get("images", [])
    if not images or any(image.get("mimeType") != "image/ktx2" for image in images):
        raise ValueError("gltfpack did not produce KTX2 images")
    for texture in doc.get("textures", []):
        extensions = texture.setdefault("extensions", {})
        if "EXT_texture_webp" in extensions:
            extensions["KHR_texture_basisu"] = extensions.pop("EXT_texture_webp")
        if "KHR_texture_basisu" not in extensions and "source" in texture:
            extensions["KHR_texture_basisu"] = {"source": texture["source"]}
    used = [entry for entry in doc.get("extensionsUsed", []) if entry != "EXT_texture_webp"]
    required = [
        entry for entry in doc.get("extensionsRequired", []) if entry != "EXT_texture_webp"
    ]
    if "KHR_texture_basisu" not in used:
        used.append("KHR_texture_basisu")
    if "KHR_texture_basisu" not in required:
        required.append("KHR_texture_basisu")
    doc["extensionsUsed"] = used
    doc["extensionsRequired"] = required
    write_glb(target, doc, binary)
    print(
        f"KTX2 {source.name} -> {target.name}: {target.stat().st_size} bytes, "
        f"{len(images)} textures, {len(meshes)} meshes"
    )


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: pack_ktx2.py source.glb output.ktx2.glb gltfpack")
    pack(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))


if __name__ == "__main__":
    main()
