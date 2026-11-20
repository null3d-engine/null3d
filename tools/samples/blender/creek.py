# Builds the organic models of the Creek showcase scene in Blender: three broadleaf trees, four
# plants for the banks and a rocky cave mouth. Everything comes from this script and a fixed seed:
# the shapes, and every texture, which numpy paints. Nothing is downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/creek.py -- <output folder> [--preview <folder>]
#
# `bun tools/samples/blender/creek.ts <folder>` runs it and optimizes the files for the scene.
#
# It writes three binary glTF files into the output folder, and prints each model's triangles:
#   trees.glb   oak, beech and birch, each a wood node and a leaves node, with lower levels of
#               detail (MSFT_lod): fewer, larger leaf cards and fewer, plainer branches
#   plants.glb  fern, hosta, shrub and flowers, one node each
#   cave.glb    cave, one node
# Leaves, fronds and plant leaves are cards whose texture's alpha cuts their outline, so their
# materials are masked and double sided. The wood, the plants and the rock carry ambient occlusion
# and tints in their vertex colors, which glTF multiplies into the base color. The trees and plants
# carry their sway in their second texture coordinates, as `common.py` says; the cave stands still.
# --preview also renders each model with Cycles, for a quick look without the engine.
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# The shared module loads from beside this script, and leaves no bytecode cache in the repository.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Builder, arguments, at_distance, blend_up, branch_phase, close_up, dilate, export, fbm, frame_of, half, image,
    leaf_color, leaf_mask, link, material, normal_map, occlusion_of, orm, over, preview, smoothstep, sprig_atlas,
    strip, tent, tube, value_noise,
)

SEED = 20261011

# ---------------------------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------------------------

def leaf_atlas(size, rng):
    """
    Four dense sprays of small broad leaves on branching twigs, in the cells of a 2 x 2 atlas. Each twig
    runs up its cell from the middle of its bottom edge, so a card's base sits on its branch, and
    side twigs carry leaves out from it, so a spray reads as many leaves, not one sheet. Every leaf
    stays inside its cell, so no card shows a straight edge.
    """
    tones = ([0.30, 0.46, 0.13], [0.36, 0.50, 0.14], [0.27, 0.42, 0.15], [0.40, 0.52, 0.17])
    return sprig_atlas(size, rng, 84, 0.14, 0.38, tones, 0.0, [0.30, 0.24, 0.16], 0.72, (0.5, 1.5), 7)


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


def flower_atlas(size, rng):
    """
    Wildflowers in a 2 x 2 atlas: a daisy, a buttercup and a cornflower, each seen from above, and a
    cell of green with a broad lobed basal leaf on its left and a stem stripe on its right.
    """
    cell = size // 2
    out = np.zeros((size, size, 4), np.float32)
    py, px = np.mgrid[0:cell, 0:cell].astype(np.float32) / cell
    dx, dy = px - 0.5, py - 0.5
    r = np.hypot(dx, dy) / 0.46
    theta = np.arctan2(dy, dx)
    mottle = value_noise(cell, cell, 16, 16, rng)
    kinds = [
        # Petals, their reach, their width, their color, the disc's size and color, notched tips.
        (16, 1.0, 0.11, [0.95, 0.94, 0.88], 0.26, [0.95, 0.72, 0.1], 0.0),
        (5, 0.9, 0.55, [0.98, 0.8, 0.08], 0.2, [0.75, 0.6, 0.1], 0.0),
        (10, 0.95, 0.3, [0.22, 0.38, 0.92], 0.18, [0.2, 0.15, 0.45], 0.25),
    ]
    for k, (petals, reach, width, color, disc, center, notch) in enumerate(kinds):
        tile = np.zeros((cell, cell, 4), np.float32)
        nearest = np.abs(((theta * petals / (2 * np.pi)) + 0.5) % 1 - 0.5) * 2 * np.pi / petals
        along = np.clip(r / reach, 0, 1)
        half = width * np.maximum(np.sin(np.pi * along ** 0.8), 0) ** 0.6
        tip = 1 - notch * np.maximum(np.cos(nearest * petals * 3), 0) * smoothstep(0.7, 1.0, along)
        coverage = np.clip((half - nearest * r) * cell / 2 + 0.5, 0, 1) * (r < reach * tip)
        shade = 0.8 + 0.25 * along + 0.1 * (mottle - 0.5)
        over(tile, np.array(color)[None, None] * shade[..., None], coverage)
        disc_cover = np.clip((disc - r) * cell / 2 + 0.5, 0, 1)
        over(tile, np.array(center)[None, None] * (0.75 + 0.4 * mottle[..., None]), disc_cover)
        oy, ox = (k // 2) * cell, (k % 2) * cell
        out[oy:oy + cell, ox:ox + cell] = tile
    # The green cell: a broad leaf with lobed edges up its left part, widest toward its tip as an
    # oxeye daisy's basal leaf is, and a stem stripe at its right edge.
    tile = np.zeros((cell, cell, 4), np.float32)
    coverage, s, t = leaf_mask(px, py, (0.36, 0.02), math.pi / 2, 0.95, 0.3, 0.12, cell / 2, 0.85)
    over(tile, leaf_color(s, t, np.array([0.2, 0.38, 0.1]), mottle), coverage)
    stem = np.clip((0.04 - np.abs(px - 0.82)) * cell / 2 + 0.5, 0, 1)
    over(tile, np.array([0.24, 0.4, 0.12])[None, None] * (0.8 + 0.3 * py[..., None]), stem)
    out[cell:, cell:] = tile
    return dilate(out)


# ---------------------------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------------------------

# Each tree's shape. `cards` are the leaf sprays on each twig of the outermost branches, `card` is a
# spray's size in meters, and `inner` adds sprays along the branches one level in, which fill the
# crown's depth and shade darker, as a full crown's inside does. `fill` adds sprays where the crown's
# rounded outline has a hole between its limbs.
TREES = {
    'oak': dict(
        height=7.2, radius=0.3, flare=0.7, crown=0.34, children=(7, 5, 4), angles=(62, 48, 42),
        ratio=(0.6, 0.55, 0.5), tropism=(0.12, 0.08, 0.0), wobble=0.22, cards=46, card=0.48, inner=24, fill=900,
        tint=(0.86, 0.95, 0.82), bark='oak', sides=(12, 7, 5, 3),
    ),
    'beech': dict(
        height=8.6, radius=0.24, flare=0.45, crown=0.3, children=(8, 5, 4), angles=(44, 40, 36),
        ratio=(0.5, 0.55, 0.5), tropism=(0.25, 0.15, 0.05), wobble=0.14, cards=46, card=0.45, inner=24, fill=250,
        tint=(1.0, 1.0, 0.88), bark='beech', sides=(10, 6, 4, 3),
    ),
    'birch': dict(
        height=7.8, radius=0.14, flare=0.3, crown=0.32, children=(9, 4, 3), angles=(48, 52, 58),
        ratio=(0.46, 0.6, 0.55), tropism=(0.1, -0.12, -0.28), wobble=0.18, cards=32, card=0.31,
        tint=(1.08, 1.06, 0.72), bark='birch', sides=(9, 5, 4, 3),
    ),
}


# The trees' lower levels of detail, from the finest down. Each keeps one card in `every` of the
# full tree's, larger by `grow` so the crown stays as full, and draws branches up to `branches`
# levels deep with `sides` fewer sides each (three at least). The cards grow little, so a crown's
# leaves keep nearly one size from near to far: the scene stands few trees, and its views reach
# them from 25 m on. `error` is the level's surface error in meters, which the engine compares with
# the size of a pixel at the tree's distance: on a screen 1,080 pixels high, at the scene's 45
# degree view, a pixel spans 0.00077 m per meter away, so these switch about 50 m and 100 m away.
TREE_LEVELS = (
    dict(every=3, grow=1.5, branches=2, sides=2, error=0.038),
    dict(every=8, grow=2.2, branches=1, sides=4, error=0.077),
)


# The sway that a branch's own reach adds at its tip, over the height share, by its depth in the
# tree: a twig swings more than the bough it grows from. A leaf card at the crown's rim adds its own.
BRANCH_FREEDOM = 0.25
LEAF_FREEDOM = 0.2


def tree_top(branches):
    """The height of a tree's highest branch point, which its sway weights are shares of."""
    return max(p.z for points, _, _ in branches for p in points)


def grow_tree(spec, rng):
    """The branches of a tree, as (points, radii, level), and its leaf cards' places and branches."""
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
                cards.append((p, d, len(branches) - 1))
            return
        if level == last - 1:
            p, d, _ = at(points, radii, 1.0)
            cards.append((p, d, len(branches) - 1))
            for _ in range(spec.get('inner', 0)):
                p, d, _ = at(points, radii, 0.3 + 0.7 * rng.random())
                cards.append((p, d, len(branches) - 1))
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


def fill_crown(spec, branches, cards, rng):
    """
    Sprays for the holes in a crown: points in the outer part of the ellipsoid that the crown's
    sprays span, each kept only where no spray lies within a spray's reach, and hung from the
    branch of the nearest spray, facing out of the crown. A park tree's crown then reads as one
    rounded mass, not as tufts on separate limbs.
    """
    wanted = spec.get('fill', 0)
    if not wanted:
        return []
    places = np.array([tuple(p) for p, _, _ in cards])
    middle = places.mean(axis=0)
    reach = np.percentile(np.abs(places - middle), 95, axis=0) * 1.05
    tree = KDTree(len(cards))
    for k, (p, _, _) in enumerate(cards):
        tree.insert(p, k)
    tree.balance()
    gap = spec['card'] * 1.1
    # The filled places by grid cell of the gap's size, so a new place checks only its neighbors.
    taken = {}
    added = []
    tries = 0
    while len(added) < wanted and tries < wanted * 30:
        tries += 1
        n = Vector(rng.normal(0, 1, 3)).normalized()
        shell = 0.55 + 0.45 * rng.random() ** 0.5
        p = Vector(middle) + Vector((n.x * reach[0], n.y * reach[1], n.z * reach[2])) * shell
        if p.z < 1.8:
            continue
        _, nearest, distance = tree.find(p)
        if distance < gap:
            continue
        cell = tuple(int(math.floor(c / gap)) for c in p)
        near = (
            q for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
            for q in taken.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), ())
        )
        if any((q - p).length < gap for q in near):
            continue
        taken.setdefault(cell, []).append(p)
        added.append((p, (n + Vector((0, 0, 0.5))).normalized(), cards[nearest][2]))
    return added


def tree_wood(spec, branches, rng, depth=None, fewer=0):
    """The wood of a tree: its branches down to `depth` levels, with `fewer` sides each."""
    wood = Builder()
    top = tree_top(branches)
    for index, (points, radii, level) in enumerate(branches):
        if depth is not None and level > depth:
            continue
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
        sides = max(3, spec['sides'][min(level, 3)] - fewer)
        # The trunk bends from its foot, and each branch swings a little more toward its tip.
        sway_of = lambda p, t, level=level, index=index: (
            max(0.0, p.z) / top + BRANCH_FREEDOM * min(level, 3) / 3 * t, branch_phase(index))
        tube(wood, points, radii, sides, (around, max(along, 0.3)), wood_color, flare, sway_of)
    # One normal per vertex from the shape.
    wood.normals = [None] * len(wood.positions)
    return wood


def tree_leaves(spec, cards, top, rng, grow=1.0):
    """The leaf cards of a tree, each `grow` times its usual size, under a crown `top` meters high."""
    # The crown's middle and size, which shade the cards: darker inside and underneath.
    places = np.array([tuple(p) for p, _, _ in cards])
    center = Vector(places.mean(axis=0))
    extent = Vector(np.maximum(np.percentile(np.abs(places - places.mean(axis=0)), 92, axis=0), 0.5))
    leaves = Builder()
    tint = Vector(spec['tint'])
    for p, d, branch in cards:
        out = Vector(((p - center).x / extent.x, (p - center).y / extent.y, (p - center).z / extent.z))
        depth = min(out.length, 1.3)
        outward = out.normalized() if out.length > 1e-3 else Vector((0, 0, 1))
        facing = (outward + Vector(rng.normal(0, 0.45, 3)) + Vector((0, 0, 0.35))).normalized()
        along = (d - facing * d.dot(facing))
        along = along.normalized() if along.length > 1e-3 else frame_of(facing)[0]
        across = along.cross(facing)
        size = spec['card'] * (0.8 + 0.4 * rng.random()) * grow
        cell = int(rng.random() * 4)
        cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
        base = p - along * size * 0.08
        ao = 0.42 + 0.58 * float(smoothstep(0.15, 1.0, depth))
        ao *= 0.72 + 0.28 * float(smoothstep(-0.9, 0.5, out.z))
        hue = 0.92 + 0.16 * rng.random()
        color = tuple(ao * hue * c for c in tint)
        # A card swings with its twig, and the cards at the crown's rim swing the most.
        sway = (max(0.0, p.z) / top + LEAF_FREEDOM * min(depth, 1.0), branch_phase(branch))
        tent(leaves, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, 0.18)
    return leaves


def build_tree(name, spec, bark_mat, leaf_mat, rng):
    """The tree's wood and leaves objects, their lower levels, and the full tree's triangles.

    The leaves' normals bend away from the crown's middle, so the crown shades as one soft mass.
    Each lower level draws with a random stream of its own, so the levels leave the full tree,
    and every model built after it, as they were.
    """
    branches, cards = grow_tree(spec, rng)
    cards = cards + fill_crown(spec, branches, cards, rng)
    top = tree_top(branches)
    wood = tree_wood(spec, branches, rng)
    leaves = tree_leaves(spec, cards, top, rng)
    parts = [wood.build(f'{name}-wood', bark_mat), leaves.build(f'{name}-leaves', leaf_mat)]
    levels = []
    for k, level in enumerate(TREE_LEVELS, start=1):
        own = np.random.default_rng((SEED, k, len(name), sum(map(ord, name))))
        coarse_wood = tree_wood(spec, branches, own, level['branches'], level['sides'])
        coarse_leaves = tree_leaves(spec, cards[:: level['every']], top, own, level['grow'])
        levels += [
            coarse_wood.build(f'{name}-wood-{k}', bark_mat),
            coarse_leaves.build(f'{name}-leaves-{k}', leaf_mat),
        ]
    return parts, levels, wood.triangles(), leaves.triangles()


# ---------------------------------------------------------------------------------------------
# Plants
# ---------------------------------------------------------------------------------------------


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
        strip(
            b, points, widths, sides, 0.12, lambda t, s=shade: (s * (0.5 + 0.5 * t),) * 3, (0, 0, 1, 1), 1,
            lambda t, k=k: (t, branch_phase(k)),
        )
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
        strip(
            b, stalk_pts, [0.03] * 3, [side] * 3, 0.0, lambda t: (0.7 + 0.3 * t,) * 3, (0.47, 0.0, 0.53, 0.1), 0,
            lambda t, k=k: (0.5 * t, branch_phase(k)),
        )
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
                row.append(b.vertex(q, (u, 0.12 + 0.86 * s), (ao, ao, ao), blend_up(n, 0.3), (0.5 + 0.5 * s, branch_phase(k))))
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
        strip(
            b, [Vector((0, 0, 0)), tip * 0.5, tip], [0.025] * 3, [side] * 3, 0.0, lambda t: (0.6,) * 3, (0.24, 0.0, 0.26, 0.06), 0,
            lambda t, k=k: (t, branch_phase(k)),
        )
        for c in range(12):
            p = tip * (0.3 + 0.7 * rng.random())
            out = (p - center).normalized()
            facing = (out + Vector(rng.normal(0, 0.4, 3)) + Vector((0, 0, 0.4))).normalized()
            along = (d - facing * d.dot(facing)).normalized()
            size = 0.24 + 0.1 * rng.random()
            cell = int(rng.random() * 4)
            cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
            depth = (p - center).length / 0.8
            ao = 0.5 + 0.5 * min(1.0, depth)
            sway = (p.length / length, branch_phase(k))
            tent(b, p, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), (ao * 0.9, ao, ao * 0.85), center, sway, 0.18)
    return b


def build_flowers(mat, rng):
    """
    A clump of wildflowers that reads as a low flowering mound: a rosette of broad lobed leaves
    flat on the ground, a ring of leaves standing among the stems, and short stems that lean out
    from the middle and carry the heads low over the leaves. Daisies are cups whose ray petals rise
    from a raised yellow disc, buttercups are small deep cups, and cornflowers are tufts of two
    crossed cups. A few buds stand among them. One atlas gives all of them.
    """
    b = Builder()
    leaf = (0.515, 0.5, 0.845, 0.98)
    stem_strip = (0.89, 0.5, 0.93, 1.0)
    # The rosette: broad leaves that rise from the middle and fall to the ground, and the leaves
    # that stand among the stems.
    for k in range(24):
        az = k * 2.39996 + rng.random() * 0.4
        heading = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))
        standing = k >= 12
        length = (0.17 if standing else 0.18) + 0.09 * rng.random()
        rise = math.radians((68 if standing else 25) + 14 * rng.random())
        points = []
        p = Vector((0, 0, 0.005))
        d = (heading * math.cos(rise) + Vector((0, 0, math.sin(rise)))).normalized()
        for i in range(4):
            points.append(p.copy())
            d = (d + Vector((0, 0, -0.45)) * (0.15 if standing else 0.3)).normalized()
            p = p + d * (length / 3)
        width = length * 0.6
        shade = 0.75 + 0.2 * rng.random()
        strip(
            b, points, [width * 0.35, width * 0.85, width, width * 0.8], [side] * 4, 0.12,
            lambda t, s=shade: (s * (0.5 + 0.5 * t),) * 3, leaf, 1,
            lambda t, k=k: (0.5 * t, branch_phase(k)),
        )
    # The heads: stems that lean out from the middle, so the blooms spread over the mound.
    heads = 15
    for k in range(heads):
        pick = rng.random()
        species = 0 if pick < 0.5 else (1 if pick < 0.78 else 2)
        az = k * 2.39996 + rng.random() * 0.6
        out = Vector((math.cos(az), math.sin(az), 0))
        foot = out * 0.05 * math.sqrt(rng.random())
        height = 0.14 + 0.13 * rng.random()
        lean = (Vector((0, 0, 1)) + out * (0.25 + 0.45 * rng.random())).normalized()
        top = foot + lean * height
        side = frame_of(lean)[0]
        stem = [foot.lerp(top, t) + Vector((0, 0, 0.02 * math.sin(math.pi * t))) for t in (0, 0.5, 1)]
        strip(
            b, stem, [0.006] * 3, [side] * 3, 0.0, lambda t: (0.5 + 0.5 * t,) * 3, stem_strip, 0,
            lambda t, k=k: (t, branch_phase(k + 20)),
        )
        facing = (Vector((0, 0, 1)) + out * 0.5 + Vector(rng.normal(0, 0.15, 3))).normalized()
        across, ahead = frame_of(facing)
        cu, cv = (species % 2) * 0.5, (species // 2) * 0.5
        cell = (cu, cv, cu + 0.5, cv + 0.5)
        sway = (1.0, branch_phase(k + 20))
        if species == 0:
            # A daisy: a shallow cup of ray petals, and its disc raised in the middle.
            size = 0.05 + 0.012 * rng.random()
            tent(b, top - ahead * size * 0.5, ahead, facing, size, cell, (1, 1, 1), top - facing * size, sway, -0.16, 0.3)
            disc = size * 0.32
            tent(b, top + facing * size * 0.02 - ahead * disc * 0.5, ahead, facing, disc,
                 (cu + 0.19, cv + 0.19, cu + 0.31, cv + 0.31), (1, 1, 1), top - facing * size, sway, 0.45, 0.3)
        elif species == 1:
            # A buttercup: a small deep cup.
            size = 0.035 + 0.01 * rng.random()
            tent(b, top - ahead * size * 0.5, ahead, facing, size, cell, (1, 1, 1), top - facing * size, sway, -0.35, 0.3)
        else:
            # A cornflower: a tuft of two cups crossed and tipped apart.
            size = 0.04 + 0.01 * rng.random()
            for tip in (-1, 1):
                tilted = (facing + across * tip * 0.6).normalized()
                along = tilted.cross(across).normalized()
                tent(b, top - along * size * 0.5, along, tilted, size, cell, (1, 1, 1), top - facing * size, sway, -0.25, 0.3)
    # A few buds: small closed heads among the blooms, green going to the petals' color.
    for k in range(5):
        az = rng.random() * 2 * math.pi
        out = Vector((math.cos(az), math.sin(az), 0))
        top = out * (0.04 + 0.08 * rng.random()) + Vector((0, 0, 0.12 + 0.1 * rng.random()))
        facing = (Vector((0, 0, 1)) + out * 0.4).normalized()
        across, ahead = frame_of(facing)
        size = 0.018
        cu, cv = (k % 2) * 0.5, 0.0
        tent(b, top - ahead * size * 0.5, ahead, facing, size, (cu + 0.2, cv + 0.2, cu + 0.3, cv + 0.3), (0.75, 0.85, 0.6), top - facing * size, (1.0, branch_phase(k + 40)), 0.5, 0.3)
        strip(
            b, [top - Vector((0, 0, 0.1)), top - Vector((0, 0, 0.05)), top], [0.005] * 3, [frame_of(facing)[0]] * 3, 0.0,
            lambda t: (0.5 + 0.5 * t,) * 3, stem_strip, 0, lambda t, k=k: (t, branch_phase(k + 40)),
        )
    return b


# ---------------------------------------------------------------------------------------------
# The cave mouth
# ---------------------------------------------------------------------------------------------

CAVE_SIZE = (8.4, 6.6, 4.8)
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
    # It runs deep, and bends to the right at its back, so no light reaches its end.
    tunnel = [
        ((-0.4, -4.2, 0.6), (3.0, 1.6, 3.0)),
        ((-0.35, -2.9, 0.6), (3.0, 1.6, 3.0)),
        ((-0.25, -1.6, 0.55), (2.7, 1.6, 2.8)),
        ((-0.05, -0.3, 0.5), (2.3, 1.5, 2.4)),
        ((0.35, 0.9, 0.45), (1.9, 1.3, 2.0)),
        ((0.9, 1.8, 0.4), (1.5, 1.1, 1.6)),
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
        inside = 1.0 if abs(p.x + 0.2) < 2.0 and p.z < 2.4 and p.y > -3.4 else 0.0
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

    # Boulders and fallen rocks around the mouth: noisy squashed spheres, sunk into the ground.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    boulders = [
        ((-2.3, -3.2, -0.1), 0.95, 0.7), ((-3.3, -2.6, -0.2), 0.7, 0.8), ((1.6, -3.3, -0.15), 0.85, 0.65),
        ((2.6, -3.0, -0.2), 0.6, 0.75), ((-1.4, -4.1, -0.2), 0.45, 0.6), ((0.9, -4.3, -0.2), 0.38, 0.55),
        ((-0.2, -3.9, -0.25), 0.3, 0.5), ((3.5, -1.8, -0.2), 0.75, 0.8),
    ]
    for k, (at, size, squash) in enumerate(boulders):
        made = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=size)
        for v in made['verts']:
            d = v.co.normalized()
            bump = 1 + 0.22 * noise.fractal(d * 1.7 + Vector((k * 3.1, k, 0)), 0.6, 2.0, 3)
            cells = noise.voronoi(d * 2.2 + Vector((k, 0, 0)), distance_metric='DISTANCE')[0]
            flat = 0.9 + 0.1 * float(smoothstep(0.0, 0.25, cells[1] - cells[0]))
            v.co = Vector((d.x * 1.15, d.y, d.z * squash)) * size * bump * flat + Vector(at)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.5), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(mesh)
    bm.free()

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
        ao = max(0.02, 1 - 1.5 * hits / len(dirs)) ** 1.3
        p = v.co
        # Moss on the faces that look up, in patches, thickest over the mouth and on the boulders'
        # crowns, and none deep in the tunnel.
        patch = noise.noise(p * 0.8) + 0.5 * noise.noise(p * 2.7)
        moss = float(smoothstep(0.15, 0.7, n.z + 0.4 * patch)) * float(smoothstep(-0.3, 0.6, p.z))
        moss *= float(smoothstep(0.15, 0.5, ao))
        damp = 0.7 + 0.3 * float(smoothstep(-0.5, 0.6, p.z))
        stone = np.array([1.0, 0.98, 0.95]) * damp
        green = np.array([0.36, 0.52, 0.16]) * (0.85 + 0.3 * float(smoothstep(-1, 1, patch)))
        colors[v.index, :3] = ao * (stone * (1 - moss) + green * moss)
    bm.free()
    attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.ravel())
    mesh.color_attributes.active_color = attr
    mesh.shade_smooth()
    mesh.materials.clear()
    mesh.materials.append(mat)
    return obj, sum(len(p.vertices) - 2 for p in mesh.polygons)


def main():
    out, shots = arguments('creek.py')
    rng = np.random.default_rng(SEED)

    atlas = image('leaves', leaf_atlas(2048, rng))
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
        parts, levels, wood_tris, leaf_tris = build_tree(name, spec, barks[spec['bark']], leaf_mat, rng)
        tree_objects += parts + levels
        counts[name] = (wood_tris, leaf_tris)

    fern_mat = material('fern', image('fern', fern_frond(256, 1024, rng)), cutout=True, roughness=0.7)
    hosta_mat = material('hosta', image('hosta', broad_leaf(512, rng)), cutout=True, roughness=0.8)
    shrub_mat = material('shrub', atlas, cutout=True, roughness=0.65)
    flower_mat = material('flowers', image('flowers', flower_atlas(512, rng)), cutout=True, roughness=0.6)
    plants = [
        build_fern(fern_mat, rng).build('fern', fern_mat),
        build_hosta(hosta_mat, rng).build('hosta', hosta_mat),
        build_shrub(shrub_mat, rng).build('shrub', shrub_mat),
        build_flowers(flower_mat, rng).build('flowers', flower_mat),
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
    errors = [level['error'] for level in TREE_LEVELS]
    report.update(export(os.path.join(out, 'trees.glb'), tree_objects, {'leaves'}, errors))
    report.update(export(os.path.join(out, 'plants.glb'), plants, {'fern', 'hosta', 'shrub', 'flowers'}))
    report.update(export(os.path.join(out, 'cave.glb'), [cave], set()))
    for name, triangles in report.items():
        print(f'CREEK {name}: {triangles} triangles')
    for file in ('trees.glb', 'plants.glb', 'cave.glb'):
        print(f'CREEK {file}: {os.path.getsize(os.path.join(out, file)) / 1e6:.2f} MB')
    if shots:
        for name in TREES:
            parts = [bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']]
            preview(parts, os.path.join(shots, f'{name}.png'))
            close_up(parts, os.path.join(shots, f'{name}-close.png'))
            # The full tree beside its two lower levels, as a page's camera sees them at 40 m and 80 m.
            levels = [parts] + [[bpy.data.objects[f'{name}-wood-{k}'], bpy.data.objects[f'{name}-leaves-{k}']] for k in (1, 2)]
            for distance in (40, 80):
                at_distance(levels, os.path.join(shots, f'{name}-levels-{distance}m.png'), distance)
        for plant in plants:
            preview([plant], os.path.join(shots, f'{plant.name}.png'))
            close_up([plant], os.path.join(shots, f'{plant.name}-close.png'), box=(0.25, 0.75, 0.2, 0.7))
        preview([cave], os.path.join(shots, 'cave.png'), (0.3, -2.2, 0.35))


main()
