# Builds the organic models of the Creek showcase scene in Blender: three broadleaf trees, three
# plants for the banks and a rocky cave mouth. Everything comes from this script and a fixed seed:
# the shapes, and every texture, which numpy paints. Nothing is downloaded.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
#     --python tools/samples/blender/creek.py -- <output folder> [--preview <folder>]
#
# It writes three binary glTF files into the output folder, and prints each model's triangles:
#   trees.glb   oak, beech and birch, each a wood node and a leaves node
#   plants.glb  fern, hosta and shrub, one node each
#   cave.glb    cave, one node
# Leaves, fronds and plant leaves are cards whose texture's alpha cuts their outline, so their
# materials are masked and double sided. The wood, the plants and the rock carry ambient occlusion
# and tints in their vertex colors, which glTF multiplies into the base color. --preview also renders
# each model with Cycles, for a quick look without the engine.
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

import json
import math
import os
import struct
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

SEED = 20261011

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


TEXTURE_DIR = tempfile.mkdtemp(prefix='creek-textures-')


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


def leaf_mask(px, py, base, angle, length, width, wave, texels):
    """
    A leaf's coverage and its coordinates: `s` along it from 0 at the stem to 1 at the tip, and
    `t` across it as a share of its half width. Its outline is ovate with a pointed tip, and its
    edge blurs over one texel, of which a unit of the coordinates holds `texels`.
    """
    ca, sa = math.cos(angle), math.sin(angle)
    dx, dy = px - base[0], py - base[1]
    s = (dx * ca + dy * sa) / length
    t = (-dx * sa + dy * ca) / length
    half = width * np.maximum(np.sin(np.pi * np.clip(s, 0, 1) ** 0.72), 0) ** 0.9 * (1 + wave * np.sin(s * 42))
    edge = (half - np.abs(t)) * length
    coverage = np.clip(edge * texels + 0.5, 0, 1) * (s > 0) * (s < 1)
    return coverage, s, t / np.maximum(half, 1e-4)


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


def leaf_atlas(size, rng):
    """
    Four clusters of broad leaves on twigs, in the cells of a 2 x 2 atlas. Each twig runs up its
    cell from the middle of its bottom edge, so a card's base sits on its branch.
    """
    cell = size // 2
    out = np.zeros((size, size, 4), np.float32)
    mottle = fbm(size, size, 8, 8, rng, 4)
    py, px = np.mgrid[0:cell, 0:cell].astype(np.float32) / cell
    tones = [np.array(c) for c in ([0.30, 0.46, 0.13], [0.36, 0.50, 0.14], [0.27, 0.42, 0.15], [0.40, 0.52, 0.17])]
    for k in range(4):
        oy, ox = (k // 2) * cell, (k % 2) * cell
        tile = np.zeros((cell, cell, 4), np.float32)
        bend = (rng.random() - 0.5) * 0.25
        twig = lambda v: 0.5 + bend * v * v
        # The twig: a thin brown line up the middle, which the leaves cover.
        dist = np.abs(px - twig(py)) - 0.008 * (1 - py)
        over(tile, np.array([0.30, 0.24, 0.16]), np.clip(-dist * cell + 0.5, 0, 1) * (py < 0.82))
        leaves = 15 + int(rng.random() * 4)
        for j in range(leaves):
            v = 0.1 + 0.72 * j / leaves + 0.04 * rng.random()
            side = 1 if j % 2 else -1
            angle = math.pi / 2 - side * (0.75 + 0.6 * rng.random()) * (1 - 0.35 * v)
            length = (0.24 + 0.09 * rng.random()) * (1.05 - 0.35 * abs(v - 0.45))
            coverage, s, t = leaf_mask(px, py, (twig(v), v), angle, length, 0.36 + 0.06 * rng.random(), 0.02, cell)
            tone = tones[k] * (0.85 + 0.3 * rng.random())
            color = leaf_color(s, t, tone, mottle[oy:oy + cell, ox:ox + cell])
            over(tile, color, coverage)
        # The top leaf continues the twig.
        coverage, s, t = leaf_mask(px, py, (twig(0.78), 0.78), math.pi / 2 + bend, 0.22, 0.36, 0.02, cell)
        over(tile, leaf_color(s, t, tones[k], mottle[oy:oy + cell, ox:ox + cell]), coverage)
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


def bark(kind, w, h, rng):
    """Bark that tiles around and along a branch: color, height, and roughness."""
    if kind == 'oak':
        ridges = fbm(h, w, 6, 10, rng, 5)
        ridges = 1 - np.abs(2 * ridges - 1)
        plates = smoothstep(0.35, 0.75, ridges) + 0.25 * fbm(h, w, 32, 16, rng, 3)
        height = plates
        lichen = smoothstep(0.62, 0.8, fbm(h, w, 6, 4, rng, 4))
        base = np.array([0.29, 0.24, 0.19])[None, None] * (0.55 + 0.6 * plates[..., None])
        color = base * (1 - 0.6 * lichen[..., None]) + np.array([0.46, 0.50, 0.38]) * 0.6 * lichen[..., None]
        rough = 0.85 + 0.12 * (1 - plates)
    elif kind == 'beech':
        mottle = fbm(h, w, 6, 4, rng, 5)
        rings = 0.5 + 0.5 * np.sin(np.arange(h)[:, None] / h * np.pi * 2 * 22 + mottle * 5)
        height = 0.15 * mottle + 0.04 * rings
        color = np.array([0.50, 0.50, 0.47])[None, None] * (0.8 + 0.35 * mottle[..., None])
        color = color * (1 - 0.06 * rings[..., None])
        rough = 0.62 + 0.15 * mottle
    else:
        mottle = fbm(h, w, 6, 4, rng, 5)
        dashes = value_noise(h, w, 96, 6, rng)
        lenticels = smoothstep(0.78, 0.86, dashes) * smoothstep(0.4, 0.6, value_noise(h, w, 96, 24, rng))
        patches = smoothstep(0.66, 0.78, fbm(h, w, 8, 6, rng, 4))
        dark = np.clip(lenticels + patches, 0, 1)
        height = 0.2 * mottle - 0.6 * dark
        white = np.array([0.86, 0.85, 0.80])[None, None] * (0.85 + 0.2 * mottle[..., None])
        color = white * (1 - dark[..., None]) + np.array([0.14, 0.13, 0.12]) * dark[..., None]
        rough = 0.55 + 0.35 * dark
    return color, height, rough


def rock_texture(size, rng):
    """Weathered stone: broad tones, cracks and grains, with its height and roughness."""
    broad = fbm(size, size, 4, 4, rng, 6)
    cracks = 1 - smoothstep(0.0, 0.035, np.abs(fbm(size, size, 6, 6, rng, 4) - 0.5))
    grain = value_noise(size, size, 256, 256, rng)
    height = broad * 1.4 - cracks * 0.5 + grain * 0.12
    tone = 0.5 + 0.35 * broad - 0.12 * cracks + 0.08 * grain
    warm = fbm(size, size, 3, 3, rng, 3)
    color = np.dstack([tone * (0.62 + 0.08 * warm), tone * (0.60 + 0.05 * warm), tone * 0.56])
    rough = 0.8 + 0.15 * (1 - broad)
    return color, height, rough


def fern_frond(w, h, rng):
    """A fern frond up the image: a stem with pairs of lobed leaflets that shorten toward both ends."""
    py, px = np.mgrid[0:h, 0:w].astype(np.float32)
    py, px = py / h, (px / w - 0.5) * (w / h)
    out = np.zeros((h, w, 4), np.float32)
    half = 0.5 * w / h
    stem = np.abs(px) - 0.004 * (1.2 - py)
    over(out, np.array([0.28, 0.36, 0.14]), np.clip(-stem * h + 0.5, 0, 1) * (py < 0.97))
    pairs = 26
    for k in range(pairs):
        v = 0.06 + 0.9 * k / pairs
        reach = half * 0.95 * math.sin(math.pi * min(1, (v - 0.02) / 0.98)) ** 0.7
        for side in (-1, 1):
            angle = math.pi / 2 - side * (1.05 - 0.25 * v)
            coverage, s, t = leaf_mask(px, py, (0, v), angle, reach * 1.05 + 1e-3, 0.17, 0.0, h)
            lobes = 1 - 0.35 * smoothstep(0.6, 1.0, np.abs(np.sin(s * np.pi * 7)))
            coverage = coverage * (np.abs(t) < lobes)
            shade = 0.8 + 0.25 * s - 0.15 * np.abs(t) + 0.1 * (1 - v)
            color = np.array([0.24, 0.42, 0.12])[None, None] * shade[..., None]
            over(out, color, coverage)
    return dilate(out)


def broad_leaf(size, rng):
    """A hosta's leaf up the image: heart shaped, with curved veins that meet at its tip, and a stalk."""
    py, px = np.mgrid[0:size, 0:size].astype(np.float32) / size
    out = np.zeros((size, size, 4), np.float32)
    stalk = np.abs(px - 0.5) - 0.018
    over(out, np.array([0.40, 0.50, 0.20]), np.clip(-stalk * size + 0.5, 0, 1) * (py < 0.2))
    s = (py - 0.12) / 0.86
    half = 0.44 * np.maximum(np.sin(np.pi * np.clip(s, 0, 1) ** 0.62), 0) ** 0.75 + 0.05 * np.exp(-((s - 0.05) / 0.08) ** 2)
    t = (px - 0.5) / np.maximum(half, 1e-4)
    coverage = np.clip((half - np.abs(px - 0.5)) * size * 1.6 + 0.5, 0, 1) * (s > 0) * (s < 1)
    veins = smoothstep(0.8, 1.0, np.abs(np.cos(np.abs(t) * np.pi * 4.5)))
    midrib = np.exp(-((px - 0.5) / 0.012) ** 2)
    mottle = fbm(size, size, 8, 8, rng, 4)
    shade = 0.85 - 0.18 * veins + 0.2 * midrib - 0.1 * smoothstep(0.7, 1.0, np.abs(t)) + 0.15 * (mottle - 0.5)
    rim = smoothstep(0.82, 0.97, np.abs(t))
    color = np.array([0.22, 0.40, 0.16])[None, None] * shade[..., None]
    color = color * (1 - rim[..., None]) + np.array([0.50, 0.55, 0.26]) * rim[..., None]
    over(out, color, coverage)
    return dilate(out)


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
    """A metal-rough material from images: base color (with alpha for a cutout), normal and ORM."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = color
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
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
    """Vertices with a UV, a color and an optional normal each, and faces over them."""

    def __init__(self):
        self.positions, self.uvs, self.colors, self.normals, self.faces = [], [], [], [], []

    def vertex(self, p, uv, color=(1, 1, 1), normal=None):
        self.positions.append(tuple(p))
        self.uvs.append(tuple(uv))
        self.colors.append(tuple(color))
        self.normals.append(None if normal is None else tuple(normal))
        return len(self.positions) - 1

    def face(self, *indices):
        self.faces.append(tuple(indices))

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name, mat):
        """A Blender object of the mesh, with its UVs, colors and, when every vertex has one, normals."""
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.positions, [], self.faces)
        mesh.validate()
        loops = np.empty(len(mesh.loops), np.int32)
        mesh.loops.foreach_get('vertex_index', loops)
        uv = mesh.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', np.array(self.uvs, np.float32)[loops].ravel())
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


def tube(builder, points, radii, sides, uv_scale, color_of, flare=None):
    """
    A tube along points, with rings that turn with the path. The texture wraps around it once per
    `uv_scale[0]` and runs along it once per `uv_scale[1]` meters. `flare(height, angle)` widens rings.
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
        ring = []
        for j in range(sides + 1):
            a = 2 * math.pi * j / sides
            r = radii[i] * (flare(p.z, a) if flare else 1)
            n = side * math.cos(a) + up * math.sin(a)
            ring.append(builder.vertex(p + n * r, (j / sides * uv_scale[0], length / uv_scale[1]), color_of(p, i / (len(points) - 1))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            builder.face(a[j], a[j + 1], b[j + 1], b[j])


# ---------------------------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------------------------

TREES = {
    'oak': dict(
        height=7.2, radius=0.3, flare=0.7, crown=0.34, children=(6, 4, 4), angles=(62, 48, 42),
        ratio=(0.6, 0.55, 0.5), tropism=(0.12, 0.08, 0.0), wobble=0.22, cards=13, card=0.9,
        tint=(0.86, 0.95, 0.82), bark='oak', sides=(12, 7, 5, 3),
    ),
    'beech': dict(
        height=8.6, radius=0.24, flare=0.45, crown=0.3, children=(7, 4, 4), angles=(44, 40, 36),
        ratio=(0.5, 0.55, 0.5), tropism=(0.25, 0.15, 0.05), wobble=0.14, cards=13, card=0.85,
        tint=(1.0, 1.0, 0.88), bark='beech', sides=(10, 6, 4, 3),
    ),
    'birch': dict(
        height=7.8, radius=0.14, flare=0.3, crown=0.32, children=(8, 3, 3), angles=(48, 52, 58),
        ratio=(0.46, 0.6, 0.55), tropism=(0.1, -0.12, -0.28), wobble=0.18, cards=10, card=0.7,
        tint=(1.08, 1.06, 0.72), bark='birch', sides=(9, 5, 4, 3),
    ),
}


def grow_tree(spec, rng):
    """The branches of a tree, as (points, radii, level), and its leaf cards' places."""
    branches, cards = [], []

    def path(start, direction, length, r0, r1, level):
        steps = max(3, int(length / (0.45 if level < 2 else 0.35)))
        points, radii = [start.copy()], [r0]
        d = direction.normalized()
        bias = Vector((0, 0, spec['tropism'][min(level, 2)]))
        for i in range(1, steps + 1):
            jitter = Vector(rng.normal(0, spec['wobble'], 3))
            d = (d + bias * 0.35 + jitter * 0.35).normalized()
            points.append(points[-1] + d * (length / steps))
            radii.append(r0 + (r1 - r0) * (i / steps) ** 0.8)
        return points, radii

    def at(points, radii, t):
        """The point, direction and radius at a share `t` of a path's length."""
        f = t * (len(points) - 1)
        i = min(int(f), len(points) - 2)
        k = f - i
        p = points[i].lerp(points[i + 1], k)
        return p, (points[i + 1] - points[i]).normalized(), radii[i] + (radii[i + 1] - radii[i]) * k

    def grow(start, direction, length, radius, level):
        points, radii = path(start, direction, length, radius, radius * (0.45 if level else 0.35), level)
        branches.append((points, radii, level))
        last = len(spec['children'])
        if level == last:
            for _ in range(spec['cards']):
                p, d, _ = at(points, radii, 0.25 + 0.75 * rng.random())
                cards.append((p, d))
            return
        if level == last - 1:
            p, d, _ = at(points, radii, 1.0)
            cards.append((p, d))
        n = spec['children'][level]
        first = spec['crown'] if level == 0 else 0.25
        for k in range(n):
            t = first + (0.97 - first) * (k + 0.3 + 0.4 * rng.random()) / n
            p, d, r = at(points, radii, t)
            side, up = frame_of(d)
            az = k * 2.39996 + rng.random() * 0.6
            across = side * math.cos(az) + up * math.sin(az)
            tilt = math.radians(spec['angles'][level] * (0.8 + 0.4 * rng.random()))
            child = (d * math.cos(tilt) + across * math.sin(tilt)).normalized()
            reach = length * spec['ratio'][level] * (1.15 - 0.55 * t if level == 0 else 1.0 - 0.3 * t)
            grow(p - d * r * 0.5, child, reach, max(r * 0.62, 0.012), level + 1)

    grow(Vector((0, 0, -0.35)), Vector((0, 0, 1)), spec['height'] + 0.35, spec['radius'], 0)
    return branches, cards


def build_tree(name, spec, bark_mat, leaf_mat, rng):
    branches, cards = grow_tree(spec, rng)
    wood = Builder()
    for points, radii, level in branches:
        r = radii[0]
        around = max(1, round(2 * math.pi * r / 0.9))
        along = 2 * math.pi * r / around * 2

        def wood_color(p, t, level=level):
            # Darker and mossier near the ground, and darker deep in the crown.
            ground = smoothstep(0.0, 1.4, p.z)
            moss = (1 - ground) * 0.5
            shade = (0.6 + 0.4 * ground) * (0.85 if level >= 2 else 1.0)
            return tuple(shade * ((1 - moss) + moss * m) for m in (0.55, 0.75, 0.35))

        flare = None
        if level == 0:
            phase = rng.random() * 6.3
            lift = spec['flare']
            flare = lambda z, a, phase=phase, lift=lift: 1 + lift * math.exp(-max(z, 0) / 0.4) * (
                0.45 + 0.55 * max(0.0, math.cos(5 * a + phase)) ** 2
            )
        tube(wood, points, radii, spec['sides'][min(level, 3)], (around, max(along, 0.3)), wood_color, flare)

    # The crown's middle and size, which shade the cards: darker inside and underneath.
    places = np.array([tuple(p) for p, _ in cards])
    center = Vector(places.mean(axis=0))
    extent = Vector(np.maximum(np.percentile(np.abs(places - places.mean(axis=0)), 92, axis=0), 0.5))
    leaves = Builder()
    tint = Vector(spec['tint'])
    for p, d in cards:
        out = Vector(((p - center).x / extent.x, (p - center).y / extent.y, (p - center).z / extent.z))
        depth = min(out.length, 1.3)
        outward = out.normalized() if out.length > 1e-3 else Vector((0, 0, 1))
        facing = (outward + Vector(rng.normal(0, 0.45, 3)) + Vector((0, 0, 0.35))).normalized()
        along = (d - facing * d.dot(facing))
        along = along.normalized() if along.length > 1e-3 else frame_of(facing)[0]
        across = along.cross(facing)
        size = spec['card'] * (0.8 + 0.4 * rng.random())
        cell = int(rng.random() * 4)
        cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
        base = p - along * size * 0.08
        ao = 0.42 + 0.58 * float(smoothstep(0.15, 1.0, depth))
        ao *= 0.72 + 0.28 * float(smoothstep(-0.9, 0.5, out.z))
        hue = 0.92 + 0.16 * rng.random()
        color = tuple(ao * hue * c for c in tint)
        fold = 0.12 * size
        ids = []
        for row in (0, 1):
            for col in (0, 1, 2):
                u = col / 2
                q = base + across * (u - 0.5) * size + along * row * size + facing * (fold if col == 1 else 0)
                bent = (facing * 0.35 + (q - center).normalized() * 0.65).normalized()
                ids.append(leaves.vertex(q, (cu + u * 0.5, cv + row * 0.5), color, bent))
        a0, a1, a2, b0, b1, b2 = ids
        leaves.face(a0, a1, b1, b0)
        leaves.face(a1, a2, b2, b1)
    # Wood: one normal per vertex from the shape. Leaves: normals bent away from the crown's middle,
    # so the crown shades as one soft mass.
    wood.normals = [None] * len(wood.positions)
    return wood.build(f'{name}-wood', bark_mat), leaves.build(f'{name}-leaves', leaf_mat), wood.triangles(), leaves.triangles()


# ---------------------------------------------------------------------------------------------
# Plants
# ---------------------------------------------------------------------------------------------


def blend_up(normal, share):
    return (Vector(normal).normalized() * (1 - share) + Vector((0, 0, 1)) * share).normalized()


def strip(builder, points, widths, sides, rise, color_of, uv_rect, fold):
    """
    A folded strip along points: three vertices across, the middle one raised by `rise` along the
    strip's face normal. `sides` holds the across vector at each point. The texture fills `uv_rect`.
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
        row = []
        for col in (0, 1, 2):
            u = col / 2
            q = p + across * (u - 0.5) * widths[i] + face * (rise * widths[i] * fold if col == 1 else 0)
            row.append(builder.vertex(q, (u0 + (u1 - u0) * u, v0 + (v1 - v0) * t), color_of(t), blend_up(face, 0.45)))
        rows.append(row)
    # Wind each quad so that its front faces up, as its normals do: a double-sided material
    # turns the normals over on back faces.
    ahead = points[-1] - points[0]
    upward = sides[0].cross(ahead).z > 0
    for a, b in zip(rows, rows[1:]):
        for j in (0, 1):
            quad = (a[j], a[j + 1], b[j + 1], b[j])
            builder.face(*(quad if upward else quad[::-1]))


def build_fern(mat, rng):
    """A fern: arching fronds around a crown, each a folded strip with the frond texture."""
    b = Builder()
    fronds = 13
    for k in range(fronds):
        az = k * 2.39996 + rng.random() * 0.4
        length = 0.65 + 0.4 * rng.random()
        rise = math.radians(38 + 24 * rng.random())
        heading = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))
        twist = (rng.random() - 0.5) * 0.4
        points, widths, sides = [], [], []
        p = Vector((0, 0, 0.02))
        d = (heading * math.cos(rise) + Vector((0, 0, math.sin(rise)))).normalized()
        steps = 8
        for i in range(steps + 1):
            t = i / steps
            points.append(p.copy())
            widths.append(length * 0.3)
            sides.append((side * math.cos(twist * t) + Vector((0, 0, math.sin(twist * t)))).normalized())
            d = (d + Vector((0, 0, -0.6)) * (length / steps) * (0.6 + t)).normalized()
            p = p + d * (length / steps)
        shade = 0.85 + 0.25 * rng.random()
        strip(b, points, widths, sides, 0.12, lambda t, s=shade: (s * (0.5 + 0.5 * t),) * 3, (0, 0, 1, 1), 1)
    return b


def build_hosta(mat, rng):
    """A hosta: broad leaves on stalks around a crown, each leaf a cupped grid with the leaf texture."""
    b = Builder()
    leaves = 10
    for k in range(leaves):
        az = k * 2.39996 + rng.random() * 0.5
        heading = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))
        stalk = 0.18 + 0.2 * rng.random()
        lift = math.radians(48 + 22 * rng.random())
        top = heading * stalk * math.cos(lift) + Vector((0, 0, stalk * math.sin(lift)))
        # The stalk: a thin strip that samples the stalk at the foot of the leaf texture.
        stalk_pts = [Vector((0, 0, 0)).lerp(top, t) + Vector((0, 0, 0.04 * math.sin(math.pi * t))) for t in (0, 0.5, 1)]
        strip(b, stalk_pts, [0.03] * 3, [side] * 3, 0.0, lambda t: (0.7 + 0.3 * t,) * 3, (0.47, 0.0, 0.53, 0.1), 0)
        # The blade: rows along the leaf, columns across, cupped across and drooping toward its tip.
        size = 0.36 + 0.16 * rng.random()
        tilt = math.radians(10 + 25 * rng.random())
        along0 = (heading * math.cos(tilt) + Vector((0, 0, math.sin(tilt)))).normalized()
        up = along0.cross(side).normalized()
        if up.z < 0:
            up = -up
        rows, cols = 7, 5
        grid = []
        for i in range(rows):
            s = i / (rows - 1)
            row = []
            for j in range(cols):
                u = j / (cols - 1)
                x = (u - 0.5) * size
                droop = -0.35 * size * s * s
                cup = 0.5 * x * x / size * 1.6
                q = top - along0 * size * 0.12 + along0 * s * size + side * x + up * (cup + droop)
                n = (up - side * (x / size) * 0.8 + along0 * 0.6 * s).normalized()
                ao = 0.65 + 0.35 * s
                row.append(b.vertex(q, (u, 0.12 + 0.86 * s), (ao, ao, ao), blend_up(n, 0.3)))
            grid.append(row)
        for a, c in zip(grid, grid[1:]):
            for j in range(cols - 1):
                b.face(a[j], c[j], c[j + 1], a[j + 1])
    return b


def build_shrub(mat, rng):
    """A small leafy shrub: twigs from the ground, each with leaf cards of the trees' atlas."""
    b = Builder()
    twigs = 9
    center = Vector((0, 0, 0.55))
    for k in range(twigs):
        az = k * 2.39996 + rng.random() * 0.5
        heading = Vector((math.cos(az), math.sin(az), 0))
        rise = math.radians(50 + 30 * rng.random())
        length = 0.7 + 0.4 * rng.random()
        d = (heading * math.cos(rise) + Vector((0, 0, math.sin(rise)))).normalized()
        tip = d * length
        side = frame_of(d)[0]
        # The twig: a thin strip that samples the twig at the foot of an atlas cell.
        strip(b, [Vector((0, 0, 0)), tip * 0.5, tip], [0.025] * 3, [side] * 3, 0.0, lambda t: (0.6,) * 3, (0.24, 0.0, 0.26, 0.06), 0)
        for c in range(5):
            p = tip * (0.35 + 0.65 * rng.random())
            out = (p - center).normalized()
            facing = (out + Vector(rng.normal(0, 0.4, 3)) + Vector((0, 0, 0.4))).normalized()
            along = (d - facing * d.dot(facing)).normalized()
            across = along.cross(facing)
            size = 0.45 + 0.2 * rng.random()
            cell = int(rng.random() * 4)
            cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
            depth = (p - center).length / 0.8
            ao = 0.5 + 0.5 * min(1.0, depth)
            ids = []
            for row in (0, 1):
                for col in (0, 1, 2):
                    u = col / 2
                    q = p + across * (u - 0.5) * size + along * row * size + facing * (0.1 * size if col == 1 else 0)
                    bent = (facing * 0.35 + (q - center).normalized() * 0.65).normalized()
                    ids.append(b.vertex(q, (cu + u * 0.5, cv + row * 0.5), (ao * 0.9, ao, ao * 0.85), bent))
            a0, a1, a2, b0, b1, b2 = ids
            b.face(a0, a1, b1, b0)
            b.face(a1, a2, b2, b1)
    return b


# ---------------------------------------------------------------------------------------------
# The cave mouth
# ---------------------------------------------------------------------------------------------

CAVE_SIZE = (8.0, 6.0, 4.6)
CAVE_TRIANGLES = 7000


def metaball_mesh(name, ellipsoids, resolution):
    """A mesh of ellipsoids that melt into each other, each given as its middle and its semi-axes."""
    balls = bpy.data.metaballs.new(name)
    balls.resolution = resolution
    balls.render_resolution = resolution
    balls.threshold = 0.6
    for co, size in ellipsoids:
        e = balls.elements.new(type='ELLIPSOID')
        e.co = co
        e.radius = 1.6
        e.size_x, e.size_y, e.size_z = (s / 1.6 for s in size)
    holder = link(bpy.data.objects.new(name, balls))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(holder.evaluated_get(depsgraph))
    bpy.data.objects.remove(holder)
    bpy.data.metaballs.remove(balls)
    return mesh


def build_cave(mat, rng):
    """
    A rocky outcrop with a cave that opens toward -y: metaballs for the masses, less a tunnel of
    metaballs, then noise for ledges, plates and facets, a cut at the ground, and a decimate. Its
    vertex colors hold the occlusion of the tunnel and its hollows, and moss where the rock faces up.
    """
    masses = [
        ((0.0, 0.4, 1.0), (3.2, 2.6, 2.3)),
        ((-2.9, 0.7, 0.6), (1.9, 1.9, 1.6)),
        ((3.0, 0.1, 0.7), (2.0, 2.0, 1.8)),
        ((0.6, 0.9, 2.7), (2.4, 2.0, 1.2)),
        ((-0.4, -1.5, 2.3), (1.9, 1.1, 1.0)),
        ((1.9, -1.4, 0.5), (1.1, 1.0, 1.1)),
        ((-2.2, -1.2, 0.3), (1.0, 0.9, 0.9)),
        ((0.2, 2.6, 0.9), (2.4, 1.4, 1.6)),
    ]
    # Metaballs shrink to about 0.57 of their semi-axes where they stand alone, so the tunnel's
    # chain is larger than the hole it leaves.
    tunnel = [
        ((-0.4, -4.0, 0.5), (2.3, 1.6, 2.3)),
        ((-0.35, -2.8, 0.5), (2.3, 1.6, 2.3)),
        ((-0.25, -1.6, 0.45), (2.1, 1.6, 2.2)),
        ((-0.1, -0.4, 0.4), (1.8, 1.5, 1.9)),
        ((0.1, 0.7, 0.35), (1.4, 1.2, 1.5)),
    ]
    bulk = [(co, tuple(1.35 * x for x in size)) for co, size in masses]
    solid = link(bpy.data.objects.new('cave', metaball_mesh('cave-masses', bulk, 0.16)))
    cutter = link(bpy.data.objects.new('cave-tunnel', metaball_mesh('cave-tunnel', tunnel, 0.16)))
    carve = solid.modifiers.new('tunnel', 'BOOLEAN')
    carve.operation = 'DIFFERENCE'
    carve.solver = 'EXACT'
    carve.object = cutter
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(solid.evaluated_get(depsgraph))
    bpy.data.meshes.remove(cutter.data)
    old = solid.data
    bpy.data.objects.remove(solid)
    bpy.data.meshes.remove(old)

    # Ledges and facets: soft noise, ridges, and layers that run level as in bedded rock.
    noise.seed_set(SEED % 1000)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    for v in bm.verts:
        p = v.co
        broad = noise.fractal(p * 0.35, 0.6, 2.0, 4)
        ridge = 1 - abs(noise.noise(p * 0.9 + Vector((7, 3, 1))))
        layers = math.sin(p.z * 4.2 + 1.8 * noise.noise(p * 0.5)) * 0.5 + 0.5
        # Plates: cells of noise whose edges sink into cracks, so the rock breaks into blocks.
        cells = noise.voronoi(p * 0.55, distance_metric='DISTANCE')[0]
        plates = float(smoothstep(0.0, 0.18, cells[1] - cells[0]))
        shift = 0.42 * broad + 0.16 * ridge ** 3 + 0.12 * smoothstep(0.55, 0.95, layers) + 0.22 * plates
        # Centered on the metaballs' surface, and gentler in the tunnel, which it would close.
        inside = 1.0 if abs(p.x + 0.25) < 1.6 and p.z < 2.0 and p.y > -3.2 else 0.0
        v.co = p + v.normal * (shift - 0.35) * (1 - 0.65 * inside)
    # The cut at the ground: the model's foot sinks into the land.
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.5), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(mesh)
    bm.free()

    # Size it to the cave's box, then decimate it to the triangle budget.
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    low, high = co.min(axis=0), co.max(axis=0)
    scale = np.array(CAVE_SIZE) / (high - low)
    middle = (low + high) / 2
    co = (co - [middle[0], middle[1], low[2]]) * scale + [0, 0, -0.5]
    mesh.vertices.foreach_set('co', co.ravel())
    obj = link(bpy.data.objects.new('cave', mesh))
    triangles = sum(len(p.vertices) - 2 for p in mesh.polygons)
    decimate = obj.modifiers.new('decimate', 'DECIMATE')
    decimate.ratio = min(1.0, CAVE_TRIANGLES / triangles)
    decimate.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.clear()
    obj.data = low_mesh
    bpy.data.meshes.remove(mesh)
    mesh = low_mesh
    mesh.name = 'cave'

    # Box-projected UVs, 2.5 meters to a tile, from each face's main axis.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            p = loop.vert.co
            a, b = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][axis]
            loop[uv].uv = ((a + 0.37 * axis) / 2.5, (b + 0.61 * axis) / 2.5)
    bm.to_mesh(mesh)
    tree = BVHTree.FromBMesh(bm)
    # Occlusion by rays over each vertex's hemisphere: dark in the tunnel and the cracks.
    dirs = []
    for k in range(24):
        z = (k + 0.5) / 24
        a = k * 2.39996
        r = math.sqrt(1 - z * z)
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    colors = np.ones((len(bm.verts), 4), np.float32)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        n = v.normal
        rot = n.to_track_quat('Z', 'Y')
        hits = 0.0
        for d in dirs:
            ray = rot @ d
            hit = tree.ray_cast(v.co + n * 0.03, ray, 5.0)
            if hit[0] is not None:
                hits += 1 - hit[3] / 5.0
        ao = max(0.08, 1 - 1.25 * hits / len(dirs))
        p = v.co
        moss = float(smoothstep(0.45, 0.85, n.z + 0.35 * noise.noise(p * 0.8))) * float(smoothstep(0.3, 1.2, p.z))
        damp = 0.75 + 0.25 * float(smoothstep(-0.5, 0.6, p.z))
        stone = np.array([1.0, 0.98, 0.95]) * damp
        green = np.array([0.42, 0.55, 0.22])
        colors[v.index, :3] = ao * (stone * (1 - moss) + green * moss)
    bm.free()
    attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.ravel())
    mesh.color_attributes.active_color = attr
    mesh.shade_smooth()
    mesh.materials.clear()
    mesh.materials.append(mat)
    return obj, sum(len(p.vertices) - 2 for p in mesh.polygons)


# ---------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------


def export(path, objects, masked):
    """Writes the objects as one binary glTF file, then marks the cutout materials masked."""
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
            m['doubleSided'] = True
        else:
            m.pop('alphaMode', None)
            m.pop('doubleSided', None)
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


def preview(objects, path, view=(0.9, -2.2, 0.5)):
    """Renders the objects with Cycles under a sun and a sky color, framed from the front."""
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
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.6, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not args:
        raise SystemExit('Give the output folder: blender --background --python creek.py -- <folder>')
    out = os.path.abspath(args[0])
    shots = os.path.abspath(args[args.index('--preview') + 1]) if '--preview' in args else None
    os.makedirs(out, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rng = np.random.default_rng(SEED)

    atlas = image('leaves', leaf_atlas(1024, rng))
    leaf_mat = material('leaves', atlas, cutout=True, roughness=0.65)
    barks = {}
    for kind in ('oak', 'beech', 'birch'):
        color, height, rough = bark(kind, 512, 1024, rng)
        barks[kind] = material(
            f'bark-{kind}',
            image(f'bark-{kind}-color', color),
            image(f'bark-{kind}-normal', half(normal_map(height, {'oak': 9, 'beech': 3, 'birch': 4}[kind])), 'Non-Color'),
            image(f'bark-{kind}-orm', half(orm(occlusion_of(height, 16), rough)), 'Non-Color'),
        )
    tree_objects, counts = [], {}
    for name, spec in TREES.items():
        wood, leaves, wood_tris, leaf_tris = build_tree(name, spec, barks[spec['bark']], leaf_mat, rng)
        tree_objects += [wood, leaves]
        counts[name] = (wood_tris, leaf_tris)

    fern_mat = material('fern', image('fern', fern_frond(256, 1024, rng)), cutout=True, roughness=0.7)
    hosta_mat = material('hosta', image('hosta', broad_leaf(512, rng)), cutout=True, roughness=0.8)
    shrub_mat = material('shrub', atlas, cutout=True, roughness=0.65)
    plants = [
        build_fern(fern_mat, rng).build('fern', fern_mat),
        build_hosta(hosta_mat, rng).build('hosta', hosta_mat),
        build_shrub(shrub_mat, rng).build('shrub', shrub_mat),
    ]

    color, height, rough = rock_texture(1024, rng)
    rock_mat = material(
        'rock',
        image('rock-color', color),
        image('rock-normal', half(normal_map(height, 6)), 'Non-Color'),
        image('rock-orm', half(orm(occlusion_of(height, 24), rough)), 'Non-Color'),
    )
    cave, _ = build_cave(rock_mat, rng)

    report = {}
    report.update(export(os.path.join(out, 'trees.glb'), tree_objects, {'leaves'}))
    report.update(export(os.path.join(out, 'plants.glb'), plants, {'fern', 'hosta', 'shrub'}))
    report.update(export(os.path.join(out, 'cave.glb'), [cave], set()))
    for name, triangles in report.items():
        print(f'CREEK {name}: {triangles} triangles')
    for file in ('trees.glb', 'plants.glb', 'cave.glb'):
        print(f'CREEK {file}: {os.path.getsize(os.path.join(out, file)) / 1e6:.2f} MB')
    if shots:
        os.makedirs(shots, exist_ok=True)
        for name in TREES:
            preview([bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']], os.path.join(shots, f'{name}.png'))
        for plant in plants:
            preview([plant], os.path.join(shots, f'{plant.name}.png'))
        preview([cave], os.path.join(shots, 'cave.png'), (0.3, -2.2, 0.35))


main()
