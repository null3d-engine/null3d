# Builds the island showcase scene's harbour and beach props in Blender: a sailing yacht, an open
# fishing boat, three boulders, a beach parasol, a sun lounger and a harbour bench. Everything comes
# from this script and a fixed seed: the forms and every texture, which numpy paints. Nothing is
# downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/island-props.py -- <output folder> [--preview <folder>]
#
# `bun tools/samples/blender/island-props.ts <folder>` runs it and optimizes the file for the scene.
#
# It writes one binary glTF file, `props.glb`, with a node for each material of each prop. The yacht,
# the fishing boat and the three boulders carry two lower levels of detail (MSFT_lod); the small
# props do not need any. The scene draws each node as an instance batch over its copies, so the
# harbour's many boats and the coast's thousands of stones cost a few draw calls.
#
# Coordinates are the showcase scene's own: x across, y up and z toward a boat's bow or a bench's
# front, in meters. A boat's origin is its waterline, so its hull reaches below y = 0 as the scene's
# code-built boats do, and every other prop's origin is its ground point. `common.py` turns them
# into Blender's axes as it builds, where a model's front faces -y, which glTF exports as +z.
#
# Every texture is painted here: white gelcoat, golden teak planks, woven canvas, brushed metal,
# dark glazing and weathered stone. Vertex colors carry the paint, the interior shade and the
# stone's tone, which the glTF material multiplies into the texture.

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
    Builder, arguments, at_distance, export, fbm, frame_of, half, image, material, normal_map,
    occlusion_of, orm, smoothstep, stage, value_noise,
)

SEED = 20261123

SKY = (0.42, 0.56, 0.80)

TAU = math.tau

# ---------------------------------------------------------------------------------------------
# Painting
# ---------------------------------------------------------------------------------------------


def gelcoat_texture(size, rng):
    """White boat paint: a warm near-white with a fine orange-peel mottle and a few pale scuffs."""
    base = np.array([0.955, 0.958, 0.95])
    broad = fbm(size, size, 4, 4, rng, 4)
    peel = fbm(size, size, 48, 48, rng, 3)
    grain = value_noise(size, size, 128, 128, rng)
    scuff = smoothstep(0.74, 0.96, fbm(size, size, 18, 18, rng, 3))
    shade = 1.0 + 0.018 * (broad - 0.5) + 0.012 * (peel - 0.5) + 0.008 * (grain - 0.5)
    shade = shade * (1 - 0.05 * scuff)
    return np.clip(base[None, None, :] * shade[..., None], 0, 1)


def teak_texture(size, rng):
    """Golden teak boards: long planks along v, dark caulk seams, grain and a little sun bleach."""
    planks = 6
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    width = size / planks
    u = (xx % width) / width
    seam = smoothstep(0.0, 0.035, u) * smoothstep(1.0, 0.965, u)
    tone = rng.uniform(0.85, 1.12, planks)[(xx // width).astype(int) % planks]
    grain = 0.5 + 0.5 * np.sin(yy * 0.21 + fbm(size, size, 24, 4, rng, 2) * 7.0)
    bleach = smoothstep(0.6, 0.95, fbm(size, size, 6, 6, rng, 3))
    colour = np.array([0.47, 0.29, 0.13])[None, None, :] * tone[..., None]
    colour = colour * (0.78 + 0.22 * grain[..., None])
    colour = colour * (0.5 + 0.5 * seam[..., None])
    colour = colour * (1 - 0.18 * bleach[..., None])
    return np.clip(colour, 0, 1)


def canvas_texture(size, rng):
    """Woven canvas: a near-white cloth with a fine weave, soft folds and a few stains."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    weave = 0.5 + 0.25 * (np.sin(xx * 1.9) + np.sin(yy * 1.9))
    shade_fold = fbm(size, size, 5, 5, rng, 4)
    stain = smoothstep(0.7, 0.94, fbm(size, size, 9, 9, rng, 3))
    tone = 0.94 + 0.035 * (weave - 0.5) + 0.04 * (shade_fold - 0.5) - 0.06 * stain
    colour = np.array([0.95, 0.94, 0.9])[None, None, :] * tone[..., None]
    return np.clip(colour, 0, 1)


def metal_texture(size, rng):
    """Brushed aluminium: a cool grey with fine streaks along v and slight clouding."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    streak = value_noise(size, size, 256, 6, rng)
    cloud = fbm(size, size, 6, 6, rng, 3)
    shade = 0.9 + 0.1 * (streak - 0.5) + 0.05 * (cloud - 0.5)
    colour = np.array([0.6, 0.62, 0.65])[None, None, :] * shade[..., None]
    return np.clip(colour, 0, 1)


def glazing_texture(size, rng):
    """Old boat glass: near black with a few bright streaks and a little grime."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    streak = smoothstep(
        0.3, 0.8, np.sin((xx * 0.9 + yy * 0.25) / size * 8 + fbm(size, size, 8, 8, rng, 2) * 6)
    )
    grime = fbm(size, size, 24, 24, rng, 3)
    colour = np.array([0.03, 0.04, 0.055])[None, None, :] * (1 + 3.0 * streak[..., None])
    return np.clip(colour * (0.85 + 0.3 * grime[..., None]), 0, 1)


def stone_texture(size, rng):
    """Weathered sea stone: broad tones, dark cracks, a fine grain and a little pale lichen."""
    broad = fbm(size, size, 4, 4, rng, 6)
    cracks = 1 - smoothstep(0.0, 0.035, np.abs(fbm(size, size, 6, 6, rng, 4) - 0.5))
    grain = value_noise(size, size, 256, 256, rng)
    height = broad * 1.4 - cracks * 0.5 + grain * 0.12
    tone = 0.30 + 0.32 * broad - 0.14 * cracks + 0.07 * grain
    warm = fbm(size, size, 3, 3, rng, 3)
    colour = np.dstack([
        tone * (0.80 + 0.20 * warm),
        tone * (0.76 + 0.14 * warm),
        tone * (0.68 + 0.08 * warm),
    ])
    lichen = smoothstep(0.76, 0.95, fbm(size, size, 7, 7, rng, 3))
    pale = np.dstack([tone * 1.02, tone * 1.04, tone * 0.86])
    colour = colour * (1 - 0.3 * lichen[..., None]) + pale * (0.3 * lichen[..., None])
    rough = 0.8 + 0.15 * (1 - broad) + 0.1 * lichen
    return np.clip(colour, 0, 1), height, np.clip(rough, 0, 1)


def make_materials(rng):
    """The six materials that the props share, each with the maps it needs."""
    stone_colour, stone_height, stone_rough = stone_texture(512, rng)
    return {
        'gelcoat': material(
            'props-gelcoat', image('props-gelcoat', gelcoat_texture(256, rng)), roughness=1.0
        ),
        'teak': material('props-teak', image('props-teak', teak_texture(256, rng)), roughness=1.0),
        'canvas': material(
            'props-canvas', image('props-canvas', canvas_texture(256, rng)), roughness=0.92
        ),
        'metal': material(
            'props-metal', image('props-metal', metal_texture(256, rng)), roughness=0.42
        ),
        'glass': material(
            'props-glass', image('props-glass', glazing_texture(128, rng)), roughness=0.12
        ),
        'stone': material(
            'props-stone',
            image('props-stone', stone_colour),
            image('props-stone-normal', half(normal_map(stone_height, 1.2)), 'Non-Color'),
            image('props-stone-orm', half(orm(occlusion_of(stone_height, 8), stone_rough)),
                  'Non-Color'),
            roughness=1.0,
        ),
    }


# ---------------------------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------------------------

WHITE = (1.0, 1.0, 1.0)
DECK = (0.92, 0.9, 0.86)
INTERIOR = (0.62, 0.6, 0.56)
NAVY = (0.05, 0.11, 0.24)
RUBBER = (0.1, 0.1, 0.11)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(v):
    length = math.sqrt(_dot(v, v)) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def _average(points):
    n = len(points)
    return (
        sum(p[0] for p in points) / n,
        sum(p[1] for p in points) / n,
        sum(p[2] for p in points) / n,
    )


class Geo:
    """Faces of one material, in the scene's coordinates, drawn into a Builder in Blender's axes."""

    def __init__(self):
        self.builder = Builder(sway=False)

    def vertex(self, p, uv, color, normal):
        return self.builder.vertex(
            (p[0], -p[2], p[1]), uv, color, (normal[0], -normal[2], normal[1])
        )

    def face(self, points, color, tile=1.0, normal=None, uvs=None, normals=None, shade=1.0):
        """
        A face, counter-clockwise seen from outside. A given `normal` also turns the points' order
        right, so a caller may name them in any order, and the normals with them. Its texture
        coordinates run in meters along the face's own plane unless `uvs` gives them.
        """
        if len(points) < 3:
            return None
        turned = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
        if normal is not None and _dot(turned, normal) < 0:
            points = tuple(reversed(points))
            normals = None if normals is None else list(reversed(normals))
        n = normal or (_average(normals) if normals else _unit(turned))
        n = _unit(n)
        if abs(n[0]) >= abs(n[1]) and abs(n[0]) >= abs(n[2]):
            u_axis, v_axis = (0, 0, 1), (0, 1, 0)
        elif abs(n[1]) >= abs(n[2]):
            u_axis, v_axis = (1, 0, 0), (0, 0, 1)
        else:
            u_axis, v_axis = (1, 0, 0), (0, 1, 0)
        ids = []
        for k, p in enumerate(points):
            uv = uvs[k] if uvs is not None else (_dot(p, u_axis) / tile, _dot(p, v_axis) / tile)
            corner = tuple(c * shade for c in color)
            ids.append(self.vertex(p, uv, corner, normals[k] if normals else n))
        self.builder.face(*ids)
        return n

    def box(self, x0, y0, z0, x1, y1, z1, color, tile=1.0, top=True, bottom=False):
        """The box's faces, outward; `top` and `bottom` may leave a lid off."""
        if top:
            self.face([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], color, tile, (0, 1, 0))
        if bottom:
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], color, tile, (0, -1, 0))
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], color, tile, (0, 0, 1))
        self.face([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], color, tile, (0, 0, -1))
        self.face([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], color, tile, (1, 0, 0))
        self.face([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], color, tile, (-1, 0, 0))


def face_out(geo, points, centre, color, tile=1.0, shade=1.0):
    """A face whose normal points away from `centre`, whatever order the points come in."""
    middle = _average(points)
    n = _unit(_cross(_sub(points[1], points[0]), _sub(points[2], points[0])))
    if _dot(n, _sub(middle, centre)) < 0:
        points = list(reversed(points))
    return geo.face(points, color, tile, shade=shade)


def smooth_normals(rings):
    """The outward normal at each point of a loft, from the tangents along and around it."""
    out = []
    for i, ring in enumerate(rings):
        before = rings[max(0, i - 1)]
        after = rings[min(len(rings) - 1, i + 1)]
        row = []
        for j, p in enumerate(ring):
            along = after[j] - before[j]
            around = ring[min(j + 1, len(ring) - 1)] - ring[max(j - 1, 0)]
            row.append(_unit(_cross(tuple(around), tuple(along))))
        out.append(row)
    return out


def end_cap(geo, ring, inside, top_mid, color, tile=1.2):
    """
    A hull's end closes as a fan from the middle of its section, so its concave bilges leave no gap,
    and one more triangle closes the deck's camber above the section's straight top edge. The fan
    covers the edge that closes the section across its top, which is part of the outline too.
    """
    centre = Vector(_average(ring))
    for j in range(len(ring)):
        face_out(geo, [ring[j], ring[(j + 1) % len(ring)], centre], inside, color, tile)
    if top_mid is not None:
        face_out(geo, [ring[0], top_mid, ring[-1]], inside, color, tile)


def tube(geo, points, radii, sides, color, tile=1.0, caps=(True, True)):
    """A tube along points, with rings that turn with the path and smooth radial normals."""
    points = [Vector(p) for p in points]
    side, _ = frame_of(points[1] - points[0])
    rings, normals = [], []
    for i, p in enumerate(points):
        ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        d = ahead.normalized()
        side = side - d * side.dot(d)
        side = side.normalized() if side.length > 1e-6 else frame_of(d)[0]
        up = d.cross(side).normalized()
        ring, row = [], []
        for j in range(sides):
            a = TAU * j / sides
            radial = side * math.cos(a) + up * math.sin(a)
            ring.append(p + radial * radii[i])
            row.append(tuple(radial))
        rings.append(ring)
        normals.append(row)
    for i in range(len(rings) - 1):
        for j in range(sides):
            k = (j + 1) % sides
            pts = [rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]]
            norm = _average([normals[i][j], normals[i][k], normals[i + 1][k], normals[i + 1][j]])
            geo.face(pts, color, tile, normal=norm, normals=[
                normals[i][j], normals[i][k], normals[i + 1][k], normals[i + 1][j]
            ])
    if caps[0]:
        d = (points[0] - points[1]).normalized()
        for j in range(1, sides - 1):
            geo.face([rings[0][0], rings[0][j], rings[0][j + 1]], color, tile, normal=tuple(d))
    if caps[1]:
        d = (points[-1] - points[-2]).normalized()
        for j in range(1, sides - 1):
            geo.face([rings[-1][0], rings[-1][j], rings[-1][j + 1]], color, tile, normal=tuple(d))


def slab(geo, corners, thickness, color, tile=1.0):
    """A thin box whose mid-plane is the quad `corners`, wound around it."""
    n = _unit(_cross(_sub(corners[1], corners[0]), _sub(corners[2], corners[0])))
    up = [Vector(c) + Vector(n) * (thickness / 2) for c in corners]
    down = [Vector(c) - Vector(n) * (thickness / 2) for c in corners]
    centre = Vector(_average(corners))
    geo.face([tuple(p) for p in up], color, tile, normal=n)
    geo.face([tuple(p) for p in reversed(down)], color, tile, normal=tuple(-Vector(n)))
    for k in range(4):
        j = (k + 1) % 4
        face_out(geo, [tuple(up[k]), tuple(up[j]), tuple(down[j]), tuple(down[k])],
                 tuple(centre), color, tile)


# ---------------------------------------------------------------------------------------------
# The sailing yacht
# ---------------------------------------------------------------------------------------------

# Each station is its place along z, its half beam at the sheer, its sheer height, its waterline
# height and its keel. The sheer rises toward the bow, and the hull tapers to the stem.
YACHT_STATIONS = (
    (-4.60, 1.22, 0.94, 0.02, -0.26),
    (-3.70, 1.40, 1.00, 0.00, -0.36),
    (-2.60, 1.58, 1.04, 0.00, -0.42),
    (-1.20, 1.70, 1.06, 0.00, -0.44),
    (0.40, 1.68, 1.08, 0.00, -0.44),
    (1.90, 1.52, 1.12, 0.00, -0.40),
    (3.10, 1.22, 1.20, 0.04, -0.30),
    (4.00, 0.86, 1.28, 0.10, -0.12),
    (4.60, 0.44, 1.36, 0.20, 0.10),
    (5.00, 0.08, 1.44, 0.36, 0.36),
)


def yacht_hull(model, detail):
    """A round-bilge hull with a boot stripe, a cambered deck, a coachroof and dark glazing."""
    hull = model.shape('hull', 'gelcoat')
    deck = model.shape('deck', 'teak')
    cabin = model.shape('cabin', 'gelcoat')
    glass = model.shape('glass', 'glass')
    stations = {
        0: YACHT_STATIONS,
        1: tuple(YACHT_STATIONS[i] for i in (0, 2, 4, 6, 8, 9)),
        2: tuple(YACHT_STATIONS[i] for i in (0, 3, 6, 9)),
    }[detail]
    fine = detail == 0
    rings = []
    for z, w, sheer, waterline, keel in stations:
        if fine:
            entries = (
                (sheer, 1.0, 'top'),
                (sheer - 0.14, 0.988, 'top'),
                (waterline + 0.30, 0.968, 'top'),
                (waterline + 0.16, 0.958, 'stripe'),
                (waterline + 0.06, 0.944, 'stripe'),
                (keel + 0.28, 0.62, 'bottom'),
                (keel, 0.0, 'bottom'),
            )
        else:
            entries = (
                (sheer, 1.0, 'top'),
                (waterline + 0.18, 0.96, 'top'),
                (keel + 0.30, 0.60, 'bottom'),
                (keel, 0.0, 'bottom'),
            )
        port = [Vector((-w * share, y, z)) for y, share, _ in entries]
        starboard = [Vector((w * share, y, z)) for y, share, _ in reversed(entries[:-1])]
        rings.append(port + starboard)
    normals = smooth_normals(rings)
    bands = len(rings[0]) - 1
    stripes = {3, 8} if fine else set()
    for i in range(len(rings) - 1):
        for j in range(bands):
            colour = NAVY if j in stripes else WHITE
            pts = [rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]]
            norm = _average([normals[i][j], normals[i][j + 1], normals[i + 1][j + 1], normals[i + 1][j]])
            hull.face(pts, colour, 1.2, normal=norm, normals=[
                normals[i][j], normals[i][j + 1], normals[i + 1][j + 1], normals[i + 1][j]
            ])
    # The transom closes the stern, and the stem closes the bow.
    stern = rings[0]
    z0 = stations[0][0]
    end_cap(hull, stern, (0, stations[0][2], z0 + 1),
            Vector((0, stations[0][2] + 0.05, z0)), WHITE)
    bow = rings[-1]
    z1 = stations[-1][0]
    end_cap(hull, bow, (0, stations[-1][2], z1 - 1),
            Vector((0, stations[-1][2] + 0.05, z1)), WHITE)
    # The deck spans the sheer line, cambered a little across.
    for i in range(len(stations) - 1):
        z_a, _, sheer_a, _, _ = stations[i]
        z_b, _, sheer_b, _, _ = stations[i + 1]
        a0, a1 = rings[i][0], rings[i][-1]
        b0, b1 = rings[i + 1][0], rings[i + 1][-1]
        ca = Vector((0, sheer_a + 0.05, z_a))
        cb = Vector((0, sheer_b + 0.05, z_b))
        deck.face([a0, b0, cb, ca], DECK, 1.0, normal=(0, 1, 0))
        deck.face([ca, cb, b1, a1], DECK, 1.0, normal=(0, 1, 0))
    # The coachroof: a box on the deck with raked sides and a raked windscreen. Its foot lies just
    # under the deck, so no slit shows along the join.
    base = [Vector((-1.02, 0.98, -2.95)), Vector((1.02, 0.98, -2.95)),
            Vector((1.02, 0.98, 1.50)), Vector((-1.02, 0.98, 1.50))]
    top = [Vector((-0.86, 1.52, -2.80)), Vector((0.86, 1.52, -2.80)),
           Vector((0.86, 1.52, 0.95)), Vector((-0.86, 1.52, 0.95))]
    roof_centre = (0.0, 1.3, -0.7)
    cabin.face([tuple(p) for p in top], WHITE, 1.0, normal=(0, 1, 0))
    for k in range(4):
        j = (k + 1) % 4
        face_out(cabin, [tuple(base[k]), tuple(base[j]), tuple(top[j]), tuple(top[k])],
                 roof_centre, WHITE, 1.0)
    if detail <= 1:
        def side_x(y):
            return 1.02 - (y - 0.98) * (0.16 / 0.54)

        for side in (-1, 1):
            glass.face([
                (side * (side_x(1.14) + 0.012), 1.14, -2.55),
                (side * (side_x(1.14) + 0.012), 1.14, 0.30),
                (side * (side_x(1.36) + 0.012), 1.36, 0.30),
                (side * (side_x(1.36) + 0.012), 1.36, -2.55),
            ], WHITE, 1.0, normal=(side, 0, 0))
        if detail == 0:
            # The windscreen lies on the raked front, between the two side strips.
            glass.face([
                (-0.70, 1.16, 1.327), (0.70, 1.16, 1.327),
                (0.70, 1.40, 1.082), (-0.70, 1.40, 1.082),
            ], WHITE, 1.0, normal=(0, 0.4, 0.92))


def yacht_rig(model, detail):
    """The mast, the boom and the standing rigging, all in brushed metal, and a furled mainsail."""
    rig = model.shape('rig', 'metal')
    sail = model.shape('sail', 'canvas')
    masthead = (0, 12.1, 0.74)
    tube(rig, [(0, 1.50, 0.90), (0, 7.0, 0.82), masthead],
         [0.075, 0.05, 0.035], 6 if detail == 0 else 4, WHITE, 0.6)
    tube(rig, [(0, 2.12, 0.82), (0, 2.12, -3.25)], [0.06, 0.05], 5, WHITE, 0.6)
    stays = [
        (masthead, (0, 1.55, 4.96)),      # the forestay
        (masthead, (0, 1.00, -4.55)),     # the backstay
    ]
    if detail <= 1:
        stays += [
            (masthead, (1.02, 1.12, 0.35)),
            (masthead, (-1.02, 1.12, 0.35)),
        ]
    if detail == 0:
        stays += [
            ((0, 6.6, 0.8), (1.05, 1.12, -1.6)),
            ((0, 6.6, 0.8), (-1.05, 1.12, -1.6)),
        ]
    for a, b in stays:
        tube(rig, [a, b], [0.012, 0.012], 3, WHITE, 0.4, caps=(False, False))
    if detail <= 1:
        # The mainsail furls along the boom, thickest at its foot.
        if detail == 0:
            tube(sail, [(0, 2.28, -3.02), (0, 2.28, -1.2), (0, 2.28, 0.72)],
                 [0.08, 0.16, 0.09], 5, WHITE, 0.8)
        else:
            tube(sail, [(0, 2.28, -3.0), (0, 2.28, 0.7)], [0.11, 0.09], 4, WHITE, 0.8)


def yacht(model, detail):
    """An eight to ten meter sailing yacht at anchor, its bow toward +z and its waterline at y = 0."""
    yacht_hull(model, detail)
    yacht_rig(model, detail)


# ---------------------------------------------------------------------------------------------
# The open fishing boat
# ---------------------------------------------------------------------------------------------

SKIFF_STATIONS = (
    (-2.40, 0.76, 0.62, -0.14),
    (-1.40, 0.84, 0.64, -0.19),
    (-0.20, 0.86, 0.66, -0.21),
    (1.00, 0.76, 0.70, -0.19),
    (1.90, 0.50, 0.76, -0.10),
    (2.55, 0.16, 0.84, 0.16),
)


def skiff_hull(model, detail):
    """A small open boat: a painted shell with a dark inside, floorboards, thwarts and a gunwale."""
    hull = model.shape('hull', 'gelcoat')
    wood = model.shape('wood', 'teak')
    stations = {
        0: SKIFF_STATIONS,
        1: tuple(SKIFF_STATIONS[i] for i in (0, 2, 3, 4, 5)),
        2: tuple(SKIFF_STATIONS[i] for i in (0, 2, 4, 5)),
    }[detail]
    fine = detail == 0
    rings = []
    for z, w, top, keel in stations:
        if fine:
            entries = ((top, 1.0), (top - 0.30, 0.94), (keel + 0.16, 0.62), (keel, 0.0))
        else:
            entries = ((top, 1.0), (keel + 0.18, 0.66), (keel, 0.0))
        port = [Vector((-w * share, y, z)) for y, share in entries]
        starboard = [Vector((w * share, y, z)) for y, share in reversed(entries[:-1])]
        rings.append(port + starboard)
    normals = smooth_normals(rings)
    bands = len(rings[0]) - 1
    for i in range(len(rings) - 1):
        for j in range(bands):
            pts = [rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]]
            norm = _average([normals[i][j], normals[i][j + 1], normals[i + 1][j + 1], normals[i + 1][j]])
            hull.face(pts, WHITE, 1.0, normal=norm, normals=[
                normals[i][j], normals[i][j + 1], normals[i + 1][j + 1], normals[i + 1][j]
            ])
            # The inside of the open hull shows, so each face also draws a smaller reversed copy.
            axes = [(0, (stations[i][2] + stations[i][3]) / 2, stations[i][0]),
                    (0, (stations[i + 1][2] + stations[i + 1][3]) / 2, stations[i + 1][0])]
            inner = []
            for n, p in enumerate(pts):
                axis = Vector(axes[0] if n < 2 else axes[1])
                inward = axis - Vector(p)
                inner.append(tuple(Vector(p) + inward.normalized() * 0.035) if inward.length > 1e-4 else p)
            hull.face(list(reversed(inner)), INTERIOR, 1.0,
                      normal=tuple(-Vector(norm)), shade=1.0)
    z0 = stations[0][0]
    end_cap(hull, rings[0], (0, stations[0][2], z0 + 1), None, WHITE, 1.0)
    # The inside of the transom lies just forward of its outside, so both show from their own side.
    end_cap(hull, [Vector(p) + Vector((0, 0, 0.05)) for p in rings[0]],
            (0, stations[0][2], z0 - 1), None, INTERIOR, 1.0)
    z1 = stations[-1][0]
    end_cap(hull, rings[-1], (0, stations[-1][2], z1 - 1), None, WHITE, 1.0)
    # The gunwale caps the wall, and the floorboards lie over the inside.
    for i in range(len(rings) - 1):
        for j in (0, len(rings[0]) - 1):
            outer, inner = rings[i][j], rings[i + 1][j]
            inward = 0.06 if j == 0 else -0.06
            wood.face([outer, inner, (inner[0] + inward, inner[1] + 0.03, inner[2]),
                       (outer[0] + inward, outer[1] + 0.03, outer[2])],
                      WHITE, 0.8, normal=(0, 1, 0))
    wood.face([(-0.52, -0.02, -1.95), (0.52, -0.02, -1.95),
               (0.40, -0.02, 1.30), (-0.40, -0.02, 1.30)], WHITE, 0.8, normal=(0, 1, 0))
    # Thwarts across the boat at three places.
    for z, half in (((-1.55, 0.70), (-0.35, 0.78), (0.85, 0.66)) if detail == 0 else
                    (((-1.25, 0.73), (0.55, 0.72)) if detail == 1 else ((-0.3, 0.76),))):
        wood.box(-half, 0.30, z - 0.11, half, 0.35, z + 0.11, WHITE, 0.8, bottom=True)
    # The bow deck closes the fore part of the shell.
    wood.face([(-0.30, 0.76, 1.9), (0.30, 0.76, 1.9), (0.05, 0.86, 2.55),
               (-0.05, 0.86, 2.55)], WHITE, 0.8, normal=(0, 1, 0))


def skiff_engine(model, detail):
    """An outboard on the transom: its cowl, its shaft and its skeg."""
    engine = model.shape('engine', 'metal')
    engine.box(-0.15, 0.60, -2.66, 0.15, 0.92, -2.38, WHITE, 0.6, top=True, bottom=True)
    engine.box(-0.055, -0.24, -2.62, 0.055, 0.62, -2.48, RUBBER, 0.5, top=False, bottom=True)
    if detail == 0:
        engine.box(-0.09, -0.30, -2.68, 0.09, -0.22, -2.36, RUBBER, 0.5)
        engine.box(-0.02, -0.06, -2.56, 0.02, 0.02, -2.48, WHITE, 0.4, top=False, bottom=False)


def skiff(model, detail):
    """A four to six meter open fishing boat, its bow toward +z and its waterline at y = 0."""
    skiff_hull(model, detail)
    skiff_engine(model, detail)


# ---------------------------------------------------------------------------------------------
# The boulders
# ---------------------------------------------------------------------------------------------


def rock(model, detail, height, radius, stretch_x, stretch_z, lean):
    """
    An irregular stone: lumpy rings from a broad base to a low broken top, closed above and below.
    The origin is the stone's lowest point, so a copy stands on the ground it is placed on. Each
    ring shifts its angle and its place, so no facet runs the whole height and the stone never
    reads as a turned shape.
    """
    stone = model.shape('stone', 'stone')
    rings_n, sides = {0: (6, 8), 1: (4, 6), 2: (3, 5)}[detail]
    levels = {
        6: (0.0, 0.16, 0.36, 0.58, 0.78, 0.90),
        4: (0.0, 0.26, 0.58, 0.90),
        3: (0.0, 0.46, 0.90),
    }[rings_n]
    phase = 0.6
    rings = []
    for r, t in enumerate(levels):
        profile = (1 - t**2.2) ** 0.42
        shift_x = radius * 0.08 * math.sin(r * 1.7 + 0.5)
        shift_z = radius * 0.06 * math.cos(r * 2.1 + 0.2)
        row = []
        for k in range(sides):
            a = TAU * k / sides + phase + r * 0.35
            lump = (1 + 0.24 * math.sin(2 * a + 0.7) + 0.14 * math.sin(3 * a + 2.1)
                    + 0.09 * math.sin(5 * a + 0.3) + 0.05 * math.sin(7 * a + 1.1))
            rr = radius * profile * lump
            x = math.cos(a) * rr * stretch_x + shift_x + lean[0] * t * t
            z = math.sin(a) * rr * stretch_z + shift_z + lean[1] * t * t
            y = height * t + 0.05 * height * math.sin(3 * a + r * 0.9) * (1 - t) ** 1.5
            row.append(Vector((x, y, z)))
        rings.append(row)
    centre = Vector((lean[0] * 0.25, height * 0.38, lean[1] * 0.25))
    top = Vector((lean[0], height * 0.985, lean[1]))

    def tone(a, b):
        return 0.72 + (((a * 37 + b * 91 + 17) % 100) / 100) * 0.28

    for r in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            face_out(stone, [rings[r][k], rings[r][k2], rings[r + 1][k2], rings[r + 1][k]],
                     centre, WHITE, 1.2, tone(k, r))
    for k in range(sides):
        k2 = (k + 1) % sides
        face_out(stone, [rings[-1][k], rings[-1][k2], top], centre, WHITE, 1.2, tone(k, 9))
        face_out(stone, [rings[0][k2], rings[0][k], Vector((0, 0, 0))], centre, WHITE, 1.2,
                 tone(k, 1) * 0.75)


def rock_a(model, detail):
    """A broad squat boulder."""
    rock(model, detail, 1.05, 0.95, 1.12, 1.0, (0.10, -0.05))


def rock_b(model, detail):
    """A long low ledge stone."""
    rock(model, detail, 0.78, 1.10, 1.45, 0.82, (-0.15, 0.08))


def rock_c(model, detail):
    """A taller angular stone."""
    rock(model, detail, 1.55, 0.74, 0.96, 1.08, (0.12, 0.10))


# ---------------------------------------------------------------------------------------------
# The small props
# ---------------------------------------------------------------------------------------------


def parasol(model, detail):
    """A canvas beach parasol on a timber pole, its rim scalloped as real canvas sags."""
    pole = model.shape('pole', 'teak')
    canvas = model.shape('canvas', 'canvas')
    sides = 12
    hub = Vector((0, 2.60, 0))
    mid_ring, rim_ring = [], []
    for k in range(sides):
        a = TAU * k / sides
        mid_ring.append(Vector((math.sin(a) * 0.56, 2.30, math.cos(a) * 0.56)))
        scallop = 0.0 if k % 2 else 1.0
        rim_ring.append(Vector((math.sin(a) * (1.40 + 0.04 * scallop),
                                2.02 + 0.06 * scallop, math.cos(a) * (1.40 + 0.04 * scallop))))
    top_centre = (0.0, 2.05, 0.0)

    def panel(points, shade):
        n = face_out(canvas, points, top_centre, WHITE, 0.45, shade)
        # The underside shows from below, so it draws its own darker face the other way.
        canvas.face(list(reversed(points)), WHITE, 0.45, normal=(-n[0], -n[1], -n[2]),
                    shade=shade * 0.72)

    for k in range(sides):
        k2 = (k + 1) % sides
        panel([hub, mid_ring[k], mid_ring[k2]], 1.0)
        panel([mid_ring[k], rim_ring[k], rim_ring[k2], mid_ring[k2]], 1.0)
    tube(pole, [(0, 0, 0), (0, 2.58, 0)], [0.034, 0.030], 6, WHITE, 0.8)
    tube(pole, [(0, 2.58, 0), (0, 2.74, 0)], [0.030, 0.018], 5, WHITE, 0.5, caps=(False, True))


def lounger(model, detail):
    """A timber sun lounger with a canvas sling and a raised back."""
    frame = model.shape('frame', 'teak')
    fabric = model.shape('fabric', 'canvas')
    for x in (-0.36, 0.30):
        frame.box(x, 0.24, -0.92, x + 0.06, 0.30, 0.40, WHITE, 0.7)
        frame.box(x, 0.10, 0.40, x + 0.06, 0.66, 0.46, WHITE, 0.7)
    for x, z in ((-0.34, -0.80), (-0.34, 0.26), (0.32, -0.80), (0.32, 0.26)):
        frame.box(x, 0, z, x + 0.05, 0.26, z + 0.05, WHITE, 0.6, top=False)
    frame.box(-0.36, 0.20, -0.92, 0.36, 0.25, -0.86, WHITE, 0.6)
    fabric.box(-0.31, 0.30, -0.90, 0.31, 0.335, 0.40, WHITE, 0.7)
    slab(fabric, [(-0.31, 0.335, 0.40), (0.31, 0.335, 0.40),
                  (0.31, 0.64, 0.88), (-0.31, 0.64, 0.88)], 0.035, WHITE, 0.7)


def bench(model, detail):
    """A harbour bench of timber slats on iron end frames."""
    timber = model.shape('timber', 'teak')
    iron = model.shape('iron', 'metal')
    for k in range(4):
        z = -0.23 + k * 0.125
        timber.box(-0.92, 0.43, z, 0.92, 0.475, z + 0.11, WHITE, 0.7, top=True, bottom=True)
    for k in range(3):
        y = 0.56 + k * 0.135
        timber.box(-0.92, y, -0.30, 0.92, y + 0.10, -0.26, WHITE, 0.7, bottom=True)
    for x in (-0.86, 0.78):
        iron.box(x, 0, -0.24, x + 0.08, 0.43, -0.16, WHITE, 0.5, top=False)
        iron.box(x, 0, 0.12, x + 0.08, 0.43, 0.20, WHITE, 0.5, top=False)
        iron.box(x, 0.43, -0.30, x + 0.08, 0.93, -0.24, WHITE, 0.5, top=False)
        iron.box(x, 0.43, -0.33, x + 0.08, 0.48, 0.22, WHITE, 0.5, top=False)


# ---------------------------------------------------------------------------------------------
# The forms, and the parts that each one builds
# ---------------------------------------------------------------------------------------------

# Each row is the form's name, the function that builds it, the parts it may build and whether a
# view picks lower levels of it. The sail and the glazing of a distant yacht may be left out.
FORMS = (
    ('yacht', yacht, ('hull', 'deck', 'cabin', 'glass', 'rig', 'sail'), True),
    ('skiff', skiff, ('hull', 'wood', 'engine'), True),
    ('rock-a', rock_a, ('stone',), True),
    ('rock-b', rock_b, ('stone',), True),
    ('rock-c', rock_c, ('stone',), True),
    ('parasol', parasol, ('canvas', 'pole'), False),
    ('lounger', lounger, ('frame', 'fabric'), False),
    ('bench', bench, ('timber', 'iron'), False),
)


class Model:
    """The parts of one form, each a Geo of one shared material."""

    def __init__(self, mats):
        self.mats = mats
        self.parts = {}
        self.material_of = {}

    def shape(self, part, material_name):
        self.material_of.setdefault(part, material_name)
        return self.parts.setdefault(part, Geo())

    def objects(self, name, level=None):
        suffix = '' if level is None else f'-{level}'
        made = []
        for part, geo in self.parts.items():
            if not geo.builder.faces:
                continue
            made.append(geo.builder.build(f'{name}-{part}{suffix}', self.mats[self.material_of[part]]))
        return made


def build(mats, form, make, parts, leveled):
    """A form's objects at every level, the nearest one first."""
    steps = ((None, 0), (1, 1), (2, 2)) if leveled else ((None, 0),)
    levels = []
    for level, detail in steps:
        model = Model(mats)
        make(model, detail)
        if not set(model.parts) <= set(parts):
            raise SystemExit(f'{form}-{level}: built {sorted(model.parts)}, outside {parts}')
        if level is None and set(model.parts) != set(parts):
            raise SystemExit(f'{form}: built {sorted(model.parts)}, missing {sorted(set(parts) - set(model.parts))}')
        levels.append(model.objects(form, level))
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
    """The greatest distance in either direction between the two levels' surfaces, in meters."""
    high_surface = np.concatenate([_triangles_of(o) for o in fine])
    low_surface = np.concatenate([_triangles_of(o) for o in coarse])
    up = _furthest(fine, low_surface)
    down = _furthest(coarse, high_surface)
    return up if up[0] >= down[0] else down


def measure(levels, form):
    """Each lower level's worst measured surface error, and the lines that report them."""
    errors, notes = [], []
    for index in (1, 2):
        error, where = measured_error(levels[0], levels[index])
        notes.append(f'ISLAND-PROPS {form}: level {index} measured error {error:.3f} m at {where}')
        errors.append(error)
    for note in notes:
        print(note)
    return errors, notes


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


def spread(groups, gap=3.0):
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
    """Each form alone, a rock group, a close harbour row and the boats at gameplay distance."""
    for form, group in near.items():
        low, high = bounds(group)
        depth = high[2] - low[2]
        width = high[0] - low[0]
        middle = centre(group)
        frame_shot(group, os.path.join(shots, f'{form}.png'), (-0.6, 0.42, 0.68),
                   max(3.2, 2.0 * max(width, depth, high[1] - low[1])),
                   target=(middle[0], max(0.5, middle[1]), middle[2]), size=(820, 620))
    at_distance([near['rock-a'], near['rock-b'], near['rock-c']],
                os.path.join(shots, 'rocks-row.png'), 22, 1.2)
    # The harbour front: a yacht and a fishing boat at the range a visitor meets them, with a bench.
    at_distance([near['yacht'], near['skiff'], near['bench']],
                os.path.join(shots, 'harbour-row.png'), 34, 2.0)
    # A boat at gameplay distance, as the page draws it there: 45 degrees down a 1,080 pixel screen.
    at_distance([near['yacht']], os.path.join(shots, 'yacht-distance.png'), 80, 2.0)
    at_distance([near['skiff']], os.path.join(shots, 'skiff-distance.png'), 55, 2.0)
    at_distance([near['parasol'], near['lounger']],
                os.path.join(shots, 'beach-row.png'), 20, 1.5)
    # The yacht's two ends straight on, where a face turned the wrong way would show as a hole.
    frame_shot(near['yacht'], os.path.join(shots, 'yacht-stern.png'), (0, 0.1, -1), 13,
               target=(0, 1.5, -3.6), size=(700, 560))
    frame_shot(near['yacht'], os.path.join(shots, 'yacht-bow.png'), (0, 0.1, 1), 13,
               target=(0, 1.5, 3.6), size=(700, 560))
    groups = [near[form] for form, _, _, _ in FORMS]
    spread(groups, 2.5)
    flat = [o for group in groups for o in group]
    frame_shot(flat, os.path.join(shots, 'lineup.png'), (-0.5, 0.36, 0.78), 46,
               target=(0, 2.2, 0), size=(1500, 620))
    reset(groups)


def main():
    out, shots = arguments('island-props.py')
    rng = np.random.default_rng(SEED)
    mats = make_materials(rng)
    notes = []

    def note(text):
        print(text)
        notes.append(text)

    everything, near, levels_by_form = [], {}, {}
    for form, make, parts, leveled in FORMS:
        levels = build(mats, form, make, parts, leveled)
        near[form] = levels[0]
        levels_by_form[form] = levels
        everything += [o for level in levels for o in level]
    # The measured error of each lower level, from the nearest level's surface, sets where a view
    # switches to it. Round up, so the file never claims a level closer than it draws.
    errors = [0.0, 0.0]
    for form, levels in levels_by_form.items():
        if len(levels) == 3:
            measured, lines = measure(levels, form)
            notes += lines
            errors = [max(a, b) for a, b in zip(errors, measured)]
    errors = [math.ceil(value * 20) / 20 for value in errors]
    note(f'ISLAND-PROPS level errors: {errors[0]:.2f} m, {errors[1]:.2f} m')
    report = export(os.path.join(out, 'props.glb'), everything, set(), errors)
    for form, _, _, _ in FORMS:
        parts = sorted(k for k in report if k.startswith(f'{form}-'))
        note(f'ISLAND-PROPS {form}: ' + ', '.join(f'{k} {report[k]}' for k in parts))
    size = os.path.getsize(os.path.join(out, 'props.glb'))
    note(f'ISLAND-PROPS props.glb: {size} bytes')
    for form, objects in near.items():
        low, high = bounds(objects)
        note(f'ISLAND-PROPS {form}: {high[1] - low[1]:.2f} m high, '
             f'{high[0] - low[0]:.2f} x {high[2] - low[2]:.2f} m')
    if shots:
        shoot(near, shots)
        with open(os.path.join(shots, 'report.txt'), 'w') as handle:
            handle.write('\n'.join(notes) + '\n')


main()
