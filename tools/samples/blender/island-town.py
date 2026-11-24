# Builds the island showcase scene's hero landmarks in Blender: its domed church with a bell tower,
# its hilltop keep, its harbour lighthouse and three waterfront houses. Everything comes from this
# script and a fixed seed: the forms and every texture, which numpy paints. Nothing is downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/island-town.py -- <output folder> [--preview <folder>]
#
# `bun tools/samples/blender/island-town.ts <folder>` runs it and optimizes the file for the scene.
#
# It writes one binary glTF file, `town.glb`, with a node for each material of each landmark, and one
# or two lower levels of detail (MSFT_lod) on every node. The scene draws each node as an instance
# batch over its copies, so the church, the three keeps and the waterfront each cost a few draw calls.
#
# Coordinates are the showcase scene's own: x across, y up and z toward a building's front, in
# meters. Each model's origin is its ground point at ground level. `common.py` turns them into
# Blender's axes as it builds, where a model's front faces -y, which glTF exports as +z.
#
# Every face has its own vertices and its own normals, so edges stay crisp while the drum, the domes
# and the tower keep a smooth curve. Vertex colors carry the paint and the grounding shade, which
# the glTF material multiplies into the texture. Every texture is painted here: lime render, ashlar
# limestone, terracotta roof tiles, blue glazed dome tiles, dark timber and old glazing.

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
    Builder, arguments, export, fbm, half, image, material, normal_map, occlusion_of, orm, smoothstep, stage,
)

SEED = 20261122

SKY = (0.42, 0.56, 0.80)
# The share of the texture's length that one level of detail may stray from the full shape, in
# meters, for the level that a view picks beyond 260 m and beyond 1,040 m.
LEVEL_ERRORS = (0.2, 0.8)

# ---------------------------------------------------------------------------------------------
# Painting
# ---------------------------------------------------------------------------------------------


def render_texture(size, rng):
    """Lime render: a warm near-white with a soft mottle, a fine grain and faint damp stains."""
    base = np.array([0.93, 0.91, 0.86])
    broad = fbm(size, size, 3, 3, rng, 5)
    mid = fbm(size, size, 10, 10, rng, 4)
    grain = fbm(size, size, 64, 64, rng, 2)
    patch = smoothstep(0.66, 0.9, fbm(size, size, 2, 2, rng, 4))
    shade = (
        0.985
        + 0.03 * (broad - 0.5)
        + 0.025 * (mid - 0.5)
        + 0.02 * (grain - 0.5)
        - 0.025 * patch
    )
    return np.clip(base[None, None, :] * shade[..., None], 0, 1)


def ashlar_texture(size, rng):
    """Limestone in staggered courses, with pale mortar, a fine grain and a little staining."""
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
    colour = np.array([0.68, 0.63, 0.53])[None, None, :] * tone[..., None]
    colour = colour * (0.95 + 0.05 * grain[..., None]) * (1 - 0.07 * stain[..., None])
    mortar = np.array([0.60, 0.57, 0.50])[None, None, :]
    colour = np.where(height[..., None] < 0.68, mortar, colour)
    rough = 0.80 + 0.14 * grain - 0.06 * stain
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def keep_ashlar_texture(size, rng):
    """
    Limestone ashlar for the keep: uneven courses of large blocks in varied widths, with joints of
    their own width, a tone per block and two scales of weathering. The layout is irregular, so a
    block pattern does not line up with itself across the wall.
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    gaps = rng.uniform(0.11, 0.25, 6)
    cuts = np.concatenate(([0.0], np.cumsum(gaps / gaps.sum()) * size))
    height = np.zeros((size, size), np.float32)
    tone = np.ones((size, size), np.float32)
    joint = np.zeros((size, size), np.float32)
    for c in range(len(cuts) - 1):
        count = int(rng.integers(2, 5))
        widths = rng.uniform(0.75, 1.5, count)
        edges = np.concatenate(([0.0], np.cumsum(widths) / widths.sum() * size))
        tones = rng.uniform(0.88, 1.10, count)
        band = slice(int(round(cuts[c])), int(round(cuts[c + 1])))
        columns = xx[band]
        block = np.clip(np.searchsorted(edges, columns, side='right') - 1, 0, count - 1)
        tone[band] = tones[block]
        dx = np.minimum(columns - edges[block], edges[block + 1] - columns)
        dy = np.minimum(yy[band] - cuts[c], cuts[c + 1] - yy[band])
        joint[band] = np.clip(np.minimum(dx, dy) / rng.uniform(1.8, 3.4), 0.0, 1.0)
    # Block faces stand proud of their joints, each a little above or below its neighbours.
    height = (0.42 + 0.58 * smoothstep(0.15, 0.85, joint) + 0.06 * (tone - 1.0)).astype(np.float32)
    broad = fbm(size, size, 2, 2, rng, 4)
    mid = fbm(size, size, 12, 12, rng, 3)
    grain = fbm(size, size, 96, 96, rng, 2)
    stain = smoothstep(0.58, 0.92, fbm(size, size, 4, 4, rng, 4))
    shade = (0.94 + 0.06 * broad) * (0.95 + 0.05 * mid) * (0.955 + 0.045 * grain)
    colour = np.array([0.68, 0.63, 0.53])[None, None, :] * tone[..., None]
    colour = colour * shade[..., None] * (1 - 0.06 * stain[..., None])
    mortar = np.array([0.60, 0.57, 0.50])[None, None, :] * (0.94 + 0.06 * broad)[..., None]
    colour = np.where(joint[..., None] < 0.32, mortar, colour)
    rough = 0.80 + 0.10 * grain - 0.05 * stain + 0.06 * (1 - joint)
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
    height = 0.25 + 0.55 * profile * course + 0.20 * (1 - 0.3 * v)
    tone = rng.uniform(0.78, 1.14, (rows + 1, cols + 1))
    tile = tone[(yy // bh).astype(int) % (rows + 1), (xx // bw).astype(int) % (cols + 1)]
    grain = fbm(size, size, 48, 48, rng, 2)
    lichen = smoothstep(0.72, 0.94, fbm(size, size, 6, 6, rng, 4))
    colour = np.array([0.48, 0.20, 0.11])[None, None, :] * tile[..., None]
    colour = colour * (0.86 + 0.14 * grain[..., None]) * (0.55 + 0.45 * profile[..., None])
    moss = np.array([0.30, 0.31, 0.18])[None, None, :]
    colour = colour * (1 - 0.5 * lichen[..., None]) + moss * (0.5 * lichen[..., None])
    rough = 0.62 + 0.3 * lichen + 0.08 * grain
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def dome_texture(size, rng):
    """Glazed cobalt tiles in a diamond lattice, some of them bleached by the sun."""
    cell = size // 8
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (xx % cell) / cell - 0.5
    v = (yy % cell) / cell - 0.5
    height = np.clip(1.25 - (np.abs(u) + np.abs(v)) * 1.5, 0.15, 1.0)
    tone = rng.uniform(0.72, 1.18, (size // cell + 1, size // cell + 1))
    tile = tone[(yy // cell).astype(int) % (size // cell + 1), (xx // cell).astype(int) % (size // cell + 1)]
    bleach = smoothstep(0.7, 0.95, fbm(size, size, 5, 5, rng, 4))
    colour = np.array([0.055, 0.135, 0.36])[None, None, :] * tile[..., None]
    colour = colour * (0.7 + 0.5 * height[..., None])
    grey = np.array([0.34, 0.37, 0.42])[None, None, :]
    colour = colour * (1 - 0.55 * bleach[..., None]) + grey * (0.55 * bleach[..., None])
    rough = 0.5 + 0.3 * bleach + 0.1 * (1 - height)
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def timber_texture(size, rng):
    """Dark planks with grain, a little bleaching and dark joins between them."""
    planks = 6
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (xx % (size / planks)) / (size / planks)
    split = smoothstep(0.0, 0.03, u) * smoothstep(1.0, 0.97, u)
    grain = 0.5 + 0.5 * np.sin(xx * 0.6 + fbm(size, size, 32, 32, rng, 2) * 9.0)
    tone = rng.uniform(0.8, 1.2, planks)[(xx // (size / planks)).astype(int) % planks]
    colour = np.array([0.20, 0.11, 0.055])[None, None, :] * tone[..., None]
    colour = colour * (0.78 + 0.22 * grain[..., None]) * (0.55 + 0.45 * split[..., None])
    return np.clip(colour, 0, 1)


def glazing_texture(size, rng):
    """Old glass: near black, with a few bright streaks and a little grime."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    streak = smoothstep(0.3, 0.8, np.sin((xx * 0.9 + yy * 0.25) / size * 8 + fbm(size, size, 8, 8, rng, 2) * 6))
    grime = fbm(size, size, 24, 24, rng, 3)
    colour = np.array([0.030, 0.040, 0.055])[None, None, :] * (1 + 3.2 * streak[..., None])
    return np.clip(colour * (0.85 + 0.3 * grime[..., None]), 0, 1)


def make_materials(rng):
    """The six materials that the landmarks share, each with the maps it needs."""
    colour, height, rough = ashlar_texture(512, rng)
    stone = material(
        'town-stone',
        image('town-stone', colour),
        image('town-stone-normal', half(normal_map(height, 1.2)), 'Non-Color'),
        image('town-stone-orm', half(orm(occlusion_of(height, 10), rough)), 'Non-Color'),
        roughness=1.0,
    )
    colour, height, rough = roof_texture(512, rng)
    roof = material(
        'town-roof',
        image('town-roof', colour),
        image('town-roof-normal', half(normal_map(height, 3.0)), 'Non-Color'),
        image('town-roof-orm', half(orm(occlusion_of(height, 8), rough)), 'Non-Color'),
        roughness=1.0,
    )
    colour, height, rough = dome_texture(512, rng)
    dome = material(
        'town-dome',
        image('town-dome', colour),
        image('town-dome-normal', half(normal_map(height, 1.6)), 'Non-Color'),
        image('town-dome-orm', half(orm(occlusion_of(height, 8), rough)), 'Non-Color'),
        roughness=1.0,
    )
    mats = {
        'walls': material('town-render', image('town-render', render_texture(512, rng)), roughness=0.94),
        'stone': stone,
        'roof': roof,
        'dome': dome,
        'wood': material('town-timber', image('town-timber', timber_texture(256, rng)), roughness=0.72),
        'glass': material('town-glass', image('town-glass', glazing_texture(256, rng)), roughness=0.18),
    }
    # The keep's own ashlar: large irregular blocks that hold their detail at the closest range.
    colour, height, rough = keep_ashlar_texture(512, rng)
    mats['keep-stone'] = material(
        'town-keep-stone',
        image('town-keep-stone', colour),
        image('town-keep-stone-normal', half(normal_map(height, 1.2)), 'Non-Color'),
        image('town-keep-stone-orm', half(orm(occlusion_of(height, 10), rough)), 'Non-Color'),
        roughness=1.0,
    )
    return mats


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


def _side_of(normal):
    """A unit vector across a wall whose outward normal is given."""
    return _unit(_cross((0, 1, 0), normal))


class Geo:
    """Faces of one material, in the scene's coordinates, drawn into a Builder in Blender's axes."""

    def __init__(self):
        self.builder = Builder(sway=False)

    def vertex(self, p, uv, color, normal):
        return self.builder.vertex(
            (p[0], -p[2], p[1]), uv, color, (normal[0], -normal[2], normal[1])
        )

    def face(self, points, color, tile=1.0, normal=None, uvs=None, uv_offset=(0.0, 0.0)):
        """
        A face, counter-clockwise seen from outside. A given `normal` also turns the points' order
        right, so a caller may name them in any order. Its texture coordinates run in meters along
        the face's own plane unless `uvs` gives them, and `uv_offset` shifts them within the texture.
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
            uv = uvs[k] if uvs is not None else (
                _dot(p, u_axis) / tile + uv_offset[0], _dot(p, v_axis) / tile + uv_offset[1])
            if abs(n[1]) > 0.7:
                shade = 1.0 if n[1] > 0 else 0.5
            else:
                shade = 0.70 + 0.30 * _sstep(0.0, 5.5, p[1])
            ids.append(self.vertex(p, uv, tuple(c * shade for c in color), n))
        self.builder.face(*ids)

    def box(self, x0, y0, z0, x1, y1, z1, color, tile=1.5, top=True, bottom=False,
            uv_offset=(0.0, 0.0)):
        """The box's faces, outward; `top` and `bottom` may leave a lid off."""
        if top:
            self.face([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], color, tile,
                      (0, 1, 0), uv_offset=uv_offset)
        if bottom:
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], color, tile,
                      (0, -1, 0), uv_offset=uv_offset)
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], color, tile,
                  (0, 0, 1), uv_offset=uv_offset)
        self.face([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], color, tile,
                  (0, 0, -1), uv_offset=uv_offset)
        self.face([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], color, tile,
                  (1, 0, 0), uv_offset=uv_offset)
        self.face([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], color, tile,
                  (-1, 0, 0), uv_offset=uv_offset)

    def gable(self, axis, ridge, low, high, half, y_eave, y_ridge, color, tile=1.0, overhang=0.45):
        """Two slopes that meet at a ridge running along `axis` ('x' or 'z')."""
        if axis == 'z':
            z0, z1 = low - overhang, high + overhang
            for s in (-1, 1):
                x = ridge + s * (half + overhang)
                e0, e1 = (x, y_eave, z0), (x, y_eave, z1)
                r0, r1 = (ridge, y_ridge, z0), (ridge, y_ridge, z1)
                self.roof_plane([e0, r0, r1, e1], color, tile)
        else:
            x0, x1 = low - overhang, high + overhang
            for s in (-1, 1):
                z = ridge + s * (half + overhang)
                e0, e1 = (x0, y_eave, z), (x1, y_eave, z)
                r0, r1 = (x0, y_ridge, ridge), (x1, y_ridge, ridge)
                self.roof_plane([e0, e1, r1, r0], color, tile)

    def roof_plane(self, points, color, tile=1.0):
        """A single slope, turned to face upward."""
        n = _unit(_cross(_sub(points[1], points[0]), _sub(points[2], points[0])))
        self.face(points, color, tile, n if n[1] >= 0 else (-n[0], -n[1], -n[2]))

    def revolve(self, cx, cz, rings, sides, color, tile=1.0, color_at=None, start=0.0, sweep=None,
                cap_top=False, cap_bottom=False):
        """A stack of rings (height, radius) about a vertical axis, with smooth radial normals."""
        sweep = math.tau if sweep is None else sweep
        closed = abs(sweep - math.tau) < 1e-9
        cols = sides if closed else sides + 1
        rows = []
        for y, r in rings:
            rows.append([
                (cx + math.sin(start + sweep * j / sides) * r, y,
                 cz + math.cos(start + sweep * j / sides) * r,
                 start + sweep * j / sides)
                for j in range(cols)
            ])
        for i in range(len(rings) - 1):
            dy = rings[i + 1][0] - rings[i][0] or 1e-6
            slope = (rings[i][1] - rings[i + 1][1]) / dy
            for j in range(sides):
                k = (j + 1) % cols
                quad = [rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]]
                ids = []
                for point in quad:
                    p, a = point[:3], point[3]
                    # The segment that closes the ring reads its texture on from the ring's start.
                    if closed and abs(a - start) < 1e-9 and j > 0:
                        a += math.tau
                    uv = (a * rings[i][1] / tile, p[1] / tile)
                    paint = color_at(p) if color_at else color
                    shade = 0.70 + 0.30 * _sstep(0.0, 5.5, p[1])
                    ids.append(self.vertex(p, uv, tuple(c * shade for c in paint),
                                           _unit((math.sin(a), slope, math.cos(a)))))
                self.builder.face(*ids)
        if cap_top:
            self._cap(cx, cz, rings[-1][0], rings[-1][1], sides, start, sweep, color, color_at, 1)
        if cap_bottom:
            self._cap(cx, cz, rings[0][0], rings[0][1], sides, start, sweep, color, color_at, -1)

    def _cap(self, cx, cz, y, r, sides, start, sweep, color, color_at, up):
        ids = []
        for j in range(sides + 1):
            a = start + sweep * j / sides
            p = (cx + math.sin(a) * r, y, cz + math.cos(a) * r)
            ids.append(self.vertex(p, (p[0], p[2]), color_at(p) if color_at else color, (0, up, 0)))
        mid = self.vertex((cx, y, cz), (0, 0), color_at((cx, y, cz)) if color_at else color, (0, up, 0))
        for j in range(sides):
            self.builder.face(mid, ids[j], ids[j + 1]) if up > 0 else self.builder.face(mid, ids[j + 1], ids[j])

    def dome(self, cx, cz, y0, radius, height, sides, rows, color, tile=1.0):
        """A smooth ellipsoidal cap, from its equator up to one apex vertex."""

        def ring(phi):
            made = []
            for j in range(sides):
                a = math.tau * j / sides
                r = radius * math.cos(phi)
                p = (cx + math.sin(a) * r, y0 + height * math.sin(phi), cz + math.cos(a) * r)
                n = _unit((math.sin(a) * math.cos(phi) / radius, math.sin(phi) / height,
                           math.cos(a) * math.cos(phi) / radius))
                made.append((p, n, a))
            return made

        prev = ring(0.0)
        for i in range(1, rows):
            row = ring((math.pi / 2) * i / rows)
            for j in range(sides):
                k = (j + 1) % sides
                ids = []
                for p, n, a in (prev[j], prev[k], row[k], row[j]):
                    ids.append(self.vertex(p, (a * radius / tile, p[1] / tile), color, n))
                self.builder.face(*ids)
            prev = row
        apex = self.vertex((cx, y0 + height, cz), (0, height / tile), color, (0, 1, 0))
        ids = [self.vertex(p, (a * radius / tile, p[1] / tile), color, n) for p, n, a in prev]
        for j in range(sides):
            self.builder.face(ids[j], ids[(j + 1) % sides], apex)

    def arch(self, origin, side, normal, width, height, color, tile=1.0, segments=8, offset=0.03):
        """A dark opening: a rectangle under a half round, `offset` clear of the wall it lies on."""
        up = _unit(_cross(normal, side))
        half_w = width / 2
        spring = max(0.0, height - half_w)
        base = tuple(origin[i] + normal[i] * offset for i in range(3))

        def at(x, y):
            return tuple(base[i] + side[i] * x + up[i] * y for i in range(3))

        self.face([at(-half_w, 0), at(half_w, 0), at(half_w, spring), at(-half_w, spring)], color, tile, normal)
        for k in range(segments):
            a0, a1 = math.pi * k / segments, math.pi * (k + 1) / segments
            self.face([
                at(0, spring),
                at(math.cos(a0) * half_w, spring + math.sin(a0) * half_w),
                at(math.cos(a1) * half_w, spring + math.sin(a1) * half_w),
            ], color, tile, normal)

    def arch_frame(self, origin, side, normal, width, height, thick, color, tile=1.5, segments=8, offset=0.05):
        """A stone surround and sill around an opening of `arch`'s shape."""
        up = _unit(_cross(normal, side))
        half_w = width / 2
        spring = max(0.0, height - half_w)
        base = tuple(origin[i] + normal[i] * offset for i in range(3))

        def at(x, y):
            return tuple(base[i] + side[i] * x + up[i] * y for i in range(3))

        for s in (-1, 1):
            x0, x1 = (s * half_w, s * (half_w + thick))
            self.face([at(x0, 0), at(x1, 0), at(x1, spring), at(x0, spring)], color, tile, normal)
        for k in range(segments):
            a0, a1 = math.pi * k / segments, math.pi * (k + 1) / segments
            self.face([
                at(math.cos(a0) * half_w, spring + math.sin(a0) * half_w),
                at(math.cos(a0) * (half_w + thick), spring + math.sin(a0) * (half_w + thick)),
                at(math.cos(a1) * (half_w + thick), spring + math.sin(a1) * (half_w + thick)),
                at(math.cos(a1) * half_w, spring + math.sin(a1) * half_w),
            ], color, tile, normal)
        # The sill stands out under the opening.
        inner = [at(-half_w - thick, 0), at(half_w + thick, 0)]
        back = [tuple(p[i] - normal[i] * 0.16 for i in range(3)) for p in inner]
        low = [tuple(p[i] - up[i] * 0.14 for i in range(3)) for p in inner]
        self.face([back[0], back[1], low[1], low[0]], color, tile, normal)


# ---------------------------------------------------------------------------------------------
# The landmarks
# ---------------------------------------------------------------------------------------------

# Linear paint, multiplied into the maps' own colors.
WHITE = (1.0, 1.0, 1.0)
CREAM = (1.0, 0.96, 0.88)
OCHRE = (1.0, 0.84, 0.63)
ROSE = (1.0, 0.80, 0.72)
PALE = (0.95, 0.92, 0.85)
STONE = (0.98, 0.95, 0.88)
DARK = (0.055, 0.05, 0.05)
IRON = (0.10, 0.10, 0.11)
SHUTTER_GREEN = (0.22, 0.48, 0.30)
SHUTTER_BLUE = (0.20, 0.38, 0.62)
SHUTTER_TEAL = (0.16, 0.50, 0.47)
WOOD_PAINT = (0.62, 0.42, 0.24)
RED = (0.95, 0.16, 0.11)


def window(glass, trim, origin, normal, width, height, frame=True, segments=6):
    """A glazed opening with its surround and mullions, on a wall whose outward normal is given."""
    side = _side_of(normal)
    up = _unit(_cross(normal, side))
    glass.arch(origin, side, normal, width, height, DARK, segments=segments, offset=0.025)
    if frame:
        trim.arch_frame(origin, side, normal, width, height, 0.16, PALE, segments=segments, offset=0.05)
    # A cross of glazing bars divides the pane, so the opening is not one flat black sheet.
    at = lambda x, y: tuple(origin[i] + side[i] * x + up[i] * y + normal[i] * 0.055 for i in range(3))
    bar = 0.035
    spring = max(0.0, height - width / 2)
    for low, high in ((bar, spring), (spring - bar, spring)):
        trim.face([at(-width / 2, low), at(width / 2, low), at(width / 2, high), at(-width / 2, high)], PALE, 1.0, normal)
    trim.face(
        [at(-bar, 0.05), at(bar, 0.05), at(bar, spring), at(-bar, spring)],
        PALE, 1.0, normal,
    )


def shutters(walls, origin, normal, width, height, color):
    """Two louvred leaves at an opening's sides."""
    side = _side_of(normal)
    up = _unit(_cross(normal, side))
    for s in (-1, 1):
        x0, x1 = (s * (width * 0.5 + 0.06), s * (width * 0.5 + 0.06 + width * 0.48))
        for slat in range(5):
            low = 0.05 + slat * ((height - 0.2) / 5)
            high = low + (height - 0.2) / 5 - 0.03
            shade = color if slat % 2 == 0 else tuple(c * 0.72 for c in color)
            pts = [
                tuple(origin[i] + side[i] * x + up[i] * y + normal[i] * 0.075 for i in range(3))
                for x, y in ((x0, low), (x1, low), (x1, high), (x0, high))
            ]
            walls.face(pts, shade, 1.0, normal)


def cross(stone, x, y, z, height, color):
    """A thin cross on a dome's lantern."""
    stone.box(x - 0.045, y, z - 0.045, x + 0.045, y + height, z + 0.045, color, 0.5)
    stone.box(x - height * 0.32, y + height * 0.68, z - 0.045, x + height * 0.32,
              y + height * 0.68 + 0.07, z + 0.045, color, 0.5)


def ring_face(geo, cx, cy, z, inner, outer, color, segments=16, normal=(0, 0, 1)):
    """A flat ring on a wall, such as a rose window's stone rim."""
    for k in range(segments):
        a0, a1 = math.tau * k / segments, math.tau * (k + 1) / segments
        geo.face([
            (cx + math.cos(a0) * inner, cy + math.sin(a0) * inner, z),
            (cx + math.cos(a0) * outer, cy + math.sin(a0) * outer, z),
            (cx + math.cos(a1) * outer, cy + math.sin(a1) * outer, z),
            (cx + math.cos(a1) * inner, cy + math.sin(a1) * inner, z),
        ], color, 1.0, normal)


def church(model, detail):
    """The church: nave, aisles, transept, apse, crossed dome, bell tower and the front's steps."""
    walls, stone = model.shape('walls'), model.shape('stone')
    roof, dome = model.shape('roof'), model.shape('dome')
    wood, glass = model.shape('wood'), model.shape('glass')
    fine, mid = detail == 0, detail <= 1
    sides = 24 if fine else 12 if mid else 8

    # The blocks and their plinths.
    stone.box(-10.7, -0.7, -14.7, 10.7, 0.55, 12.7, STONE, 1.2)
    stone.box(-14.7, -0.7, -6.7, 14.7, 0.55, 3.7, STONE, 1.2)
    stone.box(7.2, -0.7, 5.7, 13.3, 0.55, 11.8, STONE, 1.2)
    walls.box(-6, 0, -14, 6, 11, 12, CREAM, 1.8)
    # The aisles stand beside the nave, not across it, so no two front or back faces share a
    # plane: coplanar faces flicker, and Cycles shadows each one with the other.
    walls.box(-10, 0, -14, -6, 6.5, 12, WHITE, 1.8)
    walls.box(6, 0, -14, 10, 6.5, 12, WHITE, 1.8)
    walls.box(-14, 0, -6, 14, 10, 3, WHITE, 1.8)
    # The gables, the roofs and the apse.
    walls.face([(-6, 11, 12), (6, 11, 12), (0, 14, 12)], CREAM, 1.8, (0, 0, 1))
    walls.face([(6, 11, -14), (-6, 11, -14), (0, 14, -14)], CREAM, 1.8, (0, 0, -1))
    for s in (-1, 1):
        walls.face([(s * 14, 10, -6), (s * 14, 10, 3), (s * 14, 13, -1.5)], WHITE, 1.8, (s, 0, 0))
        walls.face([(s * 10.4, 6.4, 12), (s * 6.1, 9.2, 12), (s * 6.1, 6.4, 12)],
                   WHITE, 1.8, (0, 0, 1))
        walls.face([(s * 10.4, 6.4, -14), (s * 6.1, 9.2, -14), (s * 6.1, 6.4, -14)],
                   WHITE, 1.8, (0, 0, -1))
    roof.gable('z', 0, -14, 12, 6, 11, 14, WHITE, 1.1, 0.5)
    roof.gable('x', -1.5, -14, 14, 4.5, 10, 13, WHITE, 1.1, 0.45)
    for s in (-1, 1):
        roof.roof_plane([
            (s * 10.4, 6.4, -14.4), (s * 10.4, 6.4, 12.4),
            (s * 6.1, 9.2, 12.4), (s * 6.1, 9.2, -14.4),
        ], WHITE, 1.1)
    stone.revolve(0, -14, [(0, 6.0), (8.6, 6.0)], 12 if fine else 8, PALE, 1.6,
                  start=math.pi / 2, sweep=math.pi)
    apse_sides = 10 if fine else 6
    for k in range(apse_sides):
        a0 = -math.pi / 2 + math.pi * k / apse_sides
        a1 = -math.pi / 2 + math.pi * (k + 1) / apse_sides
        at = lambda a, r, y: (math.sin(a) * r, y, -14 - math.cos(a) * r)
        roof.face([at(a0, 6.4, 8.5), at(a1, 6.4, 8.5), at(a1, 0.4, 11.4), at(a0, 0.4, 11.4)], WHITE, 1.1)

    if fine:
        # Pilasters, cornices and string courses on the front and the walls.
        for x in (-9.7, -6.3, 5.9, 9.4):
            stone.box(x - 0.2, 0, 12.0, x + 0.2, 11 if abs(x) < 8 else 6.5, 12.28, PALE, 1.2)
        stone.box(-10.3, 6.25, 12.0, 10.3, 6.75, 12.42, PALE, 1.2)
        stone.box(-6.4, 10.75, 12.0, 6.4, 11.2, 12.42, PALE, 1.2)
        # The portal, the cornice over it and the rose window.
        stone.arch_frame((0, 1.15, 12.0), (1, 0, 0), (0, 0, 1), 3.4, 5.5, 0.36, PALE, segments=10, offset=0.06)
        wood.arch((0, 1.18, 12.0), (1, 0, 0), (0, 0, 1), 2.6, 4.8, WOOD_PAINT, segments=10, offset=0.10)
        stone.box(-2.8, 5.8, 12.0, 2.8, 6.2, 12.5, PALE, 1.2)
        rose_y, rose_r = 8.7, 1.45
        glass.face([
            (math.cos(a) * rose_r, rose_y + math.sin(a) * rose_r, 12.03)
            for a in np.linspace(0, math.tau, 17)[:-1]
        ], DARK, 1.0, (0, 0, 1))
        ring_face(stone, 0, rose_y, 12.05, rose_r, rose_r + 0.18, PALE)
        for k in range(8):
            a = math.tau * k / 8
            c, s = math.cos(a), math.sin(a)
            w = 0.035
            stone.face([
                (c * rose_r + s * w, rose_y + s * rose_r - c * w, 12.06),
                (c * rose_r - s * w, rose_y + s * rose_r + c * w, 12.06),
                (-s * w, rose_y + c * w, 12.06),
                (s * w, rose_y - c * w, 12.06),
            ], PALE, 1.0, (0, 0, 1))
        # Arched windows along the aisles, the transept ends and the clerestory.
        for s in (-1, 1):
            for z in (-11, -6.5, 5, 9.5):
                window(glass, stone, (s * 10.0, 2.2, z), (s, 0, 0), 1.2, 3.2)
            window(glass, stone, (s * 14.0, 2.4, -1.5), (s, 0, 0), 1.9, 4.6)
            for z in (-11, -6, 5, 10):
                if not -6 < z < 3:
                    window(glass, stone, (s * 6.0, 7.0, z), (s, 0, 0), 1.0, 2.4, frame=False)
        # A side door on each aisle.
        for s in (-1, 1):
            stone.arch_frame((s * 10.0, 0.6, -3.5), _side_of((s, 0, 0)), (s, 0, 0), 1.4, 3.0, 0.22, PALE)
            wood.arch((s * 10.0, 0.6, -3.5), _side_of((s, 0, 0)), (s, 0, 0), 1.1, 2.7, WOOD_PAINT, offset=0.09)
    elif mid:
        for s in (-1, 1):
            for z in (-11, 5):
                window(glass, stone, (s * 10.0, 2.2, z), (s, 0, 0), 1.2, 3.2, frame=False, segments=4)
        wood.arch((0, 1.18, 12.0), (1, 0, 0), (0, 0, 1), 2.6, 4.8, WOOD_PAINT, segments=6, offset=0.08)

    # The drum, the ribbed dome, the lantern and its cross.
    centre_z, drum_low, drum_high, dome_base, dome_r = -1.5, 12.9, 18.4, 18.8, 6.55
    stone.revolve(0, centre_z, [(drum_low, 6.3), (drum_high, 6.3)], sides, PALE, 1.6, cap_top=True)
    if mid:
        stone.revolve(0, centre_z, [(drum_high, 6.8), (dome_base, 6.55)], sides, PALE, 1.6, cap_top=True)
    dome.dome(0, centre_z, dome_base, dome_r, 6.5, sides, 7 if fine else 4, WHITE, 1.0)
    if fine:
        # Each rib is a raised stone band with its own sides, so it meets the dome and casts a shadow.
        for k in range(16):
            a = math.tau * k / 16
            radial = _unit((math.sin(a), 0.35, math.cos(a)))
            sideways = (math.cos(a), 0.0, -math.sin(a))

            def at(phi, da, extra):
                r = (dome_r + extra) * math.cos(phi)
                return (math.sin(a + da) * r, dome_base + 6.5 * math.sin(phi),
                        centre_z + math.cos(a + da) * r)

            for row in range(6):
                phi0, phi1 = (math.pi / 2) * row / 6, (math.pi / 2) * (row + 1) / 6
                o00, o10 = at(phi0, -0.014, 0.1), at(phi0, 0.014, 0.1)
                o01, o11 = at(phi1, -0.014, 0.1), at(phi1, 0.014, 0.1)
                i00, i10 = at(phi0, -0.014, 0.0), at(phi0, 0.014, 0.0)
                i01, i11 = at(phi1, -0.014, 0.0), at(phi1, 0.014, 0.0)
                stone.face([o00, o10, o11, o01], PALE, 1.0, radial)
                stone.face([i00, o00, o01, i01], PALE, 1.0,
                           (-sideways[0], -sideways[1], -sideways[2]))
                stone.face([i10, i11, o11, o10], PALE, 1.0, sideways)
    if mid:
        for k in range(8 if fine else 4):
            a = math.tau * k / 8
            glass.arch((math.sin(a) * 6.32, drum_low + 1.4, centre_z + math.cos(a) * 6.32),
                       _side_of(_unit((math.sin(a), 0, math.cos(a)))), _unit((math.sin(a), 0, math.cos(a))),
                       1.1 if fine else 1.4, 3.4 if fine else 3.0, DARK,
                       segments=5 if fine else 3, offset=0.03)
    crown = dome_base + 6.5
    if mid:
        stone.revolve(0, centre_z, [(crown - 0.2, 0.8), (crown + 1.5, 0.7)], 10 if fine else 6, PALE, 1.2)
        dome.dome(0, centre_z, crown + 1.5, 1.0, 1.6, 10 if fine else 6, 3, WHITE, 0.8)
    if fine:
        cross(stone, 0, crown + 3.1, centre_z, 1.5, IRON)

    # The bell tower: courses, belfry arches, cornice, drum and small dome.
    tx0, tz0, tx1, tz1 = 7.5, 6.0, 13.0, 11.5
    mx, mz = (tx0 + tx1) / 2, (tz0 + tz1) / 2
    walls.box(tx0, 0, tz0, tx1, 22, tz1, WHITE, 1.6)
    if mid:
        for y in (6.0, 11.0, 16.0):
            stone.box(tx0 - 0.14, y, tz0 - 0.14, tx1 + 0.14, y + 0.28, tz1 + 0.14, PALE, 1.2)
        for x, z, nx, nz in ((mx, tz1, 0, 1), (mx, tz0, 0, -1), (tx1, mz, 1, 0), (tx0, mz, -1, 0)):
            glass.arch((x, 16.3, z), _side_of((nx, 0, nz)), (nx, 0, nz), 2.0, 4.4, DARK,
                       segments=7 if fine else 4, offset=0.03)
            if fine:
                stone.arch_frame((x, 16.3, z), _side_of((nx, 0, nz)), (nx, 0, nz), 2.0, 4.4, 0.18, PALE, segments=7)
        stone.box(tx0 - 0.4, 21.9, tz0 - 0.4, tx1 + 0.4, 22.4, tz1 + 0.4, PALE, 1.2)
        stone.revolve(mx, mz, [(22.4, 2.6), (23.7, 2.6)], 12 if fine else 8, PALE, 1.2, cap_top=True)
        dome.dome(mx, mz, 23.7, 2.6, 2.4, 12 if fine else 8, 3, WHITE, 0.9)
        if fine:
            cross(stone, mx, 26.2, mz, 1.3, IRON)
    else:
        stone.box(tx0 - 0.2, 22.0, tz0 - 0.2, tx1 + 0.2, 22.8, tz1 + 0.2, PALE, 1.4)

    # The steps down to the square, in a widening flight.
    if mid:
        steps = 7 if fine else 4
        for k in range(steps):
            inset = k * 0.16
            stone.box(-11.6 + inset, -0.8, 12.0 + k * 0.44, 11.6 - inset,
                      1.05 - k * (1.05 / steps) + 0.14, 12.46 + k * 0.44, PALE, 1.2)


def keep(model, detail):
    """A hilltop keep: a battered stone tower with battlements over a walled court."""
    stone, glass = model.shape('stone'), model.shape('glass')
    model.mats['stone'] = model.mats['keep-stone']
    fine, mid = detail == 0, detail <= 1
    white = (0.98, 0.96, 0.91)
    # One turn of the tower's ashlar covers this many meters, so the pattern spans large blocks.
    tile = 3.0

    stone.box(-5.5, -3, -5.5, 5.5, 3.2, 5.5, white, tile, uv_offset=(0.13, 0.41))
    stone.box(-5.0, 3.0, -5.0, 5.0, 21, 5.0, white, tile, uv_offset=(0.62, 0.07))
    if mid:
        stone.box(-5.4, 20.7, -5.4, 5.4, 21.0, 5.4, PALE, tile, uv_offset=(0.31, 0.78))
        stone.box(-5.0, 21.0, -5.0, 5.0, 21.9, 5.0, white, tile, uv_offset=(0.84, 0.24))
        count = 5 if fine else 4
        for k in range(count):
            at = -4.0 + k * (8.0 / (count - 1))
            shift = ((0.09 * k + 0.05) % 1.0, (0.23 * k + 0.17) % 1.0)
            for x, z in ((at, 5.0), (at, -5.0), (5.0, at), (-5.0, at)):
                stone.box(x - 0.52, 21.8, z - 0.52, x + 0.52, 23.0, z + 0.52, white, tile,
                          uv_offset=shift)
        # The slit windows and the arched door.
        for y in (6.5, 11.0, 15.5):
            for x, z, nx, nz in ((0, 5.0, 0, 1), (0, -5.0, 0, -1), (5.0, 0, 1, 0), (-5.0, 0, -1, 0)):
                side = _side_of((nx, 0, nz))
                for off in ((-1.7, 1.7) if fine else (-1.7,)):
                    o = (x + side[0] * off, y, z + side[2] * off)
                    glass.arch(o, side, (nx, 0, nz), 0.42, 1.5, DARK, segments=3, offset=0.03)
        glass.arch((0, -0.4, 5.52), (1, 0, 0), (0, 0, 1), 1.5, 2.9, DARK, segments=5, offset=0.03)
        if fine:
            stone.arch_frame((0, -0.4, 5.52), (1, 0, 0), (0, 0, 1), 1.5, 2.9, 0.22, PALE, segments=5)

    # The court's three walls, open toward the tower's front.
    walls = ((-11.0, -11.0, 11.0, -9.2), (-11.0, -11.0, -9.2, 11.0), (9.2, -11.0, 11.0, 11.0))
    for index, (x0, z0, x1, z1) in enumerate(walls):
        shift = (0.21 + 0.37 * index, 0.14 + 0.29 * index)
        stone.box(x0, -3, z0, x1, 5.0, z1, white, tile, uv_offset=shift)
        if fine:
            if x1 - x0 > z1 - z0:
                for k in range(6):
                    x = x0 + 0.8 + k * (x1 - x0 - 1.6) / 5
                    stone.box(x - 0.45, 4.9, z0, x + 0.45, 5.9, z1, white, tile, uv_offset=shift)
            else:
                for k in range(6):
                    z = z0 + 0.8 + k * (z1 - z0 - 1.6) / 5
                    stone.box(x0, 4.9, z - 0.45, x1, 5.9, z + 0.45, white, tile, uv_offset=shift)


def lighthouse(model, detail):
    """A harbour lighthouse: a stone foot, a white taper with a red band, and a glazed lamp room."""
    walls, stone, glass = model.shape('walls'), model.shape('stone'), model.shape('glass')
    fine, mid = detail == 0, detail <= 1
    sides = 16 if fine else 8 if mid else 6

    stone.revolve(0, 0, [(-1.2, 3.2), (0.9, 3.2), (1.6, 2.9)], sides, PALE, 1.4, cap_top=True)
    if detail == 2:
        walls.revolve(0, 0, [(1.6, 1.9), (10.5, 1.16), (12.9, 0.12)], sides, WHITE, 1.2, cap_top=True)
        return
    colour_at = lambda p: RED if 4.5 <= p[1] < 5.7 else WHITE
    walls.revolve(0, 0, [(1.6, 1.9), (4.4, 1.78), (4.5, 1.77), (5.6, 1.72),
                         (5.7, 1.71), (10.5, 1.16)], sides, WHITE, 1.2, color_at=colour_at)
    stone.revolve(0, 0, [(10.5, 1.16), (11.0, 1.72)], sides, PALE, 1.0)
    stone.revolve(0, 0, [(11.0, 1.78), (11.18, 1.78)], sides, PALE, 1.0, cap_top=True)
    if fine:
        for k in range(10):
            a = math.tau * k / 10
            stone.revolve(math.sin(a) * 1.68, math.cos(a) * 1.68, [(11.18, 0.04), (12.02, 0.035)],
                          4, IRON, 0.4)
        stone.revolve(0, 0, [(12.0, 1.70), (12.06, 1.70)], 12, IRON, 0.4)
    glass.revolve(0, 0, [(11.2, 0.92), (12.35, 0.86)], 8, DARK, 0.8)
    if fine:
        for k in range(8):
            a = math.tau * k / 8
            stone.revolve(math.sin(a) * 0.9, math.cos(a) * 0.9, [(11.2, 0.045), (12.35, 0.045)],
                          4, IRON, 0.4)
    stone.revolve(0, 0, [(12.35, 0.96), (12.5, 0.98)], 8, PALE, 0.8, cap_top=True)
    walls.revolve(0, 0, [(12.5, 1.0), (13.25, 0.12)], 8 if fine else 6, RED, 0.7, cap_top=True)
    if fine:
        stone.revolve(0, 0, [(13.25, 0.07), (13.6, 0.02)], 4, IRON, 0.4)
    if mid:
        # The door follows the stone foot's curve, so it is a dark sector of the foot's own surface.
        glass.revolve(0, 0, [(-0.7, 3.22), (1.0, 3.22)], 4, DARK, 1.0, start=-0.26, sweep=0.52)
        if fine:
            stone.revolve(0, 0, [(-0.8, 3.3), (-0.55, 3.3)], 4, PALE, 1.0, start=-0.34, sweep=0.68)
            stone.revolve(0, 0, [(-0.8, 3.3), (1.1, 3.3)], 4, PALE, 1.0, start=-0.34, sweep=0.05)
            stone.revolve(0, 0, [(-0.8, 3.3), (1.1, 3.3)], 4, PALE, 1.0, start=0.29, sweep=0.05)


def waterfront(model, variant, detail):
    """A harbour-front house; `variant` picks one of three forms."""
    walls, roof = model.shape('walls'), model.shape('roof')
    wood, glass = model.shape('wood'), model.shape('glass')
    fine, mid = detail == 0, detail <= 1
    paint = {'a': WHITE, 'b': OCHRE, 'c': ROSE}[variant]

    if variant == 'a':
        # Two floors over an arcade, under a gable roof.
        walls.box(-5.5, -1.2, -4.2, 5.5, 6.6, 4.2, paint, 1.8)
        roof.gable('x', 0.0, -5.4, 5.4, 4.6, 6.6, 9.4, WHITE, 1.1, 0.5)
        for s in (-1, 1):
            walls.face([(s * 5.5, 6.6, -4.2), (s * 5.5, 6.6, 4.2), (s * 5.5, 9.4, 0)],
                       paint, 1.8, (s, 0, 0))
        if mid:
            for x in (-3.5, 0, 3.5):
                glass.arch((x, 0.1, 4.22), (1, 0, 0), (0, 0, 1), 2.0, 3.6, DARK,
                           segments=5 if fine else 3, offset=0.03)
            for x in (-3.9, -1.3, 1.3, 3.9):
                window(glass, walls, (x, 4.0, 4.22), (0, 0, 1), 1.0, 1.9, frame=fine, segments=3)
                shutters(walls, (x, 4.0, 4.22), (0, 0, 1), 1.0, 1.9, SHUTTER_GREEN)
            wood.arch((0, 0.1, 4.3), (1, 0, 0), (0, 0, 1), 1.6, 3.0, WOOD_PAINT, segments=5, offset=0.07)
            stone_belt(walls, -5.6, 5.6, 4.28, 3.52, 3.72)
        if fine:
            walls.box(3.6, 9.0, -2.6, 4.4, 10.3, -1.9, paint, 1.2)
            walls.box(-5.7, 6.5, 4.2, 5.7, 6.66, 4.46, PALE, 1.2)

    elif variant == 'b':
        # Three narrow floors, a balcony and a shop front.
        walls.box(-4.8, -1.2, -4.4, 4.8, 10.0, 4.4, paint, 1.8)
        walls.box(-4.8, 10.0, -4.4, 4.8, 10.45, 4.4, paint, 1.8)
        if fine:
            for k in range(5):
                x = -3.9 + k * 1.95
                walls.box(x - 0.35, 10.45, 4.2, x + 0.35, 10.95, 4.5, paint, 1.2)
        if mid:
            for y in (3.6, 6.7):
                for x in (-2.9, 0, 2.9):
                    window(glass, walls, (x, y, 4.42), (0, 0, 1), 0.95, 1.8, frame=fine, segments=3)
                    shutters(walls, (x, y, 4.42), (0, 0, 1), 0.95, 1.8, SHUTTER_BLUE)
            stone_belt(walls, -4.9, 4.9, 4.42, 3.28, 3.5)
            glass.arch((0, 0.2, 4.42), (1, 0, 0), (0, 0, 1), 2.6, 2.9, DARK, segments=3, offset=0.03)
            wood.box(-1.5, 0.2, 4.44, 1.5, 2.7, 4.5, WOOD_PAINT, 1.0)
        if fine:
            # A balcony over the shop, with an iron rail.
            walls.box(-4.4, 6.55, 4.42, 4.4, 6.75, 5.6, PALE, 1.2)
            for k in range(9):
                x = -4.2 + k * 1.05
                walls.box(x - 0.035, 6.75, 5.5, x + 0.035, 7.55, 5.57, IRON, 0.5)
            walls.box(-4.4, 7.52, 5.5, 4.4, 7.6, 5.57, IRON, 0.5)
            walls.box(-4.9, 10.0, 4.42, 4.9, 10.16, 4.65, PALE, 1.2)

    elif variant == 'c':
        # A wide house whose whole top is a terrace, with a rear room under a tiled roof.
        walls.box(-6.2, -1.2, -4.0, 6.2, 6.9, 4.0, paint, 1.8)
        walls.box(-6.2, 6.9, -4.0, 6.2, 8.4, 0.0, paint, 1.8)
        roof.gable('x', -2.0, -6.4, 6.4, 2.0, 8.4, 9.6, WHITE, 1.1, 0.45)
        for s in (-1, 1):
            walls.face([(s * 6.2, 8.4, -4.0), (s * 6.2, 8.4, 0.0), (s * 6.2, 9.6, -2.0)],
                       paint, 1.8, (s, 0, 0))
        if mid:
            for x in (-3.6, 0.2, 4.0):
                window(glass, walls, (x, 3.4, 4.02), (0, 0, 1), 1.0, 1.8, frame=fine, segments=3)
                shutters(walls, (x, 3.4, 4.02), (0, 0, 1), 1.0, 1.8, SHUTTER_TEAL)
            wood.arch((-4.8, 0.1, 4.02), (1, 0, 0), (0, 0, 1), 1.2, 2.8, WOOD_PAINT, segments=4, offset=0.06)
        if fine:
            for k in range(6):
                x = -5.4 + k * 2.15
                walls.box(x - 0.3, 6.9, 3.6, x + 0.3, 7.25, 4.0, paint, 1.2)
            for k in range(8):
                y = (k + 1) * 0.8
                walls.box(-7.4, y - 0.8, 2.2, -6.2, y, 4.0, PALE, 1.2)
            walls.box(-6.4, 6.3, 4.0, 6.4, 6.48, 4.25, PALE, 1.2)


def stone_belt(walls, x0, x1, z, y0, y1):
    """A pale painted belt course across a front."""
    walls.box(x0, y0, z, x1, y1, z + 0.16, PALE, 1.2)


# ---------------------------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------------------------


class Model:
    """The parts of one model, each a Geo of one shared material."""

    def __init__(self, mats):
        self.mats = dict(mats)
        self.parts = {}

    def shape(self, part):
        return self.parts.setdefault(part, Geo())

    def objects(self, name, level=None):
        suffix = '' if level is None else f'-{level}'
        made = []
        for part, geo in self.parts.items():
            if not geo.builder.faces:
                continue
            try:
                made.append(geo.builder.build(f'{name}-{part}{suffix}', self.mats[part]))
            except Exception as error:
                raise SystemExit(
                    f'{name}-{part}{suffix}: {error} '
                    f'({len(geo.builder.positions)} vertices, {len(geo.builder.faces)} faces)'
                ) from error
        return made


def build(mats, name, make, variants=None):
    """A model's objects at every level, and its nearest level's objects."""
    everything, near = [], []
    for level, detail in ((None, 0), (1, 1), (2, 2)):
        for variant in variants or (None,):
            model = Model(mats)
            label = name
            if variant is None:
                make(model, detail)
            else:
                make(model, variant, detail)
                label = f'{name}-{variant}'
            made = model.objects(label, level)
            everything += made
            if level is None:
                near += made
    return everything, near


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


def frame_shot(objects, path, direction, distance, target=None, size=(900, 700), lens=45, samples=28):
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


def variants_of(objects):
    """The objects of each waterfront variant, by its node name."""
    groups = {}
    for o in objects:
        groups.setdefault(o.name.split('-')[1], []).append(o)
    return [groups[k] for k in sorted(groups)]


def spread(groups, gap=8.0):
    """Lays groups side by side along x, centred on the origin, adding to each one's place."""
    spans = []
    for group in groups:
        low, high = bounds(group)
        spans.append((low[0], high[0]))
    x = -(sum(h - l for l, h in spans) + gap * (len(groups) - 1)) / 2
    for group, (low, high) in zip(groups, spans):
        dx = x - low
        for o in group:
            o.location.x += dx
        x += (high - low) + gap
    bpy.context.view_layer.update()


def reset(objects):
    for o in objects:
        o.location.x = 0
    bpy.context.view_layer.update()


def shoot(near, shots):
    """The preview pictures: each landmark from three quarters, close up and from gameplay range."""
    church_, keep_, lighthouse_, waterfront_ = near['church'], near['keep'], near['lighthouse'], near['waterfront']

    frame_shot(church_, os.path.join(shots, 'church.png'), (-0.6, 0.45, 0.66), 68, target=(0, 13, -1))
    frame_shot(church_, os.path.join(shots, 'church-front.png'), (0.0, 0.15, 1.0), 70, target=(0, 12, 1))
    frame_shot(church_, os.path.join(shots, 'church-close.png'), (-0.5, 0.3, 0.8), 20,
               target=(0, 20, -1.5), size=(800, 600))
    frame_shot(church_, os.path.join(shots, 'church-distance.png'), (-0.3, 0.26, 0.92), 260,
               target=(0, 12, 0), size=(640, 420))

    frame_shot(keep_, os.path.join(shots, 'keep.png'), (-0.6, 0.42, 0.68), 48, target=(0, 10, 0))
    frame_shot(keep_, os.path.join(shots, 'keep-close.png'), (-0.55, 0.35, 0.75), 19,
               target=(0, 19, 2), size=(800, 600))
    frame_shot(keep_, os.path.join(shots, 'keep-distance.png'), (-0.3, 0.28, 0.92), 220,
               target=(0, 10, 0), size=(640, 420))
    frame_shot(keep_, os.path.join(shots, 'keep-detail-close.png'), (-0.7, 0.15, 1.0), 0.55,
               target=(0, 8.0, 5.0), size=(800, 600), lens=20)
    frame_shot(keep_, os.path.join(shots, 'keep-detail-2m.png'), (-0.15, 0.05, 1.0), 2.0,
               target=(0, 8.0, 5.0), size=(800, 600))

    frame_shot(lighthouse_, os.path.join(shots, 'lighthouse.png'), (-0.65, 0.30, 0.70), 26,
               target=(0, 6, 0), size=(700, 800))
    frame_shot(lighthouse_, os.path.join(shots, 'lighthouse-close.png'), (-0.5, 0.25, 0.8), 9,
               target=(0, 11.3, 0), size=(800, 600))
    frame_shot(lighthouse_, os.path.join(shots, 'lighthouse-distance.png'), (-0.3, 0.26, 0.92), 140,
               target=(0, 5, 0), size=(520, 440))

    # The three waterfront houses side by side at their true sizes, one close, and the row far off.
    trio = variants_of(waterfront_)
    spread(trio, 4.0)
    frame_shot(waterfront_, os.path.join(shots, 'waterfront.png'), (-0.55, 0.38, 0.74), 58,
               target=(centre(waterfront_)))
    frame_shot(waterfront_, os.path.join(shots, 'waterfront-close.png'), (-0.5, 0.3, 0.8), 16,
               target=(centre(trio[0])), size=(900, 620))
    frame_shot(waterfront_, os.path.join(shots, 'waterfront-distance.png'), (-0.3, 0.26, 0.92), 130,
               target=(centre(waterfront_)), size=(720, 420))

    lineup = [church_, keep_, lighthouse_, waterfront_]
    spread(lineup, 18.0)
    flat = [o for group in lineup for o in group]
    frame_shot(flat, os.path.join(shots, 'lineup.png'), (-0.55, 0.36, 0.75), 320,
               target=(0, 12, 0), size=(1200, 600))
    frame_shot(flat, os.path.join(shots, 'lineup-near.png'), (-0.4, 0.30, 0.86), 70,
               target=(0, 7, 0), size=(1200, 500))
    reset(waterfront_)
    for group in lineup[:3]:
        reset(group)


def main():
    out, shots = arguments('island-town.py')
    rng = np.random.default_rng(SEED)
    mats = make_materials(rng)
    near, everything = {}, []
    for name, make, variants in (
        ('church', church, None),
        ('keep', keep, None),
        ('lighthouse', lighthouse, None),
        ('waterfront', waterfront, ('a', 'b', 'c')),
    ):
        made, close = build(mats, name, make, variants)
        everything += made
        near[name] = close

    report = export(os.path.join(out, 'town.glb'), everything, set(), list(LEVEL_ERRORS))
    for name, triangles in sorted(report.items()):
        print(f'ISLAND-TOWN {name}: {triangles} triangles')
    size = os.path.getsize(os.path.join(out, 'town.glb'))
    print(f'ISLAND-TOWN town.glb: {size / 1e6:.2f} MB')
    for name, objects in near.items():
        low, high = bounds(objects)
        print(f'ISLAND-TOWN {name}: {high[1] - low[1]:.1f} m high, '
              f'{high[0] - low[0]:.1f} x {high[2] - low[2]:.1f} m')
    if shots:
        shoot(near, shots)


main()
