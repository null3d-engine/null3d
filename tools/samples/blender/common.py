# The parts that the showcase scenes' Blender scripts share: textures painted with numpy, materials
# that the glTF exporter reads, a mesh builder, the export with levels of detail, and the preview.
# Each scene's script imports this module from its own folder, so every model is built the same way.
#
# Every vertex carries the sway that the scenes' wind material reads, in the second set of texture
# coordinates (TEXCOORD_1 in glTF): its first value is the bend weight, from 0 where the plant is held
# still at its root to 1 at its freest tips, and its second is a phase from 0 to 1, which sets each
# branch or frond apart so the plant flutters part by part. Both stay in 0 to 1, since the asset
# tool's quantizer keeps no negative texture coordinate.
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

import json
import math
import os
import struct
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

# ---------------------------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------------------------


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise(h, w, fy, fx, rng):
    """Value noise that tiles, `h` x `w` texels with `fy` x `fx` cells, smoothly interpolated."""
    fy, fx = max(1, min(fy, h)), max(1, min(fx, w))
    grid = rng.random((fy, fx))
    ty, tx = np.arange(h) * fy / h, np.arange(w) * fx / w
    y0, x0 = np.floor(ty).astype(int), np.floor(tx).astype(int)
    sy, sx = ty - y0, tx - x0
    sy, sx = (sy * sy * (3 - 2 * sy))[:, None], (sx * sx * (3 - 2 * sx))[None, :]
    y1, x1 = (y0 + 1) % fy, (x0 + 1) % fx
    top = grid[np.ix_(y0, x0)] * (1 - sx) + grid[np.ix_(y0, x1)] * sx
    bottom = grid[np.ix_(y1, x0)] * (1 - sx) + grid[np.ix_(y1, x1)] * sx
    return top * (1 - sy) + bottom * sy


def fbm(h, w, fy, fx, rng, octaves=5, gain=0.5):
    """Octaves of tiling value noise, from 0 to 1."""
    total, amp, norm = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(h, w, fy << o, fx << o, rng)
        norm += amp
        amp *= gain
    return total / norm


def normal_map(height, strength):
    """A tangent-space normal map from a height field that tiles, with +v up as glTF reads it."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def occlusion_of(height, radius):
    """Darkens the low parts of a height field against its blurred self, from 0 to 1."""
    blurred = height.copy()
    for step in (radius, radius // 2, max(1, radius // 4)):
        blurred = (
            np.roll(blurred, step, 0) + np.roll(blurred, -step, 0)
            + np.roll(blurred, step, 1) + np.roll(blurred, -step, 1) + blurred
        ) / 5
    return np.clip(1 - 2.5 * np.maximum(blurred - height, 0), 0.35, 1)


def dilate(rgba):
    """Spreads the colors of opaque texels into the transparent ones, so mip levels keep no dark fringe."""
    alpha = rgba[..., 3:4]
    color = rgba[..., :3] * alpha
    weight = alpha.copy()
    for step in (1, 2, 4, 8, 16, 32, 64):
        for axis in (0, 1):
            color = color + np.roll(color, step, axis) + np.roll(color, -step, axis)
            weight = weight + np.roll(weight, step, axis) + np.roll(weight, -step, axis)
    filled = color / np.maximum(weight, 1e-6)
    out = rgba.copy()
    out[..., :3] = np.where(alpha > 0.5, rgba[..., :3], filled)
    return out


TEXTURE_DIR = tempfile.mkdtemp(prefix='showcase-textures-')


def image(name, pixels, colorspace='sRGB'):
    """Saves texels (rows from the bottom, values as stored) as a JPEG when opaque, else a PNG, and loads it."""
    h, w, channels = pixels.shape
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :channels] = np.clip(pixels, 0, 1)
    opaque = channels == 3 and colorspace == 'sRGB'
    img = bpy.data.images.new(name, w, h, alpha=not opaque)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEXTURE_DIR, f'{name}.{"jpg" if opaque else "png"}')
    img.filepath_raw = path
    img.file_format = 'JPEG' if opaque else 'PNG'
    if opaque:
        bpy.context.scene.render.image_settings.quality = 88
    img.save()
    bpy.data.images.remove(img)
    loaded = bpy.data.images.load(path)
    loaded.colorspace_settings.name = colorspace
    return loaded


def half(texels):
    """Texels at half the width and height, each the mean of four."""
    h, w = texels.shape[:2]
    return texels.reshape(h // 2, 2, w // 2, 2, -1).mean(axis=(1, 3))


def orm(occlusion, roughness):
    """Occlusion, roughness and metalness in one texture's red, green and blue, as glTF packs them."""
    return np.dstack([occlusion, roughness, np.zeros_like(roughness)])


def leaf_mask(px, py, base, angle, length, width, wave, texels, taper=0.72):
    """
    A leaf's coverage and its coordinates: `s` along it from 0 at the stem to 1 at the tip, and
    `t` across it as a share of its half width. Its outline is ovate with a pointed tip, and its
    edge blurs over one texel, of which a unit of the coordinates holds `texels`. A larger `taper`
    moves the widest part toward the tip; a smaller one makes a long narrow lance.
    """
    ca, sa = math.cos(angle), math.sin(angle)
    dx, dy = px - base[0], py - base[1]
    s = (dx * ca + dy * sa) / length
    t = (-dx * sa + dy * ca) / length
    half_width = width * np.maximum(np.sin(np.pi * np.clip(s, 0, 1) ** taper), 0) ** 0.9 * (1 + wave * np.sin(s * 42))
    edge = (half_width - np.abs(t)) * length
    coverage = np.clip(edge * texels + 0.5, 0, 1) * (s > 0) * (s < 1)
    return coverage, s, t / np.maximum(half_width, 1e-4)


def over(dst, color, coverage):
    """Paints a color over an RGBA image where `coverage` says, with its alpha."""
    a = coverage[..., None]
    dst[..., :3] = dst[..., :3] * (1 - a) + color * a
    dst[..., 3] = np.maximum(dst[..., 3], coverage)


def leaf_color(s, t, tone, rng_noise):
    """A broad leaf's texels: lighter midrib and veins, darker edges and a little mottling."""
    midrib = np.exp(-((t / 0.06) ** 2))
    veins = smoothstep(0.86, 1.0, np.abs(np.sin((s - np.abs(t) * 0.55) * np.pi * 8))) * (1 - midrib)
    edge = smoothstep(0.55, 1.0, np.abs(t))
    shade = 0.82 + 0.18 * s + 0.12 * midrib + 0.07 * veins - 0.16 * edge + 0.12 * (rng_noise - 0.5)
    return tone[None, None, :] * shade[..., None] + np.array([0.05, 0.06, 0.0]) * midrib[..., None]


def fitted(base, angle, length, margin=0.04):
    """A leaf's length, shortened so that its tip stays a margin inside its cell."""
    tip = (base[0] + math.cos(angle) * length, base[1] + math.sin(angle) * length)
    room = 1.0
    for value, start, step in ((tip[0], base[0], math.cos(angle)), (tip[1], base[1], math.sin(angle))):
        if value > 1 - margin and step > 0:
            room = min(room, (1 - margin - start) / (step * length))
        if value < margin and step < 0:
            room = min(room, (margin - start) / (step * length))
    return length * max(room, 0.2)


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------


def occlusion_output():
    """The node group that the glTF exporter reads an occlusion texture from."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return group


def material(name, color, normal=None, packed=None, cutout=False, roughness=0.8, normal_strength=1.0):
    """
    A metal-rough material from images: base color (with alpha for a cutout), normal and ORM. The
    vertex colors multiply the base color, as glTF draws them, so the preview shows their occlusion.
    """
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = color
    tex.interpolation = 'Cubic' if cutout else 'Linear'
    tint = nodes.new('ShaderNodeVertexColor')
    tint.layer_name = 'Color'
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    links.new(tex.outputs['Color'], mix.inputs['A'])
    links.new(tint.outputs['Color'], mix.inputs['B'])
    links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    if cutout:
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
    mat.use_backface_culling = not cutout
    if normal is not None:
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        nmap = nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = normal_strength
        links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if packed is not None:
        ptex = nodes.new('ShaderNodeTexImage')
        ptex.image = packed
        split = nodes.new('ShaderNodeSeparateColor')
        links.new(ptex.outputs['Color'], split.inputs['Color'])
        links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
        links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
        out = nodes.new('ShaderNodeGroup')
        out.node_tree = occlusion_output()
        links.new(split.outputs['Red'], out.inputs['Occlusion'])
    return mat


# ---------------------------------------------------------------------------------------------
# Meshes
# ---------------------------------------------------------------------------------------------


class Builder:
    """Vertices with a UV, a color, a sway and an optional normal each, and faces over them."""

    def __init__(self):
        self.positions, self.uvs, self.colors, self.normals, self.sways, self.faces = [], [], [], [], [], []

    def vertex(self, p, uv, color=(1, 1, 1), normal=None, sway=(0.0, 0.0)):
        """A vertex; `sway` is its bend weight and its phase, each from 0 to 1."""
        self.positions.append(tuple(p))
        self.uvs.append(tuple(uv))
        self.colors.append(tuple(color))
        self.normals.append(None if normal is None else tuple(normal))
        self.sways.append((min(1.0, max(0.0, sway[0])), min(1.0, max(0.0, sway[1] % 1.0))))
        return len(self.positions) - 1

    def face(self, *indices):
        self.faces.append(tuple(indices))

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name, mat):
        """A Blender object of the mesh, with its UVs, sway, colors and, when every vertex has one, normals."""
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.positions, [], self.faces)
        mesh.validate()
        loops = np.empty(len(mesh.loops), np.int32)
        mesh.loops.foreach_get('vertex_index', loops)
        uv = mesh.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', np.array(self.uvs, np.float32)[loops].ravel())
        sway = mesh.uv_layers.new(name='Sway')
        sway.data.foreach_set('uv', np.array(self.sways, np.float32)[loops].ravel())
        mesh.uv_layers.active = uv
        colors = np.ones((len(self.colors), 4), np.float32)
        colors[:, :3] = self.colors
        attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', colors.ravel())
        mesh.color_attributes.active_color = attr
        mesh.shade_smooth()
        if all(n is not None for n in self.normals):
            mesh.normals_split_custom_set_from_vertices(self.normals)
        mesh.materials.append(mat)
        return link(bpy.data.objects.new(name, mesh))


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frame_of(direction):
    """Two unit vectors across a direction."""
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
    return side, d.cross(side).normalized()


def tube(builder, points, radii, sides, uv_scale, color_of, flare=None, sway_of=None):
    """
    A tube along points, with rings that turn with the path. The texture wraps around it once per
    `uv_scale[0]` and runs along it once per `uv_scale[1]` meters. `flare(height, angle)` widens rings,
    and `sway_of(point, share)` gives each ring's sway.
    """
    side, up = frame_of(points[1] - points[0])
    length = 0.0
    rings = []
    for i, p in enumerate(points):
        if i > 0:
            length += (p - points[i - 1]).length
        ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        d = ahead.normalized()
        side = (side - d * side.dot(d)).normalized()
        up = d.cross(side)
        share = i / (len(points) - 1)
        sway = sway_of(p, share) if sway_of else (0.0, 0.0)
        ring = []
        for j in range(sides + 1):
            a = 2 * math.pi * j / sides
            r = radii[i] * (flare(p.z, a) if flare else 1)
            n = side * math.cos(a) + up * math.sin(a)
            ring.append(builder.vertex(p + n * r, (j / sides * uv_scale[0], length / uv_scale[1]), color_of(p, share), sway=sway))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            builder.face(a[j], a[j + 1], b[j + 1], b[j])


def blend_up(normal, share):
    return (Vector(normal).normalized() * (1 - share) + Vector((0, 0, 1)) * share).normalized()


def strip(builder, points, widths, sides, rise, color_of, uv_rect, fold, sway_of=None):
    """
    A folded strip along points: three vertices across, the middle one raised by `rise` along the
    strip's face normal. `sides` holds the across vector at each point. The texture fills `uv_rect`.
    `sway_of(share)` gives each row's sway, from the strip's foot to its end.
    """
    u0, v0, u1, v1 = uv_rect
    rows = []
    for i, p in enumerate(points):
        t = i / (len(points) - 1)
        across = sides[i]
        ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        face = ahead.cross(across).normalized()
        if face.z < 0:
            face = -face
        sway = sway_of(t) if sway_of else (0.0, 0.0)
        row = []
        for col in (0, 1, 2):
            u = col / 2
            q = p + across * (u - 0.5) * widths[i] + face * (rise * widths[i] * fold if col == 1 else 0)
            row.append(builder.vertex(q, (u0 + (u1 - u0) * u, v0 + (v1 - v0) * t), color_of(t), blend_up(face, 0.45), sway))
        rows.append(row)
    # Wind each quad so that its front faces up, as its normals do: a double-sided material
    # turns the normals over on back faces.
    ahead = points[-1] - points[0]
    upward = sides[0].cross(ahead).z > 0
    for a, b in zip(rows, rows[1:]):
        for j in (0, 1):
            quad = (a[j], a[j + 1], b[j + 1], b[j])
            builder.face(*(quad if upward else quad[::-1]))


def card(builder, base, along, facing, size, uv_rect, color, center, sway, fold=0.12, bend=0.65):
    """
    A leaf card: two quads, folded along their middle, that rise from `base` along `along` and face
    `facing`. The texture fills `uv_rect`. The normals bend away from `center` by `bend`, so a crown
    of cards shades as one soft mass.
    """
    u0, v0, u1, v1 = uv_rect
    across = along.cross(facing)
    ids = []
    for row in (0, 1):
        for col in (0, 1, 2):
            u = col / 2
            q = base + across * (u - 0.5) * size + along * row * size + facing * (fold * size if col == 1 else 0)
            out = q - center
            out = out.normalized() if out.length > 1e-4 else facing
            normal = (facing * (1 - bend) + out * bend).normalized()
            ids.append(builder.vertex(q, (u0 + (u1 - u0) * u, v0 + (v1 - v0) * row), color, normal, sway))
    a0, a1, a2, b0, b1, b2 = ids
    builder.face(a0, a1, b1, b0)
    builder.face(a1, a2, b2, b1)


# ---------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------


def export(path, objects, masked, levels=(), one_sided=()):
    """Writes the objects as one binary glTF file, then marks the cutout materials masked.

    A masked material is double sided, unless `one_sided` names it: a mesh that carries its own
    back faces, each with the normals it needs, draws its cutout with its back faces culled.

    An object named `<part>-<k>` is level k of the part named `<part>`, and `levels` gives each
    level's error. The part's node lists its levels in the MSFT_lod extension, from the finest
    down, with their errors in its extras, and the levels' nodes leave the scene. Each mesh keeps
    its two sets of texture coordinates: the texture's, and the sway's.
    """
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_animations=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    with open(path, 'rb') as f:
        data = f.read()
    json_length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_length])
    rest = data[20 + json_length:]
    for m in doc.get('materials', []):
        if m['name'] in masked:
            m['alphaMode'] = 'MASK'
            m['alphaCutoff'] = 0.5
            if m['name'] in one_sided:
                m.pop('doubleSided', None)
            else:
                m['doubleSided'] = True
        else:
            m.pop('alphaMode', None)
            m.pop('doubleSided', None)
    swaying = {o.data.name for o in objects if 'Sway' in o.data.uv_layers}
    for mesh in doc['meshes']:
        if mesh['name'] in swaying and any('TEXCOORD_1' not in p['attributes'] for p in mesh['primitives']):
            raise SystemExit(f"{mesh['name']} lost its sway coordinates in the export")
    if levels:
        index = {node['name']: k for k, node in enumerate(doc['nodes'])}
        lower = set()
        for k, node in enumerate(doc['nodes']):
            ids = [index[f"{node['name']}-{n}"] for n in range(1, len(levels) + 1) if f"{node['name']}-{n}" in index]
            if not ids:
                continue
            node.setdefault('extensions', {})['MSFT_lod'] = {'ids': ids}
            node.setdefault('extras', {})['NULL3D_lod_error'] = [levels[n] for n in range(len(ids))]
            lower.update(ids)
        for scene in doc['scenes']:
            scene['nodes'] = [n for n in scene['nodes'] if n not in lower]
        doc['extensionsUsed'] = sorted(set(doc.get('extensionsUsed', [])) | {'MSFT_lod'})
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    body = struct.pack('<II', len(text), 0x4E4F534A) + text + rest
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)
    triangles = {}
    for node in doc['nodes']:
        mesh = doc['meshes'][node['mesh']]
        triangles[node['name']] = sum(doc['accessors'][p['indices']]['count'] // 3 for p in mesh['primitives'])
    return triangles


def preview(objects, path, view=(0.9, -2.2, 0.5), sky=(0.45, 0.6, 0.85), size=(640, 480), samples=24):
    """Renders the objects with Cycles under a sun and a sky color, framed from `view`."""
    scene = bpy.context.scene
    for o in scene.collection.objects:
        if o.type == 'MESH':
            o.hide_render = o not in objects
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    middle, radius = (low + high) / 2, (high - low).length / 2
    cam = bpy.data.objects.get('preview-camera') or link(bpy.data.objects.new('preview-camera', bpy.data.cameras.new('preview-camera')))
    cam.location = middle + Vector(view) * radius
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.get('preview-sun') or link(bpy.data.objects.new('preview-sun', bpy.data.lights.new('preview-sun', 'SUN')))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    world = scene.world or bpy.data.worlds.new('preview')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*sky, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def arguments(script):
    """The output folder and the preview folder, or None, from the arguments after `--`."""
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not args:
        raise SystemExit(f'Give the output folder: blender --background --python {script} -- <folder> [--preview <folder>]')
    out = os.path.abspath(args[0])
    shots = os.path.abspath(args[args.index('--preview') + 1]) if '--preview' in args else None
    os.makedirs(out, exist_ok=True)
    if shots:
        os.makedirs(shots, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    return out, shots
