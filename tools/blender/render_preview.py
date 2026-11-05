# tools/blender/render_preview.py
"""Render inspection frames of the generated player asset."""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / "assets/characters/player-01.glb"
OUT = ROOT / "assets/previews"
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.import_scene.gltf(filepath=str(GLB))

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"

world = bpy.data.worlds.new("PreviewWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.035, 0.05, 0.06, 1)
bg.inputs["Strength"].default_value = 0.7

# Ground
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
ground = bpy.context.object
mat = bpy.data.materials.new("ground")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.035, 0.08, 0.06, 1)
bsdf.inputs["Roughness"].default_value = 0.82
ground.data.materials.append(mat)

# Soft key/fill/rim.
def area(name, xy, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = (*xy, 2.7)
    direction = Vector((0, 0, 1.05)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj

area("key", (2.5, -3.0), 900, 3.0, (1.0, 0.82, 0.68))
area("fill", (-2.8, -1.4), 500, 3.0, (0.62, 0.78, 1.0))
area("rim", (0.8, 3.0), 1100, 2.0, (0.9, 0.95, 1.0))

def camera(name, location, target, lens=85):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj

shots = {
    "front": ((0, -3.8, 1.05), (0, 0, 1.0), 85),
    "side": ((2.7, -2.4, 1.05), (0, 0, 1.0), 85),
    "back": ((0, 3.5, 1.1), (0, 0, 1.0), 85),
    "head": ((0, -1.0, 1.72), (0, -0.02, 1.68), 100),
    "feet": ((0.5, -1.2, 0.32), (0, 0, 0.16), 80),
}

for name, (loc, target, lens) in shots.items():
    cam = camera(f"cam_{name}", loc, target, lens)
    scene.camera = cam
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)

print("DONE", OUT)
