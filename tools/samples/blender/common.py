# The parts that the showcase scenes' Blender scripts share: textures painted with numpy, materials
# that the glTF exporter reads, a mesh builder, crowns of leaf cards on pads, the export with levels
# of detail, and the preview. Each scene's script imports this module from its own folder, so every
# model is built the same way.
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
from mathutils.bvhtree import BVHTree

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


def material(name, color, normal=None, packed=None, cutout=False, roughness=0.8, normal_strength=1.0, tint=True):
    """
    A metal-rough material from images: base color (with alpha for a cutout), normal and ORM. With
    `tint`, the vertex colors multiply the base color, as glTF draws them, so the preview shows their
    occlusion; without it, the base color is the texture's alone, for a mesh that has no colors.
    """
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = color
    tex.interpolation = 'Cubic' if cutout else 'Linear'
    if tint:
        colors = nodes.new('ShaderNodeVertexColor')
        colors.layer_name = 'Color'
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        links.new(tex.outputs['Color'], mix.inputs['A'])
        links.new(colors.outputs['Color'], mix.inputs['B'])
        links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else:
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


def tent(builder, base, along, facing, size, uv_rect, color, center, sway, rise=0.15, bend=0.65):
    """
    A leaf card bent both across and along: four corners and a middle raised by `rise` of its size
    toward `facing`, in four triangles, so a crown of them never shows a flat sheet. It rises from
    `base` along `along`, and the texture fills `uv_rect`. The normals bend away from `center` by
    `bend`, and the corners' lean out from the card's middle, so each card shades as a small dome.
    """
    u0, v0, u1, v1 = uv_rect
    across = along.cross(facing)
    middle = base + along * size * 0.5
    corners = []
    for u, v in ((0, 0), (1, 0), (1, 1), (0, 1)):
        q = base + across * (u - 0.5) * size + along * v * size
        corners.append((q, u, v))
    corners.append((middle + facing * rise * size, 0.5, 0.5))
    ids = []
    for q, u, v in corners:
        out = q - center
        out = out.normalized() if out.length > 1e-4 else facing
        lean = q - middle
        lean = lean.normalized() * 0.35 if lean.length > 1e-4 else Vector((0, 0, 0))
        normal = (facing * (1 - bend) + out * bend + lean).normalized()
        ids.append(builder.vertex(q, (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v), color, normal, sway))
    c0, c1, c2, c3, m = ids
    for a, b in ((c0, c1), (c1, c2), (c2, c3), (c3, c0)):
        builder.face(a, b, m)


# ---------------------------------------------------------------------------------------------
# Sprays of leaves
# ---------------------------------------------------------------------------------------------


def window(size, a, b, pad):
    """The texel rows and columns of a box around two points (in cell units), padded, clipped to the cell."""
    x0 = max(0, int((min(a[0], b[0]) - pad) * size))
    x1 = min(size, int((max(a[0], b[0]) + pad) * size) + 2)
    y0 = max(0, int((min(a[1], b[1]) - pad) * size))
    y1 = min(size, int((max(a[1], b[1]) + pad) * size) + 2)
    return y0, y1, x0, x1


def paint_line(tile, a, b, width, color):
    """A line from `a` to `b` that tapers to a point, in a cell's units, painted over a cell."""
    size = tile.shape[0]
    y0, y1, x0, x1 = window(size, a, b, width + 2 / size)
    if y1 <= y0 or x1 <= x0:
        return
    py, px = np.mgrid[y0:y1, x0:x1].astype(np.float32) / size
    ab = np.array(b) - np.array(a)
    length2 = max(float(ab @ ab), 1e-9)
    t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / length2, 0, 1)
    dx, dy = px - (a[0] + t * ab[0]), py - (a[1] + t * ab[1])
    reach = width * (1 - 0.85 * t)
    coverage = np.clip((reach - np.hypot(dx, dy)) * size + 0.5, 0, 1)
    shade = (0.8 + 0.3 * t)[..., None]
    over(tile[y0:y1, x0:x1], np.array(color)[None, None] * shade, coverage)


def paint_leaf(tile, base, angle, length, width, tone, underside, mottle, taper=0.72, gloss=0.0):
    """
    One leaf on a cell, from `base` at `angle`, painted only in its own box. `underside` from 0 to 1
    blends its upper face's tone toward the pale felt that some leaves show beneath, and `gloss`
    lays a light streak beside the midrib, as a waxy leaf catches the sky.
    """
    size = tile.shape[0]
    tip = (base[0] + math.cos(angle) * length, base[1] + math.sin(angle) * length)
    y0, y1, x0, x1 = window(size, base, tip, width * length + 2 / size)
    if y1 <= y0 or x1 <= x0:
        return
    py, px = np.mgrid[y0:y1, x0:x1].astype(np.float32) / size
    coverage, s, t = leaf_mask(px, py, base, angle, length, width, 0.0, size / 2, taper)
    midrib = np.exp(-((t / 0.08) ** 2))
    edge = smoothstep(0.6, 1.0, np.abs(t))
    shade = 0.84 + 0.2 * s + 0.1 * midrib - 0.14 * edge + 0.14 * (mottle[y0:y1, x0:x1] - 0.5)
    shade = shade + gloss * np.exp(-(((t - 0.35) / 0.25) ** 2)) * np.clip(4 * s * (1 - s), 0, 1)
    color = np.array(tone)[None, None] * shade[..., None]
    pale = np.array([0.62, 0.66, 0.58])[None, None] * (0.9 + 0.1 * s[..., None])
    color = color * (1 - underside) + pale * underside
    over(tile[y0:y1, x0:x1], color, coverage)


def cells(size):
    """The four cells of a 2 x 2 atlas, as their texel offsets."""
    cell = size // 2
    return cell, [((k // 2) * cell, (k % 2) * cell) for k in range(4)]


def sprig_atlas(size, rng, leaves, length, width, tones, underside, twig, taper=0.72, spread=(0.5, 1.1), twigs=0, gloss=0.0):
    """
    Four sprigs of leaves in a 2 x 2 atlas, each a twig up its cell from the middle of the bottom
    edge with `twigs` side twigs off it, and `leaves` leaves along them all. `length` is a leaf's
    length as a share of the cell. `underside` is the share of leaves that turn their pale side to
    the viewer, and `spread` is the range of their angles from their twig, in radians. Every leaf
    stays inside its cell, so no card shows a straight edge.
    """
    cell, offsets = cells(size)
    out = np.zeros((size, size, 4), np.float32)
    mottle = fbm(size, size, 8, 8, rng, 4)
    for k, (oy, ox) in enumerate(offsets):
        tile = np.zeros((cell, cell, 4), np.float32)
        bend = (rng.random() - 0.5) * 0.3
        main = [(0.5 + bend * (i / 8 * 0.85) ** 2, i / 8 * 0.85) for i in range(9)]
        # Each twig is a polyline in the cell's units, with the width of its foot.
        lines = [(main, 0.008)]
        for j in range(twigs):
            v = 0.15 + 0.6 * (j + 0.5) / twigs
            foot = (0.5 + bend * v * v, v)
            side = 1 if j % 2 else -1
            a = math.pi / 2 - side * (0.6 + 0.4 * rng.random())
            reach = (0.24 + 0.12 * rng.random()) * (1.1 - 0.5 * v)
            mid = (foot[0] + math.cos(a) * reach * 0.5, foot[1] + math.sin(a) * reach * 0.5 + 0.02)
            end = (foot[0] + math.cos(a + side * 0.25) * reach, foot[1] + math.sin(a + side * 0.25) * reach + 0.05)
            lines.append(([foot, mid, end], 0.005))
        spans = []
        for points, w in lines:
            for a, b in zip(points, points[1:]):
                paint_line(tile, a, b, w, twig)
                spans.append((a, b))
        lengths = np.array([math.dist(a, b) for a, b in spans])
        for j in range(leaves):
            a, b = spans[rng.choice(len(spans), p=lengths / lengths.sum())]
            t = rng.random()
            base = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            heading = math.atan2(b[1] - a[1], b[0] - a[0])
            side = 1 if j % 2 else -1
            angle = heading - side * (spread[0] + (spread[1] - spread[0]) * rng.random())
            reach = length * (0.8 + 0.4 * rng.random())
            tip = (base[0] + math.cos(angle) * reach, base[1] + math.sin(angle) * reach)
            # Shorten a leaf whose tip would leave the cell.
            room = 1.0
            for value, start, step in ((tip[0], base[0], math.cos(angle)), (tip[1], base[1], math.sin(angle))):
                if value > 0.96 and step > 0:
                    room = min(room, (0.96 - start) / (step * reach))
                if value < 0.04 and step < 0:
                    room = min(room, (0.04 - start) / (step * reach))
            tone = np.array(tones[k % len(tones)]) * (0.85 + 0.3 * rng.random())
            flip = 1.0 if rng.random() < underside else 0.0
            paint_leaf(tile, base, angle, reach * max(room, 0.2), width, tone, flip, mottle[oy:oy + cell, ox:ox + cell], taper, gloss)
        for points, _ in lines:
            # Each twig ends in a leaf that carries it on.
            a, b = points[-2], points[-1]
            heading = math.atan2(b[1] - a[1], b[0] - a[0])
            paint_leaf(tile, b, heading, min(length, 0.96 - b[1]) if b[1] < 0.9 else 0.03, width, np.array(tones[0]), 0.0, mottle[oy:oy + cell, ox:ox + cell], taper, gloss)
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


def needle_atlas(size, rng, tones=((0.2, 0.33, 0.15), (0.21, 0.34, 0.16)), twig=(0.32, 0.2, 0.12), mat=False):
    """
    A pine's needles: three tufts seen from above, each a burst of long fine needles from a
    hidden twig, and a cell of a twig end seen from the side with its needles brushing upward.
    `tones` gives the needles' color in the tufts and on the twig, and `twig` the twig's. Every
    needle stays inside its cell, and its edge fades over a texel. With `mat`, the last cell is
    instead a dense, opaque mat of short needles every way, for the body of a crown's pads.
    """
    cell, offsets = cells(size)
    out = np.zeros((size, size, 4), np.float32)
    for k, (oy, ox) in enumerate(offsets):
        tile = np.zeros((cell, cell, 4), np.float32)
        if k == 3 and mat:
            tile[..., :3] = np.array(tones[1]) * 0.55
            tile[..., 3] = 1.0
            for _ in range(2600):
                a = rng.random() * 2 * math.pi
                start = (0.02 + 0.96 * rng.random(), 0.02 + 0.96 * rng.random())
                reach = 0.03 + 0.05 * rng.random()
                end = (min(0.99, max(0.01, start[0] + math.cos(a) * reach)), min(0.99, max(0.01, start[1] + math.sin(a) * reach)))
                tone = np.array(tones[1]) * (0.6 + 0.6 * rng.random())
                paint_line(tile, start, end, 0.003, tone)
        elif k < 3:
            # Several twig ends crowd into one tuft, so its outline is lumpy, not a round brush.
            for _ in range(5):
                cx, cy = 0.5 + rng.normal(0, 0.1), 0.5 + rng.normal(0, 0.1)
                for _ in range(70):
                    a = rng.random() * 2 * math.pi
                    reach = 0.12 + 0.2 * rng.random()
                    end = (cx + math.cos(a) * reach, cy + math.sin(a) * reach)
                    end = (min(0.97, max(0.03, end[0])), min(0.97, max(0.03, end[1])))
                    tone = np.array(tones[0]) * (0.75 + 0.5 * rng.random())
                    paint_line(tile, (cx, cy), end, 0.0045, tone)
        else:
            # A twig from the middle of the bottom edge, with needles in pairs along it.
            paint_line(tile, (0.5, 0.0), (0.5, 0.75), 0.012, twig)
            for j in range(90):
                v = 0.05 + 0.75 * rng.random()
                side = 1 if j % 2 else -1
                a = math.pi / 2 - side * (0.35 + 0.6 * rng.random())
                reach = 0.15 + 0.12 * rng.random()
                end = (0.5 + math.cos(a) * reach, v + math.sin(a) * reach)
                end = (min(0.97, max(0.03, end[0])), min(0.97, max(0.03, end[1])))
                tone = np.array(tones[1]) * (0.75 + 0.5 * rng.random())
                paint_line(tile, (0.5, v), end, 0.0045, tone)
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


# ---------------------------------------------------------------------------------------------
# Pad crowns
# ---------------------------------------------------------------------------------------------


def branch_phase(index):
    """A branch's phase of flutter, from its place in the plant, spread by the golden ratio."""
    return (index * 0.6180339887) % 1.0


class Plant:
    """
    A plant's branches, as (points, radii, level), and its pads: (center, radii, branch). A pad is
    an ellipsoid of foliage at the end of a branch, and the crown is the union of its pads.
    """

    def __init__(self):
        self.branches, self.pads = [], []

    def branch(self, points, radii, level):
        self.branches.append((points, radii, level))
        return len(self.branches) - 1

    def pad(self, center, radii, branch):
        self.pads.append((Vector(center), Vector(radii), branch))


def plant_top(plant):
    """The height of the plant's highest branch point or pad, which its sway weights are shares of."""
    tops = [p.z for points, _, _ in plant.branches for p in points]
    tops += [c.z + r.z for c, r, _ in plant.pads]
    return max(tops)


def plant_reach(plant):
    """The plant's reach from its trunk, across the ground."""
    return max([math.hypot(c.x, c.y) + r.x for c, r, _ in plant.pads] + [0.5])


def inside(q, radii):
    """Below 1 where an offset `q` from a pad's middle lies inside the pad's ellipsoid."""
    return (q.x / radii.x) ** 2 + (q.y / radii.y) ** 2 + (q.z / radii.z) ** 2


def crown_cards(plant, rng, count, up=0.6, depth=0.25):
    """
    The cards' places on the union of a plant's pads: points on each pad's surface, the more where
    the surface faces up, less any that fall inside another pad. Each is (point, normal, branch).
    """
    areas = [r.x * r.y + r.y * r.z + r.x * r.z for _, r, _ in plant.pads]
    total = sum(areas)
    places = []
    for (c, r, branch), area in zip(plant.pads, areas):
        want = max(3, round(count * area / total))
        tries = 0
        made = 0
        while made < want and tries < want * 12:
            tries += 1
            n = Vector(rng.normal(0, 1, 3)).normalized()
            if rng.random() > (1 - up) + up * (0.5 + 0.5 * n.z):
                continue
            p = c + Vector((n.x * r.x, n.y * r.y, n.z * r.z)) * (1 - depth * rng.random())
            if any(other is not c and inside(p - other, s) < 0.8 for other, s, _ in plant.pads):
                continue
            normal = Vector((n.x / r.x, n.y / r.y, n.z / r.z)).normalized()
            places.append((p, normal, branch))
            made += 1
    return places


def leaf_part(spec, plant, places, rng, grow):
    """
    The leaf cards on the given places, each `grow` times its usual size. The spec gives:
      card     a card's size in meters
      lift     how far a card's face turns from its pad's surface toward the sky
      scatter  the random turn of each card's face
      centered the share of a card that reaches behind its place: 0.5 centers a tuft on it
      cells    the atlas cells the cards draw from; fold and bend shape them as `card` says
      tent     true draws each card as a `tent`, bent across and along, whose rise is `fold`
      tint     the color that multiplies every card's
      shade    the darkest a card grows under the crown and inside it, which defaults to 0.35
    """
    leaves = Builder()
    top = plant_top(plant)
    reach = plant_reach(plant)
    center = Vector(np.array([tuple(c) for c, _, _ in plant.pads]).mean(axis=0))
    tint = Vector(spec['tint'])
    shade = spec.get('shade', 0.35)
    for p, n, branch in places:
        facing = (n * (1 - spec['lift']) + Vector((0, 0, spec['lift']))).normalized()
        facing = (facing + Vector(rng.normal(0, spec['scatter'], 3))).normalized()
        # The card runs up and out along the pad's surface, as the twig that bears it does.
        out = Vector((p.x, p.y, 0))
        out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
        along = out + Vector((0, 0, 0.8)) + Vector(rng.normal(0, 0.5, 3))
        along = (along - facing * along.dot(facing))
        along = along.normalized() if along.length > 1e-3 else frame_of(facing)[0]
        size = spec['card'] * (0.8 + 0.4 * rng.random()) * grow
        cell = spec['cells'][int(rng.random() * len(spec['cells']))]
        cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
        base = p - along * size * spec['centered']
        # Darker under the crown and inside it, lighter on top and at the rim.
        rim = min(1.0, (p - center).length / max(reach, 1e-3))
        ao = shade + (1 - shade) * float(smoothstep(-0.7, 0.7, 0.8 * n.z + 0.5 * rim - 0.1))
        hue = 0.9 + 0.2 * rng.random()
        color = tuple(ao * hue * c for c in tint)
        sway = (0.75 * max(0.0, p.z) / top + 0.35 * math.hypot(p.x, p.y) / reach, branch_phase(branch))
        if spec.get('tent'):
            tent(leaves, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, spec['fold'], spec['bend'])
        else:
            card(leaves, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, spec['fold'], spec['bend'])
    return leaves


# ---------------------------------------------------------------------------------------------
# Levels of detail
# ---------------------------------------------------------------------------------------------

# A pixel's size, in meters for each meter away, on a screen 1,080 pixels high at a 45 degree view:
# a level's error over this is the distance past which it changes the picture by under a pixel.
PIXEL_PER_METER = 0.00077


def surface_points(obj, count, rng):
    """`count` points spread over an object's surface by area, in its own frame."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3).astype(np.float64)
    tris = np.empty(len(mesh.loop_triangles) * 3, np.int32)
    mesh.loop_triangles.foreach_get('vertices', tris)
    a, b, c = (co[tris.reshape(-1, 3)[:, k]] for k in range(3))
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    pick = rng.choice(len(area), count, p=area / area.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]


def level_error(level, full, share=0.95, count=20000, seed=1):
    """
    A lower level's surface error, in meters: the distance below which `share` of the points spread
    over both surfaces lie from the other surface. A level that drops leaf cards moves a few points
    far, so the largest distance would keep the finest level on screen for no gain, while the
    share counts the change that the eye sees.
    """
    def tree(obj):
        return BVHTree.FromPolygons([v.co for v in obj.data.vertices], [p.vertices for p in obj.data.polygons])

    rng = np.random.default_rng(seed)
    gaps = []
    for points, onto in ((surface_points(level, count, rng), tree(full)), (surface_points(full, count, rng), tree(level))):
        gaps += [onto.find_nearest(Vector(p))[3] or 0.0 for p in points]
    return float(np.quantile(gaps, share))


# ---------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------


def export(path, objects, masked, levels=(), one_sided=()):
    """Writes the objects as one binary glTF file, then marks the cutout materials masked.

    A masked material is double sided, unless `one_sided` names it: a mesh that carries its own
    back faces, each with the normals it needs, draws its cutout with its back faces culled.

    An object named `<part>-<k>` is level k of the part named `<part>`, and `levels` gives each
    level's error, the same for every part, or maps each part's name to its own levels' errors. The
    part's node lists its levels in the MSFT_lod extension, from the finest down, with their errors
    in its extras, and the levels' nodes leave the scene. Each mesh keeps its two sets of texture
    coordinates: the texture's, and the sway's.
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
            errors = levels.get(node['name'], ()) if isinstance(levels, dict) else levels
            if not errors and f"{node['name']}-1" in index:
                raise SystemExit(f"{node['name']} has lower levels but no level errors to give them")
            ids = [index[f"{node['name']}-{n}"] for n in range(1, len(errors) + 1) if f"{node['name']}-{n}" in index]
            if not ids:
                continue
            node.setdefault('extensions', {})['MSFT_lod'] = {'ids': ids}
            node.setdefault('extras', {})['NULL3D_lod_error'] = [errors[n] for n in range(len(ids))]
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


def stage(objects, sky, size, samples):
    """
    Shows only the objects to the renderer, under a sun and a sky color, with Cycles at the given
    size, and returns the preview camera and the objects' lowest and highest points.
    """
    scene = bpy.context.scene
    for o in scene.collection.objects:
        if o.type == 'MESH':
            o.hide_render = o not in objects
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    cam = bpy.data.objects.get('preview-camera') or link(bpy.data.objects.new('preview-camera', bpy.data.cameras.new('preview-camera')))
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
    return cam, low, high


def preview(objects, path, view=(0.9, -2.2, 0.5), sky=(0.45, 0.6, 0.85), size=(640, 480), samples=24):
    """Renders the objects with Cycles under a sun and a sky color, framed from `view`."""
    cam, low, high = stage(objects, sky, size, samples)
    middle, radius = (low + high) / 2, (high - low).length / 2
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'AUTO'
    cam.data.lens = 50
    cam.location = middle + Vector(view) * radius
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def at_distance(groups, path, distance, gap=2.0, sky=(0.45, 0.6, 0.85)):
    """
    Renders groups of objects side by side as a page's camera sees them from `distance` meters: a
    45 degree view on a screen 1,080 pixels high, so each group draws at the size in pixels that the
    page gives it there. The picture is cut to the groups, over the sky's color.
    """
    moved, x = [], 0.0
    for group in groups:
        half = max(max(abs(v.co.x) for v in o.data.vertices) for o in group)
        x += half
        for o in group:
            o.location.x = x
        x += half + gap
        moved += group
    bpy.context.view_layer.update()
    width, height = 1920, 1080
    cam, low, high = stage(moved, sky, (width, height), 32)
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(45)
    middle = (low + high) / 2
    cam.location = (middle.x, middle.y - distance, middle.z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene = bpy.context.scene
    scene.render.film_transparent = True
    whole = f'{path[:-4]}-whole.png'
    scene.render.filepath = whole
    bpy.ops.render.render(write_still=True)
    scene.render.film_transparent = False
    for o in moved:
        o.location.x = 0
    bpy.context.view_layer.update()
    shot = bpy.data.images.load(whole)
    texels = np.array(shot.pixels[:], np.float32).reshape(height, width, 4)
    bpy.data.images.remove(shot)
    os.remove(whole)
    rows = np.where(texels[..., 3].max(axis=1) > 0)[0]
    cols = np.where(texels[..., 3].max(axis=0) > 0)[0]
    y0, y1 = max(0, rows[0] - 8), min(height, rows[-1] + 9)
    x0, x1 = max(0, cols[0] - 8), min(width, cols[-1] + 9)
    part = texels[y0:y1, x0:x1]
    alpha = part[..., 3:4]
    # Over the sky's color as the display shows it.
    behind = np.array([(c ** (1 / 2.2)) for c in sky], np.float32)
    flat = np.ones_like(part)
    flat[..., :3] = part[..., :3] * alpha + behind * (1 - alpha)
    img = bpy.data.images.new(os.path.basename(path), x1 - x0, y1 - y0, alpha=False)
    img.pixels.foreach_set(np.ascontiguousarray(flat).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def close_up(objects, path, view=(0.9, -2.2, 0.35), box=(0.25, 0.75, 0.45, 0.9)):
    """
    Renders the objects as `preview` frames them, at three times the size, and keeps the share of
    the picture that `box` names (left, right, bottom, top), so a crown's leaves show at full size.
    """
    width, height = 1920, 1440
    whole = f'{path[:-4]}-whole.png'
    preview(objects, whole, view, size=(width, height))
    shot = bpy.data.images.load(whole)
    texels = np.array(shot.pixels[:], np.float32).reshape(height, width, 4)
    bpy.data.images.remove(shot)
    os.remove(whole)
    x0, x1 = int(box[0] * width), int(box[1] * width)
    y0, y1 = int(box[2] * height), int(box[3] * height)
    part = np.ascontiguousarray(texels[y0:y1, x0:x1])
    img = bpy.data.images.new(os.path.basename(path), x1 - x0, y1 - y0, alpha=False)
    img.pixels.foreach_set(part.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


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
