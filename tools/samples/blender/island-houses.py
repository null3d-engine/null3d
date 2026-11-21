# Builds the island showcase scene's Mediterranean houses in Blender: thirteen forms that the town
# plan's house kinds map to, each a whitewashed or stone house under a terracotta roof, with shutters,
# dark glazing, a framed door, a chimney and, where its form has one, a balcony, an arcade, a pergola,
# a veranda or a roof terrace. Everything comes from this script and a fixed seed: the forms and every
# texture, which numpy paints. Nothing is downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/island-houses.py -- <output folder> [--preview <folder>]
#
# `bun tools/samples/blender/island-houses.ts <folder>` runs it and optimizes the file for the scene.
#
# It writes one binary glTF file, `houses.glb`, with a node for each material of each house form and
# two lower levels of detail (MSFT_lod) on every node. The town draws each node as an instance batch
# over the lots of its kind, so a form's hundreds of copies cost a few draw calls.
#
# Coordinates are the showcase scene's own: x across, y up and z toward a house's front, in meters.
# Each form's origin is its ground point at ground level, and its front faces +z, as the scene's
# code-built house forms do. `common.py` turns the coordinates into Blender's axes as it builds,
# where a model's front faces -y, which glTF exports as +z.
#
# Every face has its own vertices and its own normals, so edges stay crisp while a pot's rings and a
# chimney's pot keep a smooth curve. Vertex colors carry the paint, the shutter and door colors and
# the grounding shade, which the glTF material multiplies into the texture. Every texture is painted
# here: lime whitewash, rubble stone, ashlar trim, terracotta roof tiles, painted timber, dark glazing
# and a cutout ivy card for the pergolas' and verandas' vines.

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

# The shared module loads from beside this script, and leaves no bytecode cache in the repository.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Builder, arguments, at_distance, export, fbm, half, image, material, normal_map, occlusion_of,
    orm, smoothstep, sprig_atlas, stage,
)

SEED = 20261122

SKY = (0.42, 0.56, 0.80)

FLOOR = 3.05
# How far the walls reach under the ground. The plan allows a plot's ground to lie a metre below
# a house's floor at its corners, so the skirt clears that and never leaves a house on air.
SKIRT = 1.2
# One texture tile's length in meters on a wall and on a roof.
WALL_TILE = 1.8
ROOF_TILE = 1.2

# ---------------------------------------------------------------------------------------------
# Painting
# ---------------------------------------------------------------------------------------------


def render_texture(size, rng):
    """Lime whitewash: a warm near-white with a soft mottle, a fine grain and faint damp stains."""
    base = np.array([0.94, 0.92, 0.86])
    broad = fbm(size, size, 3, 3, rng, 5)
    mid = fbm(size, size, 10, 10, rng, 4)
    grain = fbm(size, size, 64, 64, rng, 2)
    patch = smoothstep(0.66, 0.9, fbm(size, size, 2, 2, rng, 4))
    shade = 0.985 + 0.03 * (broad - 0.5) + 0.025 * (mid - 0.5) + 0.02 * (grain - 0.5) - 0.03 * patch
    return np.clip(base[None, None, :] * shade[..., None], 0, 1)


def rubble_texture(size, rng):
    """Weathered rubble stone in a pale lime mortar, with a warm grain and a little staining."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    warp = fbm(size, size, 4, 4, rng, 3) * 18 - 9
    cells = 7
    u = (xx + warp) / size * cells
    v = (yy + fbm(size, size, 5, 5, rng, 2) * 10 - 5) / size * cells
    fu, fv = u % 1, v % 1
    edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    height = 0.35 + 0.65 * smoothstep(0.02, 0.16, edge)
    tone = rng.uniform(0.82, 1.1, (cells + 1, cells + 1))
    stone = tone[(v.astype(int) % cells), (u.astype(int) % cells)]
    grain = fbm(size, size, 40, 40, rng, 3)
    stain = smoothstep(0.6, 0.92, fbm(size, size, 4, 4, rng, 4))
    colour = np.array([0.76, 0.71, 0.6])[None, None, :] * stone[..., None]
    colour = colour * (0.92 + 0.1 * grain[..., None]) * (1 - 0.1 * stain[..., None])
    mortar = np.array([0.78, 0.75, 0.68])[None, None, :]
    colour = np.where(height[..., None] < 0.5, mortar, colour)
    rough = 0.82 + 0.12 * grain
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def ashlar_texture(size, rng):
    """Pale limestone in staggered courses, for the trim, the plinths and the arcade piers."""
    rows, cols = 4, 3
    bh, bw = size // rows, size // cols
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    row = (yy // bh).astype(int)
    stagger = (row % 2) * (bw // 2)
    col = ((xx + stagger) % size // bw).astype(int)
    fx = ((xx + stagger) % bw) / bw
    fy = (yy % bh) / bh
    edge = np.minimum(np.minimum(fx, 1 - fx) * bw, np.minimum(fy, 1 - fy) * bh)
    height = 0.55 + 0.45 * smoothstep(0.5, 2.5, edge)
    tone = rng.uniform(0.95, 1.05, (rows, 4))[row % rows, col % 4]
    grain = fbm(size, size, 40, 40, rng, 3)
    stain = smoothstep(0.55, 0.9, fbm(size, size, 5, 5, rng, 4))
    colour = np.array([0.7, 0.66, 0.56])[None, None, :] * tone[..., None]
    colour = colour * (0.95 + 0.05 * grain[..., None]) * (1 - 0.07 * stain[..., None])
    mortar = np.array([0.62, 0.59, 0.52])[None, None, :]
    colour = np.where(height[..., None] < 0.68, mortar, colour)
    rough = 0.8 + 0.14 * grain - 0.06 * stain
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def roof_texture(size, rng):
    """Terracotta barrel tiles in columns and overlapping courses, weathered with lichen."""
    cols, rows = 9, 5
    bw, bh = size / cols, size / rows
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (xx % bw) / bw
    v = (yy % bh) / bh
    profile = np.sin(np.pi * u) ** 0.8
    course = smoothstep(0.0, 0.16, v)
    height = 0.25 + 0.55 * profile * course + 0.2 * (1 - 0.3 * v)
    tone = rng.uniform(0.82, 1.14, (rows + 1, cols + 1))
    tile = tone[(yy // bh).astype(int) % (rows + 1), (xx // bw).astype(int) % (cols + 1)]
    grain = fbm(size, size, 48, 48, rng, 2)
    lichen = smoothstep(0.74, 0.95, fbm(size, size, 6, 6, rng, 4))
    colour = np.array([0.5, 0.22, 0.13])[None, None, :] * tile[..., None]
    colour = colour * (0.86 + 0.14 * grain[..., None]) * (0.6 + 0.4 * profile[..., None])
    moss = np.array([0.3, 0.31, 0.18])[None, None, :]
    colour = colour * (1 - 0.45 * lichen[..., None]) + moss * (0.45 * lichen[..., None])
    rough = 0.66 + 0.28 * lichen + 0.06 * grain
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def timber_texture(size, rng):
    """Dark planks with grain, a little bleaching and dark joins between them."""
    planks = 6
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (xx % (size / planks)) / (size / planks)
    split = smoothstep(0.0, 0.03, u) * smoothstep(1.0, 0.97, u)
    grain = 0.5 + 0.5 * np.sin(xx * 0.6 + fbm(size, size, 32, 32, rng, 2) * 9.0)
    tone = rng.uniform(0.8, 1.2, planks)[(xx // (size / planks)).astype(int) % planks]
    colour = np.array([0.24, 0.14, 0.075])[None, None, :] * tone[..., None]
    colour = colour * (0.78 + 0.22 * grain[..., None]) * (0.55 + 0.45 * split[..., None])
    return np.clip(colour, 0, 1)


def paint_texture(size, rng):
    """Painted boards: a near-white ground with a fine grain and a faint seam down each board."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    board = (xx % (size / 8)) / (size / 8)
    seams = smoothstep(0.0, 0.02, board) * smoothstep(1.0, 0.98, board)
    grain = fbm(size, size, 40, 40, rng, 3)
    wear = smoothstep(0.72, 0.96, fbm(size, size, 7, 7, rng, 3))
    shade = 0.97 + 0.03 * (grain - 0.5) - 0.05 * wear
    colour = np.array([0.93, 0.92, 0.88])[None, None, :] * shade[..., None]
    colour = colour * (0.9 + 0.1 * seams[..., None])
    return np.clip(colour, 0, 1)


def glazing_texture(size, rng):
    """Old glass: near black, with a few bright streaks and a little grime."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    streak = smoothstep(
        0.3, 0.8, np.sin((xx * 0.9 + yy * 0.25) / size * 8 + fbm(size, size, 8, 8, rng, 2) * 6)
    )
    grime = fbm(size, size, 24, 24, rng, 3)
    colour = np.array([0.03, 0.04, 0.055])[None, None, :] * (1 + 3.2 * streak[..., None])
    return np.clip(colour * (0.85 + 0.3 * grime[..., None]), 0, 1)


def vine_texture(size, rng):
    """Four ivy sprigs in a 2 x 2 atlas, near white, which each card's color tints."""
    tones = [(0.92, 0.96, 0.86), (0.84, 0.92, 0.78), (0.96, 0.94, 0.82)]
    return sprig_atlas(
        size, rng, leaves=7, length=0.5, width=0.2, tones=tones, underside=0.22,
        twig=(0.34, 0.34, 0.24), taper=0.6, spread=(0.45, 1.05), twigs=2,
    )


def make_materials(rng):
    """The seven materials that the houses share, each with the maps it needs."""
    colour, height, rough = rubble_texture(512, rng)
    stone = material(
        'houses-stone',
        image('houses-stone', colour),
        image('houses-stone-normal', half(normal_map(height, 1.1)), 'Non-Color'),
        image('houses-stone-orm', half(orm(occlusion_of(height, 8), rough)), 'Non-Color'),
        roughness=1.0,
    )
    trim_colour, trim_height, trim_rough = ashlar_texture(512, rng)
    trim = material(
        'houses-trim',
        image('houses-trim', trim_colour),
        image('houses-trim-normal', half(normal_map(trim_height, 0.9)), 'Non-Color'),
        image('houses-trim-orm', half(orm(occlusion_of(trim_height, 8), trim_rough)), 'Non-Color'),
        roughness=1.0,
    )
    roof_colour, roof_height, roof_rough = roof_texture(512, rng)
    roof = material(
        'houses-roof',
        image('houses-roof', roof_colour),
        image('houses-roof-normal', half(normal_map(roof_height, 2.6)), 'Non-Color'),
        image('houses-roof-orm', half(orm(occlusion_of(roof_height, 6), roof_rough)), 'Non-Color'),
        roughness=1.0,
    )
    return {
        'render': material(
            'houses-render', image('houses-render', render_texture(512, rng)), roughness=0.95
        ),
        'stone': stone,
        'trim': trim,
        'roof': roof,
        'timber': material(
            'houses-timber', image('houses-timber', timber_texture(256, rng)), roughness=0.74
        ),
        'paint': material(
            'houses-paint', image('houses-paint', paint_texture(256, rng)), roughness=0.7
        ),
        'glass': material(
            'houses-glass', image('houses-glass', glazing_texture(256, rng)), roughness=0.16
        ),
        'vine': material(
            'houses-vine', image('houses-vine', vine_texture(256, rng)), cutout=True, roughness=0.72
        ),
    }


# ---------------------------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------------------------


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(v):
    length = math.sqrt(_dot(v, v)) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def _sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Geo:
    """Faces of one material, in the scene's coordinates, drawn into a Builder in Blender's axes."""

    def __init__(self):
        self.builder = Builder(sway=False)

    def vertex(self, p, uv, color, normal):
        return self.builder.vertex((p[0], -p[2], p[1]), uv, color, (normal[0], -normal[2], normal[1]))

    def face(self, points, color, tile=1.0, normal=None, uvs=None):
        """
        A face, counter-clockwise seen from outside. A given `normal` also turns the points' order
        right, so a caller may name them in any order. Its texture coordinates run in meters along
        the face's own plane unless `uvs` gives them.
        """
        if len(points) < 3:
            return
        turned = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
        n = normal or _unit(turned)
        if normal and _dot(turned, normal) < 0:
            points = tuple(reversed(points))
        if abs(n[0]) >= abs(n[1]) and abs(n[0]) >= abs(n[2]):
            u_axis, v_axis = (0, 0, 1), (0, 1, 0)
        elif abs(n[1]) >= abs(n[2]):
            u_axis, v_axis = (1, 0, 0), (0, 0, 1)
        else:
            u_axis, v_axis = (1, 0, 0), (0, 1, 0)
        ids = []
        for k, p in enumerate(points):
            uv = uvs[k] if uvs is not None else (_dot(p, u_axis) / tile, _dot(p, v_axis) / tile)
            if abs(n[1]) > 0.7:
                shade = 1.0 if n[1] > 0 else 0.5
            else:
                shade = 0.70 + 0.30 * _sstep(0.0, 5.5, p[1])
            ids.append(self.vertex(p, uv, tuple(c * shade for c in color), n))
        self.builder.face(*ids)

    def box(self, x0, y0, z0, x1, y1, z1, color, tile=1.5, top=True, bottom=False):
        """The box's faces, outward; `top` and `bottom` may leave a lid off."""
        if top:
            self.face([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], color, tile, (0, 1, 0))
        if bottom:
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], color, tile, (0, -1, 0))
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], color, tile, (0, 0, 1))
        self.face([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], color, tile, (0, 0, -1))
        self.face([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], color, tile, (1, 0, 0))
        self.face([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], color, tile, (-1, 0, 0))

    def revolve(self, cx, cz, rings, sides, color, tile=1.0, cap_top=False):
        """A stack of rings (height, radius) about a vertical axis, with smooth radial normals."""
        rows = []
        for y, r in rings:
            rows.append([
                (cx + math.sin(math.tau * j / sides) * r, y, cz + math.cos(math.tau * j / sides) * r)
                for j in range(sides)
            ])
        for i in range(len(rings) - 1):
            dy = rings[i + 1][0] - rings[i][0] or 1e-6
            slope = (rings[i][1] - rings[i + 1][1]) / dy
            for j in range(sides):
                k = (j + 1) % sides
                quad = [rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]]
                ids = []
                for point in quad:
                    a = math.tau * j / sides
                    uv = (a * rings[i][1] / tile, point[1] / tile)
                    shade = 0.70 + 0.30 * _sstep(0.0, 5.5, point[1])
                    ids.append(self.vertex(point, uv, tuple(c * shade for c in color),
                                           _unit((math.sin(a), slope, math.cos(a)))))
                self.builder.face(*ids)
        if cap_top:
            y, r = rings[-1]
            ids = [
                self.vertex(
                    (cx + math.sin(math.tau * j / sides) * r, y, cz + math.cos(math.tau * j / sides) * r),
                    (cx, cz), color, (0, 1, 0),
                )
                for j in range(sides)
            ]
            mid = self.vertex((cx, y, cz), (0, 0), color, (0, 1, 0))
            for j in range(sides):
                self.builder.face(mid, ids[j], ids[(j + 1) % sides])

    def roof_plane(self, points, color, tile):
        """A single slope, turned to face upward."""
        n = _unit(_cross(_sub(points[1], points[0]), _sub(points[2], points[0])))
        self.face(points, color, tile, n if n[1] >= 0 else (-n[0], -n[1], -n[2]))


# ---------------------------------------------------------------------------------------------
# Paint colors, in linear light, multiplied into the maps' own colors
# ---------------------------------------------------------------------------------------------

WHITE = (1.0, 1.0, 1.0)
CREAM = (1.0, 0.98, 0.93)
OCHRE = (1.0, 0.94, 0.84)
ROSE = (1.0, 0.93, 0.9)
PALE = (0.97, 0.95, 0.9)
STONE = (0.96, 0.93, 0.86)
DARK = (0.055, 0.05, 0.05)
# A shadowed loggia reads as a dark interior, not as a hole in the wall.
SHADE = (0.1, 0.08, 0.06)
IRON = (0.07, 0.07, 0.08)
GREEN = (0.14, 0.36, 0.22)
BLUE = (0.12, 0.24, 0.44)
TEAL = (0.09, 0.33, 0.31)
DOOR_GREEN = (0.1, 0.28, 0.18)
TERRACOTTA = (1.0, 0.9, 0.84)
CAP = (0.86, 0.7, 0.62)
LEAF = (0.14, 0.34, 0.1)
BLOOM = (0.6, 0.06, 0.3)
BLOOM_PALE = (0.72, 0.24, 0.46)


def wall_at(cx, cy, cz, dx, dz):
    """A place on a wall: across it, up it, and out from it."""
    return lambda across, up, out: (cx + dz * across + dx * out, cy + up, cz - dx * across + dz * out)


def wall_box(geo, w, a0, a1, u0, u1, o0, o1, color, tile=1.2):
    """A box on a wall, in the wall's own frame."""
    geo.face([w(a0, u0, o1), w(a1, u0, o1), w(a1, u1, o1), w(a0, u1, o1)], color, tile, (0, 0, 1))
    geo.face([w(a0, u0, o0), w(a0, u1, o0), w(a1, u1, o0), w(a1, u0, o0)], color, tile, (0, 0, -1))
    geo.face([w(a1, u0, o0), w(a1, u1, o0), w(a1, u1, o1), w(a1, u0, o1)], color, tile, (1, 0, 0))
    geo.face([w(a0, u0, o1), w(a0, u1, o1), w(a0, u1, o0), w(a0, u0, o0)], color, tile, (-1, 0, 0))
    geo.face([w(a0, u1, o1), w(a1, u1, o1), w(a1, u1, o0), w(a0, u1, o0)], color, tile, (0, 1, 0))
    geo.face([w(a0, u0, o0), w(a1, u0, o0), w(a1, u0, o1), w(a0, u0, o1)], color, tile, (0, -1, 0))


def window(model, origin, normal, shutter, detail, width=1.0, height=1.5, shutters=True):
    """
    A window on the wall that faces a direction: a dark pane behind a deep surround, a stone sill and
    lintel, glazing bars, and louvred shutters folded back on each side.
    """
    fine, mid = detail == 0, detail <= 1
    glass = model.shape('glass')
    trim = model.shape('trim')
    paint = model.shape('paint')
    w = wall_at(origin[0], origin[1], origin[2], normal[0], normal[1])
    full = (normal[0], 0.0, normal[1])
    [hw, hh] = [width / 2, height / 2]
    glass.face(
        [w(-hw, -hh, 0.02), w(hw, -hh, 0.02), w(hw, hh, 0.02), w(-hw, hh, 0.02)], DARK, 1.0, full
    )
    if mid:
        # The deep surround stands proud of the wall, so the pane lies behind its face.
        depth = 0.2
        wall_box(trim, w, -hw - 0.1, -hw, -hh, hh, 0, depth, PALE)
        wall_box(trim, w, hw, hw + 0.1, -hh, hh, 0, depth, PALE)
        wall_box(trim, w, -hw - 0.12, hw + 0.12, hh, hh + 0.12, 0, depth + 0.03, PALE)
        if fine:
            wall_box(trim, w, -hw - 0.16, hw + 0.16, -hh - 0.12, -hh, 0, depth + 0.08, PALE)
            wall_box(paint, w, -0.025, 0.025, -hh, hh, 0, 0.06, PALE)
            wall_box(paint, w, -hw, hw, 0.1, 0.14, 0, 0.06, PALE)
    if not shutters:
        return
    for side in (-1, 1):
        [s0, s1] = [side * (hw + 0.1), side * (hw + 0.1 + width * 0.5)]
        [a0, a1] = (s0, s1) if side > 0 else (s1, s0)
        if fine:
            # Each shutter folds back flat, with a frame and louvres that catch the light in rows.
            wall_box(paint, w, a0, a1, -hh, hh, 0, 0.045, shutter)
            slats = max(3, int(height / 0.26))
            for k in range(slats):
                y = -hh + 0.04 + (k * (height - 0.08)) / slats
                paint.face(
                    [w(a0 + 0.03, y, 0.075), w(a1 - 0.03, y, 0.075),
                     w(a1 - 0.03, y + 0.065, 0.048), w(a0 + 0.03, y + 0.065, 0.048)],
                    tuple(c * 1.35 for c in shutter), 1.0, full,
                )
        else:
            paint.face(
                [w(a0, -hh, 0.05), w(a1, -hh, 0.05), w(a1, hh, 0.05), w(a0, hh, 0.05)],
                shutter, 1.0, full,
            )


def door(model, origin, normal, color, detail, arched=False, painted=False, width=1.2, height=2.25):
    """A door on the wall that faces a direction: panels, a stone surround, a lintel and a step."""
    fine, mid = detail == 0, detail <= 1
    wood = model.shape('paint' if painted else 'timber')
    trim = model.shape('trim')
    w = wall_at(origin[0], origin[1], origin[2], normal[0], normal[1])
    full = (normal[0], 0.0, normal[1])
    [hw, top] = [width / 2, height]
    wood.face([w(-hw, 0, 0.03), w(hw, 0, 0.03), w(hw, top, 0.03), w(-hw, top, 0.03)], color, 1.0, full)
    if fine:
        panel = tuple(c * 0.65 for c in color)
        for [u0, u1] in ((0.25, 1.0), (1.2, 2.0)):
            for side in (-1, 1):
                [a0, a1] = (-hw + 0.12, -0.07) if side < 0 else (0.07, hw - 0.12)
                wood.face(
                    [w(a0, u0, 0.045), w(a1, u0, 0.045), w(a1, u1, 0.045), w(a0, u1, 0.045)],
                    panel, 1.0, full,
                )
    if not mid:
        return
    depth = 0.24
    wall_box(trim, w, -hw - 0.2, -hw, 0, top, 0, depth, STONE)
    wall_box(trim, w, hw, hw + 0.2, 0, top, 0, depth, STONE)
    if arched and fine:
        steps = 7
        for k in range(steps):
            [a0, a1] = [(k / steps) * math.pi, ((k + 1) / steps) * math.pi]
            [r0, r1] = [hw, hw + 0.22]
            trim.face([
                w(math.cos(a1) * r0, top + math.sin(a1) * r0, depth),
                w(math.cos(a0) * r0, top + math.sin(a0) * r0, depth),
                w(math.cos(a0) * r1, top + math.sin(a0) * r1, depth),
                w(math.cos(a1) * r1, top + math.sin(a1) * r1, depth),
            ], STONE, 1.0, full)
            for a in (a0, a1):
                trim.face([
                    w(math.cos(a) * r0, top + math.sin(a) * r0, 0),
                    w(math.cos(a) * r0, top + math.sin(a) * r0, depth),
                    w(math.cos(a) * r1, top + math.sin(a) * r1, depth),
                    w(math.cos(a) * r1, top + math.sin(a) * r1, 0),
                ], STONE, 1.0, full)
    else:
        wall_box(trim, w, -hw - 0.24, hw + 0.24, top, top + 0.22, 0, depth + 0.03, STONE)
    wall_box(trim, w, -hw - 0.3, hw + 0.3, -0.25, 0.12, 0, 0.6, STONE)


def storeys(
    model, x0, z0, x1, z1, floors, detail, shutter, tint, wall_mat='render',
    ground_front=True, ground_sides=True, front_skip=(), top_cornice=True, spacing=2.9,
):
    """
    One block of a house: its walls, plinth, floor belts and cornice, and its windows on every side.
    `front_skip` names places across the front where a door or an arcade takes the wall's place.
    """
    walls = model.shape('walls', wall_mat)
    trim = model.shape('trim')
    top = floors * FLOOR
    # The walls reach well under the ground, so a house on a graded plot never stands on air, and
    # they stop inside the cornice, whose top alone closes a roof terrace, so no two faces meet there.
    walls.box(x0, -SKIRT, z0, x1, top - (0.08 if top_cornice else 0.0), z1, tint, WALL_TILE)
    trim.box(x0 - 0.07, -SKIRT, z0 - 0.07, x1 + 0.07, 0.32, z1 + 0.07, STONE, 1.2)
    if top_cornice:
        trim.box(x0 - 0.14, top - 0.24, z0 - 0.14, x1 + 0.14, top, z1 + 0.14, PALE, 1.2)
    for floor in range(1, floors):
        trim.box(x0 - 0.04, floor * FLOOR - 0.05, z0 - 0.04, x1 + 0.04,
                 floor * FLOOR + 0.05, z1 + 0.04, PALE, 1.2)

    def row(a0, a1, y, z, dz, skip):
        count = max(1, int((a1 - a0) / spacing))
        for k in range(count):
            at = a0 + ((k + 0.5) / count) * (a1 - a0)
            if any(abs(at - s) < 1.1 for s in skip):
                continue
            window(model, (at, y, z), (0, dz), shutter, detail)

    for floor in range(floors):
        y = floor * FLOOR + 1.7
        if (ground_front if floor == 0 else True):
            row(x0, x1, y, z1, 1, front_skip if floor == 0 else ())
        row(x0, x1, y, z0, -1, ())
        if ground_sides if floor == 0 else True:
            count = max(1, int((z1 - z0) / spacing))
            for k in range(count):
                at = z0 + ((k + 0.5) / count) * (z1 - z0)
                window(model, (x1, y, at), (1, 0), shutter, detail)
                window(model, (x0, y, at), (-1, 0), shutter, detail)


def hip_roof(model, x0, z0, x1, z1, y, detail, pitch=0.42, overhang=0.6):
    """A hip roof over a block, with deep eaves on rafters, ridge and hip tiles."""
    fine = detail == 0
    roof = model.shape('roof')
    trim = model.shape('trim')
    timber = model.shape('timber')
    e = overhang
    [ax, bx, az, bz] = [x0 - e, x1 + e, z0 - e, z1 + e]
    inset = min(bx - ax, bz - az) / 2
    top = y + inset * pitch
    long = bx - ax >= bz - az
    if long:
        [p0, p1] = [[ax + inset, top, (az + bz) / 2], [bx - inset, top, (az + bz) / 2]]
    else:
        [p0, p1] = [[(ax + bx) / 2, top, az + inset], [(ax + bx) / 2, top, bz - inset]]
    if long:
        roof.roof_plane([(ax, y, bz), (bx, y, bz), p1, p0], WHITE, ROOF_TILE)
        roof.roof_plane([(bx, y, az), (ax, y, az), p0, p1], WHITE, ROOF_TILE)
        roof.roof_plane([(bx, y, bz), (bx, y, az), p1], WHITE, ROOF_TILE)
        roof.roof_plane([(ax, y, az), (ax, y, bz), p0], WHITE, ROOF_TILE)
    else:
        roof.roof_plane([(bx, y, bz), (bx, y, az), p0, p1], WHITE, ROOF_TILE)
        roof.roof_plane([(ax, y, az), (ax, y, bz), p1, p0], WHITE, ROOF_TILE)
        roof.roof_plane([(ax, y, bz), (bx, y, bz), p1], WHITE, ROOF_TILE)
        roof.roof_plane([(bx, y, az), (ax, y, az), p0], WHITE, ROOF_TILE)
    roof.box(
        min(p0[0], p1[0]) - 0.07, top - 0.03, min(p0[2], p1[2]) - 0.07,
        max(p0[0], p1[0]) + 0.07, top + 0.09, max(p0[2], p1[2]) + 0.07, CAP, 0.7,
    )

    def cap(a, c):
        [nx, nz] = [0.07, 0.07]
        roof.face([
            (a[0] - nx, a[1] + 0.03, a[2] + nz), (a[0] + nx, a[1] + 0.03, a[2] - nz),
            (c[0] + nx, c[1] + 0.03, c[2] - nz), (c[0] - nx, c[1] + 0.03, c[2] + nz),
        ], CAP, 0.6, (0, 1, 0))

    cap([ax, y, az], p0)
    cap([bx, y, bz], p1)
    cap([ax, y, bz] if long else [bx, y, az], p0)
    cap([bx, y, az] if long else [ax, y, bz], p1)
    # The soffit under the eaves, and the timber fascia along the two long edges.
    trim.face([(ax, y - 0.02, az), (bx, y - 0.02, az), (bx, y - 0.02, bz), (ax, y - 0.02, bz)],
              PALE, 1.2, (0, -1, 0))
    timber.box(ax, y - 0.2, bz - 0.06, bx, y - 0.02, bz, WHITE, 0.8)
    timber.box(ax, y - 0.2, az, bx, y - 0.02, az + 0.06, WHITE, 0.8)
    if not fine:
        return
    # The rafter ends along the front eave, one every so often, which shadow the wall below.
    count = max(2, int((bx - ax) / 1.15))
    for k in range(1, count):
        at = ax + ((k + 0.5) / count) * (bx - ax)
        timber.box(at - 0.045, y - 0.16, bz - 0.02, at + 0.045, y - 0.01, bz + 0.16, WHITE, 0.5)


def chimney(trim, x, z, y0, y1, detail):
    """A chimney of painted stone with a cap and a terracotta pot."""
    trim.box(x - 0.32, y0, z - 0.32, x + 0.32, y1, z + 0.32, PALE, 1.2)
    trim.box(x - 0.42, y1, z - 0.42, x + 0.42, y1 + 0.1, z + 0.42, STONE, 1.0)
    if detail <= 1:
        trim.revolve(x, z, [(y1 + 0.1, 0.13), (y1 + 0.42, 0.11)], 8, TERRACOTTA, 0.5, cap_top=True)


def parapet(geo, x0, z0, x1, z1, y, height=0.9, color=WHITE, thickness=0.18):
    """A low wall around a roof terrace."""
    geo.box(x0, y, z1 - thickness, x1, y + height, z1, color, 1.2)
    geo.box(x0, y, z0, x1, y + height, z0 + thickness, color, 1.2)
    geo.box(x1 - thickness, y, z0, x1, y + height, z1, color, 1.2)
    geo.box(x0, y, z0, x0 + thickness, y + height, z1, color, 1.2)


def vine_card(cards, cx, cy, cz, half_w, half_h, facing, seed, tint):
    """
    A cutout ivy card at a point: a folded quad that faces `facing`, its middle pushed out a little
    so the leaves shade as a soft mass. The atlas cell is picked by the seed.
    """
    [fx, fz] = facing
    [ax, az] = [-fz, fx]
    [u0, v0] = [(seed % 2) * 0.5, ((seed // 2) % 2) * 0.5]
    out = 0.2 * half_w

    def at(across, up, lift=0.0):
        return (cx + ax * across + fx * lift, cy + up, cz + az * across + fz * lift)

    [bl, br, tl, tr] = [at(-half_w, -half_h), at(half_w, -half_h), at(-half_w, half_h), at(half_w, half_h)]
    [bm, tm] = [at(0, -half_h, out), at(0, half_h, out)]
    full = (fx, 0, fz)
    cards.face([bl, bm, tm, tl], tint, 1.0, full, [(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])
    cards.face([bm, br, tr, tm], tint, 1.0, full, [(u0 + 0.25, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0 + 0.25, v0 + 0.5)])


def vine_row(model, x0, x1, y0, y1, z, count, seed, size, flower=True, detail=0):
    """Leaf cards hanging along a beam or a rail, facing +z, thinning with distance."""
    count = count if detail == 0 else max(1, count // 3) if detail == 1 else 1
    cards = model.shape('vine')
    rng = np.random.default_rng(seed)
    for k in range(count):
        x = x0 + ((k + 0.5) / count) * (x1 - x0)
        y = y0 + rng.random() * (y1 - y0)
        s = size * (0.7 + 0.5 * rng.random())
        tint = BLOOM if flower and rng.random() < 0.2 else (BLOOM_PALE if flower and rng.random() < 0.3 else LEAF)
        vine_card(cards, x, y, z, s, s, (0, 1), seed + k, tint)


def vine_top(model, x0, x1, z0, z1, y, count, seed, size, flower=True, detail=0):
    """Leaf cards lying over a pergola's top, facing up, thinning with distance."""
    count = count if detail == 0 else max(1, count // 3) if detail == 1 else 1
    cards = model.shape('vine')
    rng = np.random.default_rng(seed)
    for k in range(count):
        x = x0 + rng.random() * (x1 - x0)
        z = z0 + rng.random() * (z1 - z0)
        s = size * (0.7 + 0.5 * rng.random())
        tint = BLOOM if flower and rng.random() < 0.22 else (BLOOM_PALE if flower and rng.random() < 0.3 else LEAF)
        vine_card(cards, x, y + rng.random() * 0.12, z, s, s, (0, -1), seed + k, tint)


def vine_pot(model, x, y, z, radius, height, count, seed, size, flower=False, detail=0):
    """Leaf cards standing out of a pot, each facing a direction of its own, thinning with distance."""
    count = count if detail == 0 else max(1, count // 2)
    cards = model.shape('vine')
    rng = np.random.default_rng(seed)
    for k in range(count):
        a = math.tau * (k / count) + rng.random() * 0.4
        [dx, dz] = [math.sin(a), math.cos(a)]
        s = size * (0.7 + 0.5 * rng.random())
        tint = BLOOM if flower and rng.random() < 0.28 else LEAF
        vine_card(cards, x + dx * radius * 0.5, y + rng.random() * height, z + dz * radius * 0.5,
                  s, s, (dx, dz), seed + k, tint)


def pergola(model, x0, x1, z0, z1, y, detail, height=2.4, seed=1, flower=True):
    """A timber pergola over a terrace, with climbing leaves and flowers on it."""
    fine, mid = detail == 0, detail <= 1
    timber = model.shape('timber')
    for x in (x0, x1 - 0.14):
        for z in (z0, z1 - 0.14):
            timber.box(x, y, z, x + 0.14, y + height, z + 0.14, WHITE, 0.7)
    timber.box(x0, y + height, z0, x0 + 0.14, y + height + 0.14, z1, WHITE, 0.8)
    timber.box(x1 - 0.14, y + height, z0, x1, y + height + 0.14, z1, WHITE, 0.8)
    if detail <= 1:
        x = x0
        while x <= x1:
            timber.box(x, y + height + 0.14, z0 - 0.2, x + 0.08, y + height + 0.22, z1 + 0.2, WHITE, 0.6)
            x += 0.8
    else:
        # The far form closes the rafters' top with one plane, so the pergola keeps its dark roof.
        timber.face([(x0, y + height + 0.22, z0 - 0.2), (x1, y + height + 0.22, z0 - 0.2),
                     (x1, y + height + 0.22, z1 + 0.2), (x0, y + height + 0.22, z1 + 0.2)],
                    WHITE, 1.0, (0, 1, 0))
    vine_top(model, x0 + 0.2, x1 - 0.2, z0 - 0.1, z1 + 0.1, y + height + 0.24, 14, seed, 0.3, flower, detail)


def arcade(model, x0, x1, z, height, bays, detail):
    """A row of stone arches on a front: piers, curved spandrels and dark openings behind."""
    fine, mid = detail == 0, detail <= 1
    trim = model.shape('trim')
    glass = model.shape('glass')
    width = (x1 - x0) / bays
    glass.face([(x0, 0.1, z + 0.02), (x1, 0.1, z + 0.02), (x1, height, z + 0.02),
                (x0, height, z + 0.02)], SHADE, 1.0, (0, 0, 1))
    if not mid:
        for k in range(bays + 1):
            x = x0 + k * width
            trim.box(x - 0.22, 0, z, x + 0.22, height, z + 0.5, STONE, 1.0)
        trim.box(x0 - 0.22, height - 0.28, z, x1 + 0.22, height + 0.12, z + 0.55, STONE, 1.1)
        return
    for k in range(bays + 1):
        x = x0 + k * width
        trim.box(x - 0.22, 0, z, x + 0.22, height, z + 0.5, STONE, 1.0)
        trim.box(x - 0.3, height - 1.1, z, x + 0.3, height - 0.98, z + 0.57, PALE, 0.9)
    trim.box(x0 - 0.22, height - 0.28, z, x1 + 0.22, height + 0.12, z + 0.55, STONE, 1.1)
    steps = 6 if fine else 2
    for k in range(bays):
        [mid_x, r] = [x0 + (k + 0.5) * width, width / 2 - 0.22]
        for s in range(steps):
            [a0, a1] = [(s / steps) * math.pi, ((s + 1) / steps) * math.pi]
            base = height - 1.02
            [xa, xb] = [mid_x + math.cos(a0) * r, mid_x + math.cos(a1) * r]
            [ya, yb] = [base + math.sin(a0) * min(r, 0.8), base + math.sin(a1) * min(r, 0.8)]
            trim.face([(xb, yb, z + 0.5), (xa, ya, z + 0.5), (xa, height - 0.28, z + 0.5),
                       (xb, height - 0.28, z + 0.5)], STONE, 1.0, (0, 0, 1))


def balcony(model, x0, x1, y, z, detail):
    """A balcony with an iron rail and a flower box, on the wall that faces +z."""
    fine, mid = detail == 0, detail <= 1
    trim = model.shape('trim')
    paint = model.shape('paint')
    trim.box(x0, y - 0.13, z, x1, y, z + 1.0, STONE, 1.0, bottom=True)
    if not mid:
        paint.face([(x0, y, z + 0.97), (x1, y, z + 0.97), (x1, y + 0.9, z + 0.97),
                    (x0, y + 0.9, z + 0.97)], IRON, 1.0, (0, 0, 1))
        return
    for x in (x0 + 0.1, x1 - 0.25):
        trim.box(x, y - 0.4, z, x + 0.14, y - 0.13, z + 0.76, STONE, 0.8)
    paint.box(x0, y + 0.9, z + 0.95, x1, y + 0.95, z + 1.0, IRON, 0.5)
    if fine:
        x = x0
        while x <= x1 + 0.01:
            paint.box(x, y, z + 0.96, x + 0.025, y + 0.9, z + 0.98, IRON, 0.4)
            x += 0.24
        for side in (x0, x1 - 0.03):
            paint.box(side, y + 0.9, z, side + 0.03, y + 0.95, z + 0.96, IRON, 0.4)
    else:
        paint.face([(x0, y, z + 0.97), (x1, y, z + 0.97), (x1, y + 0.9, z + 0.97),
                    (x0, y + 0.9, z + 0.97)], IRON, 1.0, (0, 0, 1))
    # The flower box hangs on the rail, and its plants spill over it.
    paint.box(x0 + 0.3, y + 0.95, z + 0.88, x1 - 0.3, y + 1.08, z + 1.06, TERRACOTTA, 0.7)
    vine_row(model, x0 + 0.3, x1 - 0.3, y + 1.05, y + 1.32, z + 1.05, 7, 17, 0.42, True, detail)


def awning(model, x0, x1, z, y, detail):
    """A striped canvas awning over a shop front, with a hanging valance."""
    paint = model.shape('paint')
    if detail > 1:
        paint.face([(x0, y + 0.55, z + 1.5), (x1, y + 0.55, z + 1.5), (x1, y + 1.2, z),
                    (x0, y + 1.2, z)], (0.85, 0.6, 0.5), 0.8, (0, 1, 0))
        return
    stripes = max(4, int((x1 - x0) / 0.7))
    for k in range(stripes):
        a = x0 + (k / stripes) * (x1 - x0)
        b = x0 + ((k + 1) / stripes) * (x1 - x0)
        tint = (0.72, 0.24, 0.16) if k % 2 else (0.95, 0.92, 0.86)
        paint.face([(a, y + 0.55, z + 1.5), (b, y + 0.55, z + 1.5), (b, y + 1.2, z),
                    (a, y + 1.2, z)], tint, 0.8, (0, 1, 0))
        paint.face([(a, y + 0.35, z + 1.5), (b, y + 0.35, z + 1.5), (b, y + 0.55, z + 1.5),
                    (a, y + 0.55, z + 1.5)], tint, 0.8, (0, 0, 1))


def pot(model, x, y, z, detail, size=0.32, flower=False):
    """A round terracotta pot with a leafy plant in it, at a place on the ground."""
    paint = model.shape('paint')
    paint.revolve(x, z, [(y, size * 0.62), (y + size * 1.1, size * 0.95), (y + size * 1.25, size * 1.02)],
                  8, TERRACOTTA, 0.5, cap_top=True)
    if detail <= 1:
        seed = int(abs(x) * 31 + abs(z) * 7)
        vine_pot(model, x, y + size * 1.2, z, size, size * 2.2, 7, seed, size * 0.55, flower, detail)


# ---------------------------------------------------------------------------------------------
# The thirteen house forms, in the order that the town plan's house kinds number them
# ---------------------------------------------------------------------------------------------


def house_farm(model, detail):
    """A country farmhouse of bare stone: one floor, a plain door, a chimney and two pots."""
    ceiling = 1 * FLOOR
    storeys(model, -5.5, -3.8, 5.5, 3.8, 1, detail, GREEN, WHITE, wall_mat='stone',
            front_skip=(0.0,))
    door(model, (0, 0, 3.8), (0, 1), DOOR_GREEN, detail, painted=True)
    hip_roof(model, -5.5, -3.8, 5.5, 3.8, ceiling, detail)
    chimney(model.shape('trim'), 2.6, -1, ceiling, ceiling + 2.1, detail)
    pot(model, -1.5, 0, 4.3, detail)
    pot(model, 1.5, 0, 4.3, detail, flower=True)


def house_villa(model, detail):
    """A country villa of two floors: a wide balcony over the door, a chimney and a hip roof."""
    ceiling = 2 * FLOOR
    storeys(model, -6, -4.2, 6, 4.2, 2, detail, TEAL, CREAM, front_skip=(-2.0,))
    door(model, (-2, 0, 4.2), (0, 1), WHITE, detail)
    balcony(model, -3.2, 3.2, FLOOR, 4.2, detail)
    hip_roof(model, -6, -4.2, 6, 4.2, ceiling, detail)
    chimney(model.shape('trim'), -3, -1.5, ceiling, ceiling + 2.3, detail)


def house_wing(model, detail):
    """An L-shaped country house: a tall block, a low wing, an arched door and an outside stair."""
    fine, mid = detail == 0, detail <= 1
    ceiling = 2 * FLOOR
    storeys(model, -5.5, -4, 1.5, 4, 2, detail, GREEN, WHITE, front_skip=(-2.0,))
    storeys(model, 1.5, -4, 6.5, 0.8, 1, detail, GREEN, WHITE, ground_front=False)
    door(model, (-2, 0, 4), (0, 1), DOOR_GREEN, detail, arched=True, painted=True)
    hip_roof(model, -5.5, -4, 1.5, 4, ceiling, detail)
    hip_roof(model, 1.5, -4, 6.5, 0.8, FLOOR, detail)
    # A stone stair climbs the side from the ground to the upper floor.
    steps = 8 if detail <= 1 else 4
    stone = model.shape('trim')
    for k in range(steps):
        x = 1.6 + (steps - 1 - k) * (3.5 / (steps - 1))
        stone.box(x, -0.3, 0.9, x + 3.5 / (steps - 1) + 0.02, FLOOR * (k + 1) / steps, 1.95, STONE, 0.9)
    pergola(model, 2.0, 6.2, 1.0, 3.9, 0.0, detail, 2.3, 5)
    chimney(model.shape('trim'), -3, -1, ceiling, ceiling + 2.0, detail)


def house_terrace(model, detail):
    """A country house with a roof terrace: a parapet, a top room and a pergola over the roof."""
    fine, mid = detail == 0, detail <= 1
    ceiling = 2 * FLOOR
    storeys(model, -5, -3.8, 5, 3.8, 2, detail, BLUE, ROSE, front_skip=(1.0,), top_cornice=False)
    door(model, (1, 0, 3.8), (0, 1), WHITE, detail)
    parapet(model.shape('walls'), -5, -3.8, 5, 3.8, ceiling, 0.9)
    model.shape('walls').box(-4.4, ceiling, -3.2, -1.2, ceiling + 2.3, -0.2, ROSE, WALL_TILE)
    window(model, (-2.8, ceiling + 1.5, -0.2), (0, 1), BLUE, detail)
    hip_roof(model, -4.4, -3.2, -1.2, -0.2, ceiling + 2.3, detail, 0.3)
    pergola(model, 0.2, 4.4, -2.8, 3.0, ceiling, detail, 2.2, 9)
    pot(model, -3.8, ceiling, 2.9, detail, 0.28, True)


def house_arcade(model, detail):
    """A long country villa with an arcade across its front and two chimneys."""
    ceiling = 2 * FLOOR
    storeys(model, -7.5, -4, 7.5, 3.6, 2, detail, TEAL, WHITE, ground_front=False)
    arcade(model, -6.8, 3.2, 3.6, FLOOR - 0.15, 4, detail)
    door(model, (5.2, 0, 3.6), (0, 1), WHITE, detail, arched=True)
    hip_roof(model, -7.5, -4, 7.5, 3.6, ceiling, detail)
    trim = model.shape('trim')
    chimney(trim, 4.5, -1.8, ceiling, ceiling + 2.2, detail)
    chimney(trim, -4.5, -1.8, ceiling, ceiling + 2.2, detail)
    pot(model, -1.5, 0, 4.6, detail, 0.36, True)


def house_veranda(model, detail):
    """A stone country house with a veranda on posts, its roof of its own and vines over it."""
    fine, mid = detail == 0, detail <= 1
    ceiling = 2 * FLOOR
    storeys(model, -5.6, -4, 5.6, 4, 2, detail, TEAL, WHITE, wall_mat='stone',
            ground_front=False, top_cornice=False)
    door(model, (0, 0, 4), (0, 1), WHITE, detail)
    if detail <= 1:
        window(model, (-3.2, 1.6, 4), (0, 1), TEAL, detail)
        window(model, (3.2, 1.6, 4), (0, 1), TEAL, detail)
    timber = model.shape('timber')
    trim = model.shape('trim')
    roof = model.shape('roof')
    posts = (-5.4, -1.8, 1.8, 5.4) if mid else (-5.4, 5.4)
    for x in posts:
        timber.box(x - 0.1, 0, 6.3, x + 0.1, FLOOR - 0.2, 6.5, WHITE, 0.9)
    trim.box(-5.6, 0, 4, 5.6, 0.14, 6.6, STONE, 1.0)
    timber.box(-5.6, FLOOR - 0.26, 6.3, 5.6, FLOOR - 0.14, 6.5, WHITE, 0.8)
    roof.roof_plane([(-5.8, FLOOR - 0.14, 6.8), (5.8, FLOOR - 0.14, 6.8),
                     (5.8, FLOOR + 0.45, 4), (-5.8, FLOOR + 0.45, 4)], WHITE, ROOF_TILE)
    if mid:
        vine_row(model, -5.4, 5.4, FLOOR - 0.24, FLOOR + 0.08, 6.56, 13, 23, 0.26, True, detail)
    hip_roof(model, -5.6, -4, 5.6, 4, ceiling, detail)
    chimney(model.shape('trim'), -2.5, -1.2, ceiling, ceiling + 2.2, detail)


def house_courtyard(model, detail):
    """A country house of two wings around a court: an arched door, a balcony and two pots."""
    ceiling = 2 * FLOOR
    storeys(model, -6.5, -4, 6.5, 1.5, 2, detail, TEAL, OCHRE, front_skip=(0.0,))
    storeys(model, -6.5, 1.5, -2.5, 5, 1, detail, TEAL, OCHRE, ground_front=False)
    storeys(model, 2.5, 1.5, 6.5, 5, 1, detail, TEAL, OCHRE, ground_front=False)
    door(model, (0, 0, 1.5), (0, 1), WHITE, detail, arched=True)
    hip_roof(model, -6.5, -4, 6.5, 1.5, ceiling, detail)
    hip_roof(model, -6.5, 1.5, -2.5, 5, FLOOR, detail)
    hip_roof(model, 2.5, 1.5, 6.5, 5, FLOOR, detail)
    balcony(model, -2.2, 2.2, FLOOR, 1.5, detail)
    chimney(model.shape('trim'), 0, -2, ceiling, ceiling + 2.4, detail)
    pot(model, -1.5, 0, 3.5, detail, 0.4, True)
    pot(model, 1.5, 0, 3.5, detail, 0.4)


def house_balcony(model, detail):
    """A town house of two floors with a balcony over the street and a chimney."""
    ceiling = 2 * FLOOR
    storeys(model, -5, -4, 5, 4, 2, detail, TEAL, WHITE, ground_front=False)
    door(model, (-1.8, 0, 4), (0, 1), WHITE, detail)
    window(model, (2, 1.6, 4), (0, 1), TEAL, detail)
    balcony(model, -3, 3, FLOOR, 4, detail)
    hip_roof(model, -5, -4, 5, 4, ceiling, detail)
    chimney(model.shape('trim'), 2, -2, ceiling, ceiling + 2.0, detail)


def house_shop(model, detail):
    """A town shop under flats: a wide glazed front, a door and a striped awning."""
    fine, mid = detail == 0, detail <= 1
    ceiling = 2 * FLOOR
    storeys(model, -4.5, -4, 4.5, 4, 2, detail, BLUE, WHITE, ground_front=False)
    if mid:
        model.shape('glass').face(
            [(-4, 0.5, 4.03), (0.8, 0.5, 4.03), (0.8, 2.5, 4.03), (-4, 2.5, 4.03)], DARK, 1.0, (0, 0, 1)
        )
        if fine:
            trim = model.shape('trim')
            timber = model.shape('timber')
            trim.box(-4.08, 0, 4, 0.9, 0.5, 4.12, STONE, 0.9)
            trim.box(-4.08, 2.5, 4, 0.9, 2.62, 4.12, STONE, 0.9)
            trim.box(-4.08, 0.5, 4, -3.92, 2.5, 4.13, STONE, 0.9)
            trim.box(0.74, 0.5, 4, 0.9, 2.5, 4.13, STONE, 0.9)
            for x in (-2.45, -0.85):
                timber.box(x - 0.04, 0.5, 4.02, x + 0.04, 2.5, 4.1, WHITE, 0.5)
    door(model, (2.6, 0, 4), (0, 1), WHITE, detail)
    awning(model, -4.4, 4.4, 4, 2.3, detail)
    hip_roof(model, -4.5, -4, 4.5, 4, ceiling, detail)


def house_loggia(model, detail):
    """A town house of two floors with a loggia of four arches across its front."""
    ceiling = 2 * FLOOR
    storeys(model, -5.5, -4.2, 5.5, 4.2, 2, detail, GREEN, CREAM, ground_front=False)
    arcade(model, -4.8, 4.8, 4.2, FLOOR - 0.15, 4, detail)
    hip_roof(model, -5.5, -4.2, 5.5, 4.2, ceiling, detail)
    chimney(model.shape('trim'), -3, -2, ceiling, ceiling + 2.0, detail)


def house_block(model, detail):
    """A town block of bare stone, three floors: an arched door and a balcony over it."""
    ceiling = 3 * FLOOR
    storeys(model, -5, -4.4, 5, 4.4, 3, detail, TEAL, WHITE, wall_mat='stone',
            ground_front=False, ground_sides=False)
    door(model, (0, 0, 4.4), (0, 1), WHITE, detail, arched=True)
    window(model, (-3, 1.6, 4.4), (0, 1), TEAL, detail)
    window(model, (3, 1.6, 4.4), (0, 1), TEAL, detail)
    balcony(model, -3.4, 3.4, 2 * FLOOR, 4.4, detail)
    hip_roof(model, -5, -4.4, 5, 4.4, ceiling, detail)
    chimney(model.shape('trim'), -2.5, -2, ceiling, ceiling + 2.0, detail)


def house_cottage(model, detail):
    """A low town cottage of bare stone, one floor, a plain door and a pot by the wall."""
    ceiling = 1 * FLOOR
    storeys(model, -4.6, -3.6, 4.6, 3.6, 1, detail, GREEN, WHITE, wall_mat='stone', front_skip=(0.0,))
    door(model, (0, 0, 3.6), (0, 1), DOOR_GREEN, detail, painted=True)
    hip_roof(model, -4.6, -3.6, 4.6, 3.6, ceiling, detail, 0.46)
    pot(model, 1.8, 0, 4.1, detail, 0.28, True)


def house_roof_terrace(model, detail):
    """A town house with a roof terrace: a parapet, a top room and a pergola over the roof."""
    ceiling = 2 * FLOOR
    storeys(model, -4.4, -4, 4.4, 4, 2, detail, GREEN, WHITE, ground_front=False, top_cornice=False)
    door(model, (-1.4, 0, 4), (0, 1), WHITE, detail)
    window(model, (1.8, 1.6, 4), (0, 1), GREEN, detail)
    parapet(model.shape('walls'), -4.4, -4, 4.4, 4, ceiling, 0.8)
    model.shape('walls').box(-3.8, ceiling, -3.4, -0.6, ceiling + 2.3, -0.6, WHITE, WALL_TILE)
    window(model, (-2.2, ceiling + 1.5, -0.6), (0, 1), GREEN, detail)
    hip_roof(model, -3.8, -3.4, -0.6, -0.6, ceiling + 2.3, detail, 0.3)
    pergola(model, 0.3, 3.8, 0.0, 3.4, ceiling, detail, 2.2, 13)
    pot(model, 3.6, ceiling, -3.3, detail, 0.25, True)


FORMS = (
    ('farm', house_farm),
    ('villa', house_villa),
    ('wing', house_wing),
    ('terrace', house_terrace),
    ('arcade', house_arcade),
    ('veranda', house_veranda),
    ('courtyard', house_courtyard),
    ('balcony', house_balcony),
    ('shop', house_shop),
    ('loggia', house_loggia),
    ('block', house_block),
    ('cottage', house_cottage),
    ('roof-terrace', house_roof_terrace),
)


class Model:
    """The parts of one house form, each a Geo of one shared material."""

    def __init__(self, mats):
        self.mats = mats
        self.parts = {}
        self.material_of = {}

    def shape(self, part, material_name=None):
        self.material_of.setdefault(part, material_name or part)
        return self.parts.setdefault(part, Geo())

    def objects(self, name, level=None):
        suffix = '' if level is None else f'-{level}'
        made = []
        for part, geo in self.parts.items():
            if not geo.builder.faces:
                continue
            for face in geo.builder.faces:
                if any(not isinstance(index, int) for index in face):
                    raise SystemExit(f'{name}-{part}{suffix} has a face with a non-integer: {face}')
            heights = [p[2] for p in geo.builder.positions]
            if heights and (min(heights) < -1.3 or max(heights) > 12.5):
                print(f'ISLAND-HOUSES note: {name}-{part}{suffix} spans {min(heights):.2f} to '
                      f'{max(heights):.2f} m, past what a house takes')
            try:
                made.append(geo.builder.build(f'{name}-{part}{suffix}', self.mats[self.material_of[part]]))
            except Exception as error:
                raise SystemExit(
                    f'{name}-{part}{suffix}: {error} '
                    f'({len(geo.builder.positions)} vertices, {len(geo.builder.faces)} faces)'
                ) from error
        return made


def build(mats, form, make):
    """A form's objects at every level, the nearest one first."""
    levels = []
    for level, detail in ((None, 0), (1, 1), (2, 2)):
        model = Model(mats)
        make(model, detail)
        levels.append(model.objects(f'house-{form}', level))
    return levels


# ---------------------------------------------------------------------------------------------
# The measured error of each lower level
# ---------------------------------------------------------------------------------------------


def _triangles_of(obj):
    """A built object's faces as triangles, each a row of three corners."""
    mesh = obj.data
    points = [tuple(v.co) for v in mesh.vertices]
    made = []
    for poly in mesh.polygons:
        ids = list(poly.vertices)
        for k in range(1, len(ids) - 1):
            made.append([points[ids[0]], points[ids[k]], points[ids[k + 1]]])
    return np.array(made, np.float64) if made else np.zeros((0, 3, 3))


def _segment_distance(p, a, b):
    """The squared distance from each point to a segment."""
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
    q = a + t[:, None] * ab
    return ((p - q) ** 2).sum(axis=1)


def _triangle_distance(p, a, b, c):
    """The squared distance from each point to one triangle."""
    best = np.minimum(
        np.minimum(_segment_distance(p, a, b), _segment_distance(p, b, c)),
        _segment_distance(p, c, a),
    )
    n = np.cross(b - a, c - a)
    n2 = float(n @ n)
    if n2 <= 1e-12:
        return best
    normal = n / math.sqrt(n2)
    height = (p - a) @ normal
    # The point on the plane is inside the triangle when its barycentric weights are all positive.
    q = p - height[:, None] * normal
    v0, v1 = b - a, c - a
    d00, d01, d11 = float(v0 @ v0), float(v0 @ v1), float(v1 @ v1)
    d20, d21 = (q - a) @ v0, (q - a) @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) <= 1e-12:
        return best
    u = (d11 * d20 - d01 * d21) / den
    v = (d00 * d21 - d01 * d20) / den
    inside = (u >= 0) & (v >= 0) & (u + v <= 1)
    return np.where(inside, height * height, best)


def _furthest(objects, surface, limit=200):
    """The worst distance from the given objects' vertices to a surface, and the object that sets it."""
    worst, where = 0.0, ''
    for obj in objects:
        triangles = _triangles_of(obj)
        if len(triangles) == 0:
            continue
        points = np.unique(triangles.reshape(-1, 3), axis=0)
        if len(points) > limit:
            points = points[np.linspace(0, len(points) - 1, limit).astype(int)]
        best = np.full(len(points), np.inf)
        for [a, b, c] in surface:
            best = np.minimum(best, _triangle_distance(points, a, b, c))
        error = float(np.sqrt(best.max()))
        if error > worst:
            worst, where = error, obj.name
    return worst, where


def measured_error(fine, coarse):
    """
    The greatest distance in either direction between the two levels' surfaces, in meters, and the
    part that sets it. The leaf cards thin out on their own, so the house's fabric is what is judged.
    """
    high = [o for o in fine if '-vine' not in o.name]
    low = [o for o in coarse if '-vine' not in o.name]
    high_surface = np.concatenate([_triangles_of(o) for o in high])
    low_surface = np.concatenate([_triangles_of(o) for o in low])
    up = _furthest(high, low_surface)
    down = _furthest(low, high_surface)
    return up if up[0] >= down[0] else down


def measure(levels, form):
    """Each lower level's worst measured surface error against the nearest level, in meters."""
    errors = []
    for index in (1, 2):
        error, where = measured_error(levels[0], levels[index])
        print(f'ISLAND-HOUSES {form}: level {index} measured error {error:.3f} m at {where}')
        errors.append(error)
    return errors


# ---------------------------------------------------------------------------------------------
# The preview pictures
# ---------------------------------------------------------------------------------------------


def bounds(objects):
    """A group's lowest and highest corners, in the scene's coordinates."""
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    return ((min(p.x for p in points), min(p.z for p in points), -max(p.y for p in points)),
            (max(p.x for p in points), max(p.z for p in points), -min(p.y for p in points)))


def centre(objects):
    low, high = bounds(objects)
    return tuple((low[i] + high[i]) / 2 for i in range(3))


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def direction_to_blender(d):
    return Vector((d[0], -d[2], d[1]))


def frame_shot(objects, path, direction, distance, target=None, size=(900, 700), lens=45, samples=24):
    """Renders the objects from `distance` meters along `direction`, aimed at their middle."""
    cam, _, _ = stage(objects, SKY, size, samples)
    aim = to_blender(target) if target else to_blender(centre(objects))
    d = direction_to_blender(direction).normalized()
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'AUTO'
    cam.data.lens = lens
    cam.location = aim + d * distance
    cam.rotation_euler = (aim - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def spread(groups, gap=4.0):
    """Lays groups side by side along x, centred on the origin, adding to each one's place."""
    spans = [(bounds(group)[0][0], bounds(group)[1][0]) for group in groups]
    x = -(sum(high - low for low, high in spans) + gap * (len(groups) - 1)) / 2
    for group, (low, high) in zip(groups, spans):
        for o in group:
            o.location.x += x - low
        x += high - low + gap
    bpy.context.view_layer.update()


def reset(groups):
    for group in groups:
        for o in group:
            o.location.x = 0
    bpy.context.view_layer.update()


def shoot(near, shots):
    """The preview pictures: each form, a street front, a row at gameplay range and a lineup."""
    for form, objects in near.items():
        width = bounds(objects)[1][0] - bounds(objects)[0][0]
        middle = centre(objects)
        frame_shot(objects, os.path.join(shots, f'{form}.png'), (-0.6, 0.42, 0.68),
                   max(14.0, 3.4 * width), target=(middle[0], 3.0, middle[2]), size=(760, 560))
    # A close street-level front for the town's common forms, the camera at eye height 9 m back.
    for form in ('balcony', 'shop', 'loggia', 'roof-terrace', 'block', 'courtyard'):
        objects = near[form]
        low, high = bounds(objects)
        frame_shot(objects, os.path.join(shots, f'{form}-front.png'), (0.06, 0.1, 1.0), 9.5,
                   target=((low[0] + high[0]) / 2, 2.2, high[2]), size=(860, 620), lens=40)
    # A row at the range a visitor meets it while walking a street, and from across a village.
    at_distance([near[form] for form in ('balcony', 'loggia', 'roof-terrace')],
                os.path.join(shots, 'row-walking.png'), 24, 1.4)
    at_distance([near[form] for form in ('balcony', 'loggia', 'roof-terrace', 'shop', 'block')],
                os.path.join(shots, 'row-village.png'), 90, 1.4)
    # Every form side by side at its true size, and the same row from a village's distance.
    groups = [near[form] for form, _ in FORMS]
    spread(groups, 3.0)
    flat = [o for group in groups for o in group]
    frame_shot(flat, os.path.join(shots, 'lineup.png'), (-0.45, 0.34, 0.82), 74,
               target=(0, 4.0, 0), size=(1400, 620))
    frame_shot(flat, os.path.join(shots, 'lineup-far.png'), (-0.3, 0.26, 0.92), 220,
               target=(0, 4.0, 0), size=(1200, 420))
    reset(groups)


def main():
    out, shots = arguments('island-houses.py')
    rng = np.random.default_rng(SEED)
    mats = make_materials(rng)
    everything, near, levels_by_form = [], {}, {}
    for form, make in FORMS:
        levels = build(mats, form, make)
        near[form] = levels[0]
        levels_by_form[form] = levels
        everything += [o for level in levels for o in level]
    # The measured error of each lower level, from the nearest level's surface, sets where a view
    # switches to it. Round up, so the file never claims a level closer than it draws.
    errors = [0.0, 0.0]
    for form, levels in levels_by_form.items():
        measured = measure(levels, form)
        errors = [max(a, b) for a, b in zip(errors, measured)]
    errors = [math.ceil(value * 20) / 20 for value in errors]
    print(f'ISLAND-HOUSES level errors: {errors[0]:.2f} m, {errors[1]:.2f} m')
    report = export(os.path.join(out, 'houses.glb'), everything, {'houses-vine'}, errors)
    for form, _ in FORMS:
        parts = sorted(k for k in report if k.startswith(f'house-{form}-'))
        print(f'ISLAND-HOUSES {form}: ' + ', '.join(f'{k} {report[k]}' for k in parts))
    size = os.path.getsize(os.path.join(out, 'houses.glb'))
    print(f'ISLAND-HOUSES houses.glb: {size / 1e6:.2f} MB')
    for form, objects in near.items():
        low, high = bounds(objects)
        print(f'ISLAND-HOUSES {form}: {high[1] - low[1]:.1f} m high, '
              f'{high[0] - low[0]:.1f} x {high[2] - low[2]:.1f} m')
    if shots:
        shoot(near, shots)


main()
