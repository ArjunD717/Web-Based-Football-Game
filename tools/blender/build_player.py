# tools/blender/build_player.py
"""Build the first production character from the CC0 MakeHuman base.

Run headlessly:
  blender -b --python tools/blender/build_player.py
"""
from __future__ import annotations

import math
import os
from collections.abc import Callable

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCE = os.path.join(REPO, "assets", "source", "makehuman", "makehuman-base.glb")
OUT = os.path.join(REPO, "assets", "characters", "player-01.glb")
MATCH_OUT = os.path.join(REPO, "assets", "characters", "player-01-match.glb")
TEXTURES = os.path.join(REPO, "assets", "textures")

BODY_NAME = "Avery | anatomical body"
ARMATURE_NAME = "Avery | anatomical body.rig"
DECIMATE_RATIO = 0.075
CLOTH_OFFSET_M = 0.014


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def find_object(name: str, kind: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != kind:
        raise RuntimeError(f"Missing {kind} object {name!r}")
    return obj


def load_base() -> tuple[bpy.types.Object, bpy.types.Object]:
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    body = find_object(BODY_NAME, "MESH")
    rig = find_object(ARMATURE_NAME, "ARMATURE")
    # The GLB repack leaves an unused primitive at the origin.
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name.startswith("Icosphere"):
            bpy.data.objects.remove(obj, do_unlink=True)
    return body, rig


def apply_decimate(body: bpy.types.Object) -> None:
    if DECIMATE_RATIO >= 0.999:
        body.data.name = "player-01-body"
        return
    armature = next(
        (mod for mod in body.modifiers if mod.type == "ARMATURE"),
        None,
    )
    armature_object = armature.object if armature is not None else None
    if armature is not None:
        body.modifiers.remove(armature)
    # The source export carries a vertex per loop, so every triangle is its
    # own island. Weld coincident vertices first; otherwise decimation tears
    # holes and garment normals point in inconsistent directions.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00015)
    bm.to_mesh(body.data)
    bm.free()
    mod = body.modifiers.new("LOD0 body", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DECIMATE_RATIO
    mod.use_collapse_triangulate = True
    mod.use_symmetry = False
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Decimation splits vertices along UV/normal seams; re-weld so garments
    # copied from this surface do not inherit razor-thin holes.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    bm.to_mesh(body.data)
    bm.free()
    if armature_object is not None:
        restored = body.modifiers.new("Armature", "ARMATURE")
        restored.object = armature_object
    body.data.name = "player-01-body"


def decimate_mesh(obj: bpy.types.Object, ratio: float) -> None:
    armature = next(
        (mod for mod in obj.modifiers if mod.type == "ARMATURE"),
        None,
    )
    armature_object = armature.object if armature is not None else None
    if armature is not None:
        obj.modifiers.remove(armature)
    mod = obj.modifiers.new("surface reduction", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if armature_object is not None:
        restored = obj.modifiers.new("Armature", "ARMATURE")
        restored.object = armature_object


def add_fabric_thickness(obj: bpy.types.Object, thickness: float) -> None:
    armature = next(
        (mod for mod in obj.modifiers if mod.type == "ARMATURE"),
        None,
    )
    armature_object = armature.object if armature is not None else None
    if armature is not None:
        obj.modifiers.remove(armature)
    mod = obj.modifiers.new("fabric thickness", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1.0
    mod.use_rim = True
    mod.use_rim_only = False
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if armature_object is not None:
        restored = obj.modifiers.new("Armature", "ARMATURE")
        restored.object = armature_object


def dominant_groups(obj: bpy.types.Object) -> dict[int, str]:
    names = {group.index: group.name for group in obj.vertex_groups}
    result: dict[int, str] = {}
    for vertex in obj.data.vertices:
        if not vertex.groups:
            continue
        heaviest = max(vertex.groups, key=lambda item: item.weight)
        result[vertex.index] = names[heaviest.group]
    return result


def duplicate_surface(
    source: bpy.types.Object,
    name: str,
    keep: Callable[[bpy.types.MeshVertex], bool],
    material: bpy.types.Material,
    offset_m: float = CLOTH_OFFSET_M,
) -> bpy.types.Object:
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    obj.data.name = name
    bpy.context.collection.objects.link(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    remove = [vert for vert in bm.verts if not keep(vert)]
    if remove:
        bmesh.ops.delete(bm, geom=remove, context="VERTS")
    for vert in bm.verts:
        vert.co += vert.normal * offset_m
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def add_armature_weights(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone: str,
) -> None:
    group = obj.vertex_groups.new(name=bone)
    group.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
    obj.parent = armature
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature


def load_image(name: str, relative: str, colorspace: str = "sRGB") -> bpy.types.Image:
    image = bpy.data.images.load(os.path.join(TEXTURES, relative), check_existing=True)
    image.name = name
    image.colorspace_settings.name = colorspace
    return image


def pbr_material(
    name: str,
    base_color: tuple[float, float, float, float] = (0.5, 0.5, 0.5, 1.0),
    roughness: float = 0.6,
    metallic: float = 0.0,
    base_image: bpy.types.Image | None = None,
    normal_image: bpy.types.Image | None = None,
    vertex_colors: bool = False,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError("Principled BSDF not found")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if vertex_colors:
        color = nodes.new("ShaderNodeVertexColor")
        color.layer_name = "Col"
        color.location = (-320, 180)
        links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
    if base_image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = base_image
        tex.interpolation = "Smart"
        tex.location = (-520, 260)
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if normal_image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        tex.interpolation = "Smart"
        tex.location = (-520, -80)
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.location = (-220, -80)
        nmap.inputs["Strength"].default_value = 0.22
        links.new(tex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def cylindrical_uv(obj: bpy.types.Object, zmin: float, zmax: float) -> None:
    mesh = obj.data
    for layer in list(mesh.uv_layers):
        mesh.uv_layers.remove(layer)
    uv = mesh.uv_layers.new(name="KitUV")
    span = max(0.001, zmax - zmin)
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            x, y, z = vertex.co
            angle = math.atan2(-y, x)
            # Flip the wrap direction so printed type reads left-to-right
            # from the camera, not as a mirror image.
            u = (0.5 - angle / (2.0 * math.pi)) % 1.0
            v = (z - zmin) / span
            uv.data[loop_index].uv = (u, v)


def decal_material(name: str, image: bpy.types.Image) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "CLIP"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.48
    return mat


def make_material_set() -> dict[str, bpy.types.Material]:
    skin_normal = load_image(
        "skin-pores-normal",
        os.path.join("skin", "pores-normal.png"),
        "Non-Color",
    )
    fabric_normal = load_image(
        "fabric-weave-normal",
        os.path.join("fabric", "weave-normal.png"),
        "Non-Color",
    )
    shirt_tex = load_image("kit-shirt", os.path.join("kits", "shirt.png"))
    shorts_tex = load_image("kit-shorts", os.path.join("kits", "shorts.png"))
    eye_tex = load_image("eye-decal", os.path.join("face", "eye-decal.png"))
    hair_normal = load_image(
        "hair-normal",
        os.path.join("hair", "hair-normal.png"),
        "Non-Color",
    )
    return {
        "skin": pbr_material(
            "skin",
            (1.0, 1.0, 1.0, 1.0),
            0.60,
            normal_image=skin_normal,
            vertex_colors=True,
        ),
        "hair": pbr_material("hair", (0.026, 0.012, 0.0055, 1.0), 0.58, normal_image=hair_normal),
        "eyebrow": pbr_material("eyebrow", (0.028, 0.018, 0.011, 1.0), 0.7),
        "shirt": pbr_material(
            "kit_shirt",
            (0.03, 0.22, 0.24, 1.0),
            0.78,
            base_image=shirt_tex,
            normal_image=fabric_normal,
        ),
        "shorts": pbr_material(
            "kit_shorts",
            (0.82, 0.78, 0.68, 1.0),
            0.86,
            base_image=shorts_tex,
            normal_image=fabric_normal,
        ),
        "trim": pbr_material("kit_trim", (0.93, 0.57, 0.10, 1.0), 0.72),
        "collar": pbr_material("kit_collar", (0.018, 0.105, 0.115, 1.0), 0.8),
        "boots": pbr_material("kit_boots", (0.012, 0.014, 0.013, 1.0), 0.28, 0.05),
        "sole": pbr_material("boot_sole", (0.025, 0.028, 0.024, 1.0), 0.72),
        "eye_decal": decal_material("eye_decal", eye_tex),
        "socks_solid": pbr_material("socks_solid", (0.018, 0.13, 0.145, 1.0), 0.9),
    }


def duplicate_face_surface(
    source: bpy.types.Object,
    name: str,
    keep: Callable[[Vector], bool],
    material: bpy.types.Material,
    offset_m: float,
) -> bpy.types.Object:
    """Copy a body shell and cut it by face centre, not by vertex weights.

    Cutting vertices by their dominant bone leaves interior holes wherever a
    weight boundary crosses a garment. Face-centre cuts follow the actual
    surface and keep the torso watertight inside the intended region.
    """
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    obj.data.name = name
    bpy.context.collection.objects.link(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    remove = [face for face in bm.faces if not keep(face.calc_center_median())]
    if remove:
        bmesh.ops.delete(bm, geom=remove, context="FACES")
    loose = [vert for vert in bm.verts if not vert.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.normal_update()
    for vert in bm.verts:
        vert.co += vert.normal * offset_m
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
        poly.material_index = 0
    if not obj.data.polygons:
        raise RuntimeError(f"{name} selected no faces")
    return obj


def cut_plane(
    obj: bpy.types.Object,
    point: tuple[float, float, float],
    normal: tuple[float, float, float],
    remove_negative: bool,
    region: Callable[[Vector], bool] | None = None,
) -> None:
    """Bisect a shell so its cut line is straight instead of a jagged face edge."""
    co = Vector(point)
    no = Vector(normal).normalized()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=co,
        plane_no=no,
        dist=0.0002,
    )
    remove = []
    for face in bm.faces:
        center = face.calc_center_median()
        if region is not None and not region(center):
            continue
        signed = (center - co).dot(no)
        if (signed < 0 and remove_negative) or (signed > 0 and not remove_negative):
            remove.append(face)
    if remove:
        bmesh.ops.delete(bm, geom=remove, context="FACES")
    loose = [vert for vert in bm.verts if not vert.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def make_hair(body: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    def keep(center: Vector) -> bool:
        # Follow the real scalp, but open the face and keep a short nape.
        if center.z < 1.53:
            return center.y > 0.02
        if center.z < 1.60:
            return center.y > -0.060
        return True

    obj = duplicate_face_surface(body, "hair", keep, material, 0.011)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def make_eye(
    rig: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    bone: str = "head",
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=10,
        ring_count=6,
        radius=1.0,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    add_armature_weights(obj, rig, bone)
    return obj


def make_boot_sole(
    rig: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    bone: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (dimensions[0], dimensions[1], dimensions[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("sole bevel", "BEVEL")
    bevel.width = 0.008
    bevel.segments = 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    add_armature_weights(obj, rig, bone)
    return obj


def build() -> None:
    reset()
    body, rig = load_base()
    apply_decimate(body)
    mats = make_material_set()

    body.data.materials.clear()
    body.data.materials.append(mats["skin"])
    body.name = "player-01-body"

    def hairiness(co: Vector) -> float:
        # Sloped hairline: higher over the forehead, lower toward the nape.
        line = 1.592 - 0.10 * max(0.0, co.y + 0.02)
        t = max(0.0, min(1.0, (co.z - (line - 0.012)) / 0.024))
        return t * t * (3.0 - 2.0 * t)

    skin_rgb = (0.30, 0.165, 0.090)
    hair_rgb = (0.034, 0.016, 0.0065)
    color = body.data.color_attributes.new(
        name="Col", type="FLOAT_COLOR", domain="POINT",
    )
    for vertex in body.data.vertices:
        t = hairiness(vertex.co)
        # Break up the flat painted cap with a deterministic per-vertex
        # stubble variation; there is no hair texture shell to hide it.
        grain = 0.88 + 0.24 * (0.5 + 0.5 * math.sin(
            vertex.co.x * 311.0 + vertex.co.y * 173.0 + vertex.co.z * 97.0,
        ))
        color.data[vertex.index].color = (
            skin_rgb[0] * (1.0 - t) + hair_rgb[0] * t * grain,
            skin_rgb[1] * (1.0 - t) + hair_rgb[1] * t * grain,
            skin_rgb[2] * (1.0 - t) + hair_rgb[2] * t * grain,
            1.0,
        )

    def is_shirt(center: Vector) -> bool:
        # Include the whole upper body; the sleeve line is cut later with a
        # plane perpendicular to each arm so the cuffs are perfectly straight.
        if not 0.80 <= center.z <= 1.48:
            return False
        return True

    shirt = duplicate_face_surface(
        body, "kit_shirt", is_shirt, mats["shirt"], 0.026,
    )

    def is_shorts(center: Vector) -> bool:
        # Hands hang beside the hips in the rest pose; the width gate excludes
        # them while keeping both legs and the pelvis.
        return 0.47 <= center.z <= 1.00 and abs(center.x) < 0.37

    shorts = duplicate_face_surface(
        body, "kit_shorts", is_shorts, mats["shorts"], 0.016,
    )
    armature_mod = next(
        (mod for mod in shorts.modifiers if mod.type == "ARMATURE"),
        None,
    )
    armature_object = armature_mod.object if armature_mod is not None else None
    if armature_mod is not None:
        shorts.modifiers.remove(armature_mod)
    smooth = shorts.modifiers.new("Cloth ease", "SMOOTH")
    smooth.factor = 0.35
    smooth.iterations = 3
    bpy.context.view_layer.objects.active = shorts
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    if armature_object is not None:
        restored = shorts.modifiers.new("Armature", "ARMATURE")
        restored.object = armature_object
    def is_socks(center: Vector) -> bool:
        return 0.08 <= center.z <= 0.56 and abs(center.x) < 0.32

    socks = duplicate_face_surface(
        body, "kit_socks", is_socks, mats["socks_solid"], 0.024,
    )
    # The anatomical source has a pronounced front crotch; ease it under the
    # shorts so the kit reads as fabric, not a second skin.
    smooth = shorts.modifiers.new("cloth ease", "SMOOTH")
    smooth.factor = 0.28
    smooth.iterations = 3
    bpy.context.view_layer.objects.active = shorts
    bpy.ops.object.modifier_apply(modifier=smooth.name)

    def is_boots(center: Vector) -> bool:
        return center.z <= 0.20

    boots = duplicate_face_surface(
        body, "kit_boots", is_boots, mats["boots"], 0.014,
    )
    decimate_mesh(boots, 0.45)

    def cuff(name: str, bone_name: str) -> bpy.types.Object:
        bone = rig.data.bones[bone_name]
        head = bone.head_local.copy()
        tail = bone.tail_local.copy()
        direction = (tail - head).normalized()
        center = head + (tail - head) * 0.82
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.057,
            minor_radius=0.007,
            major_segments=24,
            minor_segments=6,
            location=center,
        )
        obj = bpy.context.object
        obj.name = name
        obj.data.name = name
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.data.materials.append(mats["trim"])
        for poly in obj.data.polygons:
            poly.use_smooth = True
        obj.vertex_groups.new(name=bone_name)
        group = obj.vertex_groups[bone_name]
        group.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
        obj.parent = rig
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        return obj

    cuff("kit_cuff_l", "upperarm_l")
    cuff("kit_cuff_r", "upperarm_r")

    def sock_cuff(name: str, bone_name: str) -> bpy.types.Object:
        bone = rig.data.bones[bone_name]
        head = bone.head_local.copy()
        center = Vector((head.x, head.y, 0.495))
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=24,
            radius=1.0,
            depth=1.0,
            end_fill_type="NOTHING",
            location=center,
        )
        obj = bpy.context.object
        obj.name = name
        obj.data.name = name
        obj.scale = (0.080, 0.080, 0.050)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(mats["socks_solid"])
        for poly in obj.data.polygons:
            poly.use_smooth = True
        obj.vertex_groups.new(name=bone_name)
        group = obj.vertex_groups[bone_name]
        group.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
        obj.parent = rig
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        return obj

    sock_cuff("sock_trim_l", "calf_l")
    sock_cuff("sock_trim_r", "calf_r")

    # Straight hems; deleting whole faces alone leaves a saw-tooth silhouette.
    cut_plane(shirt, (0.0, 0.0, 0.878), (0.0, 0.0, 1.0), remove_negative=True)
    for bone_name in ("upperarm_l", "upperarm_r"):
        bone = rig.data.bones[bone_name]
        head = bone.head_local.copy()
        tail = bone.tail_local.copy()
        axis = (tail - head).normalized()
        sleeve_end = head + (tail - head) * 0.82
        cut_plane(
            shirt,
            tuple(sleeve_end),
            tuple(axis),
            remove_negative=False,
            region=lambda center: abs(center.x) > 0.255,
        )
    cut_plane(shorts, (0.0, 0.0, 0.551), (0.0, 0.0, 1.0), remove_negative=True)
    cut_plane(shorts, (0.0, 0.0, 0.932), (0.0, 0.0, 1.0), remove_negative=False)
    cut_plane(socks, (0.0, 0.0, 0.118), (0.0, 0.0, 1.0), remove_negative=True)
    cut_plane(socks, (0.0, 0.0, 0.502), (0.0, 0.0, 1.0), remove_negative=False)
    cut_plane(boots, (0.0, 0.0, 0.152), (0.0, 0.0, 1.0), remove_negative=False)

    # The shoulders stop at z=1.402, so a horizontal neck cut at 1.445 is a
    # small clean circle around the neck. Extrude that edge into an attached
    # collar before solidifying so the trim moves with the shirt.
    cut_plane(shirt, (0.0, 0.0, 1.445), (0.0, 0.0, 1.0), remove_negative=False)
    add_fabric_thickness(shirt, 0.0025)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48,
        radius=1.0,
        depth=1.0,
        end_fill_type="NOTHING",
        location=(0.0, -0.006, 1.443),
    )
    collar = bpy.context.object
    collar.name = "kit_collar"
    collar.data.name = "kit_collar"
    collar.scale = (0.089, 0.083, 0.038)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    collar.data.materials.append(mats["collar"])
    for poly in collar.data.polygons:
        poly.use_smooth = True
    collar.vertex_groups.new(name="neck_01")
    neck_group = collar.vertex_groups["neck_01"]
    neck_group.add([v.index for v in collar.data.vertices], 1.0, "REPLACE")
    collar.parent = rig
    neck_mod = collar.modifiers.new("Armature", "ARMATURE")
    neck_mod.object = rig
    add_fabric_thickness(shorts, 0.0025)
    add_fabric_thickness(socks, 0.0018)

    cylindrical_uv(shirt, 0.86, 1.44)
    cylindrical_uv(shorts, 0.55, 0.99)
    cylindrical_uv(socks, 0.10, 0.52)

    def eye_decal(name: str, x: float, yaw: float) -> bpy.types.Object:
        bpy.ops.mesh.primitive_grid_add(
            x_subdivisions=16,
            y_subdivisions=10,
            size=1.0,
            location=(x, -0.1460, 1.565),
        )
        obj = bpy.context.object
        obj.name = name
        obj.data.name = name
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (math.pi / 2.0, 0.0, yaw)
        obj.scale = (0.0320, 0.0180, 1.0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        wrap = obj.modifiers.new("conform to face", "SHRINKWRAP")
        wrap.target = body
        wrap.wrap_method = "NEAREST_SURFACEPOINT"
        wrap.offset = 0.0080
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=wrap.name)
        obj.data.materials.append(mats["eye_decal"])
        for poly in obj.data.polygons:
            poly.use_smooth = True
        add_armature_weights(obj, rig, "head")
        return obj

    for side, x in (("l", 0.032), ("r", -0.032)):
        yaw = 0.16 if x > 0 else -0.16
        eye_decal(f"eye_decal_{side}", x, yaw)
        eyebrow = make_eye(
            rig, f"eyebrow_{side}", (x, -0.143, 1.578),
            (0.020, 0.0026, 0.0032), mats["eyebrow"],
        )
        eyebrow.rotation_euler[1] = -0.16 if x > 0 else 0.16
        bpy.context.view_layer.objects.active = eyebrow
        eyebrow.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        eyebrow.name = eyebrow.name.replace("_l", "").replace("_r", "")

    make_boot_sole(rig, "boot_sole_l", (-0.19, -0.14, 0.014), (0.125, 0.29, 0.025), "foot_l", mats["sole"])
    make_boot_sole(rig, "boot_sole_r", (0.19, -0.14, 0.014), (0.125, 0.29, 0.025), "foot_r", mats["sole"])

    # Metadata consumed by the viewer and the future match integration.
    target_height_m = 1.82
    rig.scale = (target_height_m / 1.6979,) * 3
    rig["characterId"] = "player-01"
    rig["heightM"] = target_height_m
    rig["kit"] = "northbridge-home"
    rig["bodyType"] = "athletic"

    # Export all renderable objects and the shared armature.
    bpy.ops.object.select_all(action="SELECT")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_animations=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_extras=True,
        export_image_format="WEBP",
        export_image_quality=90,
    )

    tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            tris += sum(len(p.vertices) - 2 for p in obj.data.polygons)
            print("PART", obj.name, len(obj.data.vertices), len(obj.data.polygons))
    print("TOTAL_TRIS", tris)
    print("EXPORTED", OUT)

    export_match_lod()



def export_match_lod() -> None:
    """Export a decimated match-only LOD without tiny detail meshes.

    The authored showpiece keeps its details for the lab and close-up. Match
    play needs thousands of animated vertices across 22 players, so soles,
    sock trims and sleeve cuffs are removed and the remaining surfaces are
    decimated. Textures and material names stay identical for the runtime
    palette swap.
    """
    detail_prefixes = ("boot_sole", "sock_trim", "kit_cuff")
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name.startswith(detail_prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)

    ratios = {
        "player-01-body": 0.34,
        "kit_shirt": 0.38,
        "kit_shorts": 0.40,
        "kit_socks": 0.46,
        "kit_boots": 0.60,
        "kit_collar": 0.55,
        # Faces are already tiny; decimating the eye grid distorts the
        # silhouette at close camera range for no meaningful triangle saving.
        "eye_decal_l": 1.0,
        "eye_decal_r": 1.0,
        "eyebrow_l": 1.0,
        "eyebrow_r": 1.0,
    }
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        ratio = ratios.get(obj.name, 0.45)
        if ratio >= 0.999:
            continue
        armature = next(
            (mod for mod in obj.modifiers if mod.type == "ARMATURE"),
            None,
        )
        armature_object = armature.object if armature is not None else None
        if armature is not None:
            obj.modifiers.remove(armature)
        decimate = obj.modifiers.new("match decimate", "DECIMATE")
        decimate.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        if armature_object is not None:
            restored = obj.modifiers.new("Armature", "ARMATURE")
            restored.object = armature_object

    bpy.ops.export_scene.gltf(
        filepath=MATCH_OUT,
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_animations=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_extras=True,
        export_image_format="WEBP",
        export_image_quality=90,
    )
    match_tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            match_tris += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print("MATCH_TRIS", match_tris)
    print("EXPORTED", MATCH_OUT)


if __name__ == "__main__":
    build()
