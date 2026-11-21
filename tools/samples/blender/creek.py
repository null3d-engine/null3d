# Builds the organic models of the Creek showcase scene in Blender: three broadleaf trees, four
# plants for the banks, a rocky cave mouth and two sculpted pines. A fixed seed gives the shapes and
# every texture, which numpy paints, except the pines' trunks and limbs: those are raw Tripo3D
# models, kept in the sample-assets repository, which this script finishes. Nothing is downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/creek.py -- <output folder> [--models <a,b>] [--raw <folder>] \
#     [--preview <folder>]
#
# `--raw` names the folder of raw models, which the pines need, and the script checks each one's
# hash. `--models` names the files to build, of trees, plants, cave and pines; the first three are
# always built, as one random stream runs through them. `bun tools/samples/blender/creek.ts
# <folder>` runs it, with the raw models from the pinned sample content, and optimizes the files for
# the scene.
#
# It writes four binary glTF files into the output folder, and prints each model's triangles:
#   trees.glb   oak, beech and birch, each a wood node and a leaves node, with lower levels of
#               detail (MSFT_lod): fewer, larger leaf cards and fewer, plainer branches
#   plants.glb  fern, hosta, shrub and flowers, one node each
#   cave.glb    cave, one node
#   pines.glb   the tall and the low pine, each a wood node and a leaves node, with lower levels:
#               fewer, larger needle cards and the wood cut to fewer triangles
# Leaves, fronds, needles and plant leaves are cards whose texture's alpha cuts their outline, so
# their materials are masked and double sided. The wood, the plants and the rock carry ambient
# occlusion and tints in their vertex colors, which glTF multiplies into the base color. The trees,
# pines and plants carry their sway in their second texture coordinates, as `common.py` says; the
# cave stands still. --preview also renders each model with Cycles, for a quick look without the
# engine.
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

import hashlib
import heapq
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# The shared module loads from beside this script, and leaves no bytecode cache in the repository.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    PIXEL_PER_METER, Builder, Plant, arguments, at_distance, blend_up, branch_phase, close_up, crown_cards,
    dilate, export, fbm, frame_of, half, image, inside, leaf_color, leaf_mask, leaf_part, level_error, link,
    material, needle_atlas, normal_map, occlusion_of, orm, over, plant_reach, plant_top, preview, rock_texture,
    smoothstep, sprig_atlas, stage, strip, tent, tube, value_noise,
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


# ---------------------------------------------------------------------------------------------
# Sculpted pines
# ---------------------------------------------------------------------------------------------

# The garden's cloud-pruned pines. Each one's trunk and limbs are a raw Tripo3D model, which this
# script finishes: it stands the model at its height with its foot at the middle, drops its loose
# pieces, gives it bark from the model's own maps, and finds its limbs and their ends. The crown is
# a layer of pads of needles for each tier of limbs, along the limbs to their ends: each pad is a
# body of dense needles with needle cards on it, as `pad_bodies`, `crown_cards` and `leaf_part`
# lay them. The bare twig ends outside the layers are cut away.
#   raw      the raw model's file, under the folder of raw models, and sha256 its hash, which the
#            build checks, so a rebuild reads the very file the pine was made from
#   turn     degrees about the vertical axis that turn the model's front toward -y
#   height   the wood's height in meters; sink is how far its foot sits under the ground
#   fan      how `trained` trains the crown flat: the distance from the trunk it leaves alone, the
#            most it lets a limb reach to the front or back past that, and the shares of the reach
#            to the sides it keeps past that, each from the lowest tier to the top; climb, when given, trains the limbs under the crown up into it; wire, when
#            given, levels each tier's limbs at its layer within that many meters of where they
#            leave; rigid is the reach over which the wood moves as one, so a limb keeps its round
#            section
#   wood     the wood's triangles at the full level, then at each lower one
#   limit    the largest surface error a lower level may have, as a share of the height, which
#            `level_error` measures for each level of each part
#   bark     the bark's mean color in the concept, which the wood's vertex colors bring it to
#   bare     the share of the wood's height that carries no pad
#   stub     the shortest limb, as a share of the wood's height, that carries a pad; twig is the
#            length of bare wood at a limb's end, as such a share, that `trim_twigs` cuts, and keep
#            the distance from the trunk's axis within which it cuts nothing; prune cuts any wood
#            past the pads, as a crown is pruned to its outline, and hang, when given, is how far
#            under its pads a limb still bears them
#   gap      the height, as a share of the wood's height, over which the limbs of one tier leave
#   pad      a pad's radius across, in meters, from the lowest tier to the top; taper is how much
#            narrower the pad at a limb's end is, and spacing the gap between pads along a limb as
#            a share of a pad's radius; crest, when given, tops the trunk with one broad pad that
#            share of the crown's width across
#   inner    the share of a limb's reach, from the trunk, that carries no pad
#   slope    the steepest rise over run of the wood that carries pads along it; flatten is how
#            far each pad moves toward its tier's layer, at the level percentile of the heights of
#            the tier's limb ends
#   flat     a pad's width over its thickness; floor, when given, keeps every pad's underside
#            above that share of the height, deep is the most a pad reaches to the front or back,
#            from the lowest tier to the top, and hold how far, in pad thicknesses, a pad may leave
#            its own wood for its layer
#   rise     how far a pad's middle sits above its layer, in meters
#   cards    needle cards at the full level; up and depth place them as `crown_cards` says, and
#            card, lift, scatter, centered, cells, fold, bend, tint and shade shape them as
#            `leaf_part` says
#   body     the size of each pad's body against the pad; bodies gives its sides around and its
#            rows up at each level, and underside how much darker its underside is
#   levels   each lower level's (every, grow): it keeps one card in every, each grow times larger
# The tall trunk, which the wide pine and the narrow one are both finished from.
TALL_TRUNK = dict(
    raw='pine-tall/model.glb', sha256='907b52ee4e6bed5b47760243d8f4e917b194c23a962bda28531d47cbc7884cd6',
    turn=-90, height=7.5, sink=0.08, limit=0.03, bark=(0.25, 0.22, 0.18),
)
PINES = {
    'pine-tall': dict(
        TALL_TRUNK, wood=(14000, 5000, 1600),
        fan=(0.3, (0.5, 0.1, 0.05), (0.7, 1.35, 1.75, 1.15, 1.0)), wire=0.6, rigid=0.3, climb=(0.25, 0.6, 0.4), bare=0.38, stub=0.12, twig=0.12,
        keep=0.45, prune=True, gap=0.12, pad=(0.85, 1.05, 0.9), crest=0.4,
        taper=0.5, spacing=0.9, slope=0.8, flatten=0.9, hold=1.2, level=50, floor=0.37, deep=(0.55, 0.2, 0.2, 0.2, 0.2), flat=6.0, rise=0.1,
        inner=0.0,
        body=0.6, bodies=((10, 5), (6, 3), (5, 2)), underside=0.05,
        cards=3600, up=0.6, depth=0.2, card=0.45, lift=0.75, scatter=0.3, centered=0.5, cells=(0, 1, 2),
        fold=0.06, bend=0.55, tint=(1.0, 1.0, 1.0), shade=0.8, levels=((2, 1.3), (5, 1.7)),
    ),
    'pine-low': dict(
        raw='pine-low/model.glb', sha256='0220c9fd94322434bc66b47af260208f4e9ad72e964db39c67ef41973101569f',
        turn=-90, height=3.4, sink=0.15, wood=(8000, 3000, 1000), limit=0.03, bark=(0.17, 0.11, 0.055),
        fan=(0.3, (0.8,), (1.15,)), rigid=0.25, climb=(0.3, 0.6, 0.8), bare=0.45, stub=0.12, twig=0.2, keep=0.3, prune=True,
        gap=0.15, pad=(0.72, 0.55), taper=0.6, spacing=0.8, slope=2.0, flatten=0.3, hold=1.0, level=70,
        floor=0.6, hang=0.5, deep=(0.5,), flat=2.2, rise=0.1, inner=0.0,
        body=0.5, bodies=((10, 5), (6, 3), (5, 2)), underside=0.1,
        cards=3400, up=0.6, depth=0.3, card=0.35, lift=0.7, scatter=0.3, centered=0.5, cells=(0, 1, 2),
        fold=0.08, bend=0.55, tint=(1.0, 0.93, 0.74), shade=0.7, levels=((2, 1.3), (5, 1.7)),
    ),
    # The concept's top pine: the tall trunk with its limbs kept short, about 0.8 times as wide as
    # it is tall.
    'pine-narrow': dict(
        TALL_TRUNK, wood=(12000, 4500, 1500),
        fan=(0.3, (0.35, 0.1, 0.05), (0.5, 0.8, 1.0, 0.7, 0.6)), wire=0.5, rigid=0.3, climb=(0.25, 0.6, 0.4), bare=0.38, stub=0.12, twig=0.12,
        keep=0.45, prune=True, gap=0.12, pad=(0.75, 0.8, 0.7), crest=0.45,
        taper=0.5, spacing=0.9, slope=0.8, flatten=0.9, hold=1.2, level=50, floor=0.37, deep=(0.35, 0.2, 0.2, 0.2), flat=6.0, rise=0.1,
        inner=0.0,
        body=0.6, bodies=((10, 5), (6, 3), (5, 2)), underside=0.05,
        cards=2600, up=0.6, depth=0.2, card=0.45, lift=0.75, scatter=0.3, centered=0.5, cells=(0, 1, 2),
        fold=0.06, bend=0.55, tint=(1.0, 1.0, 1.0), shade=0.8, levels=((2, 1.3), (5, 1.7)),
    ),
}

# The needles' colors: the olive of the concept's tall pines; the low pine's tint makes it a little
# yellower, as the concept's low pines are.
NEEDLE_TONES = ((0.53, 0.54, 0.27), (0.55, 0.56, 0.29))
NEEDLE_TWIG = (0.25, 0.2, 0.15)


def import_raw(path, name, height, turn, sink=0.0, gap=0.03):
    """
    Imports a raw model as one object: every part's transform baked into its vertices, the parts
    joined, doubled vertices merged, and each loose part that stands more than `gap` meters clear
    of the rest dropped. The object is turned by `turn` degrees about the vertical axis, scaled to
    `height` meters and moved so its foot stands at the origin, `sink` meters into the ground. It
    returns the object, with no material, and the texels of its material's color, normal and
    roughness maps.

    The importer reuses a node group of the name that `occlusion_output` gives, and needs sockets
    that group lacks, so the group steps aside while the import runs. The imported materials and
    their group then go, so the export meets only this script's own.
    """
    group_name = 'glTF Material Output'
    own = bpy.data.node_groups.get(group_name)
    if own is not None:
        own.name = f'{group_name} (own)'
    materials, groups = set(bpy.data.materials), set(bpy.data.node_groups)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in added if o.type == 'MESH']
    if not meshes:
        raise SystemExit(f'{path} holds no mesh')
    worlds = [(o, o.matrix_world.copy()) for o in meshes]
    for o, world in worlds:
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(world)
    for o, _ in worlds:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in added:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    drop_loose(bm, gap)
    bm.to_mesh(obj.data)
    bm.free()
    mesh = obj.data
    mesh.transform(Matrix.Rotation(math.radians(turn), 4, 'Z'))
    co = positions(mesh)
    low, high = co.min(axis=0), co.max(axis=0)
    # The foot is the middle of the lowest few centimeters of the trunk.
    foot = co[co[:, 2] < low[2] + 0.02 * (high[2] - low[2])].mean(axis=0)
    mesh.transform(Matrix.Translation((0, 0, -sink)) @ Matrix.Scale(height / float(high[2] - low[2]), 4) @ Matrix.Translation((-foot[0], -foot[1], -low[2])))
    mesh.update()
    bsdf = next(n for n in obj.material_slots[0].material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    maps = {key: texels_behind(bsdf.inputs[key]) for key in ('Base Color', 'Normal', 'Roughness')}
    mesh.materials.clear()
    for mat in set(bpy.data.materials) - materials:
        bpy.data.materials.remove(mat)
    for group in set(bpy.data.node_groups) - groups:
        bpy.data.node_groups.remove(group)
    if own is not None:
        own.name = group_name
    return obj, maps


def drop_loose(bm, gap, smallest=0):
    """
    Deletes each loose part of a mesh that stands more than `gap` clear of its largest part, as a
    generated model can leave a piece of wood floating beside the trunk, and each part of fewer than
    `smallest` vertices wherever it stands. A larger part that touches the rest stays.
    """
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        seen.add(v.index)
        part, stack = [], [v]
        while stack:
            x = stack.pop()
            part.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(part)
    parts.sort(key=len, reverse=True)
    tree = KDTree(len(parts[0]))
    for v in parts[0]:
        tree.insert(v.co, v.index)
    tree.balance()
    loose = [v for part in parts[1:] if len(part) < smallest or min(tree.find(v.co)[2] for v in part) > gap for v in part]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')


def positions(mesh):
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', co)
    return co.reshape(-1, 3).astype(np.float64)


def texels_behind(socket):
    """The texels of the image that feeds a material's socket, through any nodes between them."""
    node = socket.links[0].from_node if socket.links else None
    while node is not None and node.type != 'TEX_IMAGE':
        linked = [i for i in node.inputs if i.links]
        node = linked[0].links[0].from_node if linked else None
    if node is None:
        return None
    w, h = node.image.size
    return np.array(node.image.pixels[:], np.float32).reshape(h, w, -1)


def raw_bark(maps, name, size):
    """
    The bark of a raw model, from its own maps, each shrunk to `size` texels: its color, its
    normal map, and its roughness packed with full occlusion and no metal, as `orm` packs them.
    """

    color, normal, rough = maps['Base Color'], maps['Normal'], maps['Roughness']
    # The texels outside the model's UV islands are black; each map spreads its islands' texels
    # into them, so a seam that the cut to fewer triangles moves never samples black.
    used = (color[..., :3].sum(axis=2) > 0.03).astype(np.float32)[..., None]

    def shrink(texels):
        if texels.shape[:2] == used.shape[:2]:
            texels = dilate(np.concatenate([texels[..., :3], used], axis=2))
        while max(texels.shape[:2]) > size:
            texels = half(texels)
        return texels

    if rough is not None:
        rough = shrink(rough)[..., 1]
    return material(
        f'bark-{name}',
        image(f'bark-{name}-color', shrink(color)[..., :3]),
        image(f'bark-{name}-normal', shrink(normal)[..., :3], 'Non-Color') if normal is not None else None,
        image(f'bark-{name}-orm', orm(np.ones(rough.shape), rough), 'Non-Color') if rough is not None else None,
    )


def limb_ends(co, edges, cell, radius):
    """
    The ends of a tree's limbs, and each vertex's limb, from the distance along the wood from its
    foot: the wood's vertices fall into cells of `cell` meters, each cell links to the 26 around
    it and to the cells that the mesh's edges join it to, and the distance runs through the links
    from the cells at the foot. A part of the wood that no link reaches links to the nearest cell
    that one does, the nearest part first. A limb's end is a cell farther along the wood than every
    cell within `radius` of it.

    It returns the ends' cells, each vertex's cell, the cells' middles, their distances, the cell
    that each cell's shortest path comes from, the end each cell leads to, and each cell's links.
    """
    keys = np.floor(co / cell).astype(np.int64)
    cells_of, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.ravel()
    count = len(cells_of)
    middles = np.zeros((count, 3))
    np.add.at(middles, inverse, co)
    middles /= np.bincount(inverse, minlength=count)[:, None]
    index = {tuple(k): i for i, k in enumerate(cells_of.tolist())}
    steps = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]
    around = []
    for k in cells_of.tolist():
        near = [index.get((k[0] + dx, k[1] + dy, k[2] + dz)) for dx, dy, dz in steps]
        around.append({n for n in near if n is not None})
    for a, b in inverse[edges]:
        if a != b:
            around[a].add(int(b))
            around[b].add(int(a))
    distance = np.full(count, np.inf)
    parent = np.full(count, -1)
    heap = []
    floor = middles[:, 2].min()
    for i in np.where(middles[:, 2] < floor + 2 * cell)[0]:
        distance[i] = 0.0
        heap.append((0.0, int(i)))
    heapq.heapify(heap)

    def run():
        while heap:
            d, i = heapq.heappop(heap)
            if d > distance[i]:
                continue
            for n in around[i]:
                step = d + float(np.linalg.norm(middles[n] - middles[i]))
                if step < distance[n]:
                    distance[n] = step
                    parent[n] = i
                    heapq.heappush(heap, (step, n))

    run()
    while not np.isfinite(distance).all():
        reached = np.where(np.isfinite(distance))[0]
        tree = KDTree(len(reached))
        for i in reached:
            tree.insert(middles[i], int(i))
        tree.balance()
        gap, i, near = min((d, int(i), n) for i in np.where(~np.isfinite(distance))[0] for _, n, d in [tree.find(middles[i])])
        distance[i] = distance[near] + gap
        parent[i] = near
        heapq.heappush(heap, (distance[i], i))
        run()
    # Ends: first the cells farther than every cell they link to, then those that are farthest
    # within the radius, the farthest first, each the only end within the radius.
    tree = KDTree(count)
    for i in range(count):
        tree.insert(middles[i], i)
    tree.balance()
    ends = []
    for i in np.argsort(-distance):
        if any(distance[n] > distance[i] for n in around[i]):
            continue
        if any(distance[n] > distance[i] for _, n, _ in tree.find_range(middles[i], radius)):
            continue
        if all((middles[i] - middles[e]) @ (middles[i] - middles[e]) > radius * radius for e in ends):
            ends.append(int(i))
    # The end each cell leads to: the farthest cell past it on the paths that run through it.
    farthest = np.arange(count)
    for i in np.argsort(-distance):
        p = parent[i]
        if p >= 0 and distance[farthest[i]] > distance[farthest[p]]:
            farthest[p] = farthest[i]
    tree = KDTree(len(ends))
    for k, e in enumerate(ends):
        tree.insert(middles[e], k)
    tree.balance()
    limb = np.array([tree.find(middles[farthest[i]])[1] for i in range(count)])
    return ends, inverse, middles, distance, parent, limb, around


def limb_starts(ends, distance, limb):
    """The cell where each limb leaves its parent: its cell nearest the foot along the wood."""
    starts = []
    for k in range(len(ends)):
        cells_k = np.where(limb == k)[0]
        starts.append(int(cells_k[np.argmin(distance[cells_k])]) if len(cells_k) else ends[k])
    return starts


def limb_phases(ends, starts, distance, parent, limb):
    """
    Each cell's phase: 0 at the foot, and along each limb from its parent's phase where it leaves
    its parent to its own at its end, so neighboring vertices never flutter apart. Limb k's own
    phase is that of branch k + 1, which its pad carries too.
    """
    phase = np.zeros(len(distance))
    for k in sorted(range(len(ends)), key=lambda k: distance[starts[k]]):
        cells_k = np.where(limb == k)[0]
        start = starts[k]
        before = phase[parent[start]] if parent[start] >= 0 else 0.0
        span = max(distance[ends[k]] - distance[start], 1e-3)
        ramp = np.clip((distance[cells_k] - distance[start]) / span, 0, 1)
        phase[cells_k] = before + (branch_phase(k + 1) - before) * ramp
    return phase


def root_path(cell, parent):
    """The cells from the foot to a cell, along the wood."""
    path = []
    while cell >= 0:
        path.append(int(cell))
        cell = parent[cell]
    return path[::-1]


def runs_level(p, q, slope):
    """True where the wood from `p` to `q` rises no steeper than `slope`, as rise over run."""
    return abs(p[2] - q[2]) < slope * math.hypot(p[0] - q[0], p[1] - q[1])


def profile(values, share):
    """A value that runs through `values` evenly from a share of 0 to a share of 1."""
    return np.interp(share, np.linspace(0.0, 1.0, len(values)), values)


def pine_tiers(spec, ends, starts, middles, distance, parent):
    """
    The pine's tiers of limbs and the height of each tier's layer. A limb leaves the trunk where
    the wood from the foot to its end first runs no steeper than `slope`, above the bare trunk, and
    its tier is the height where it leaves: the limbs that leave within `gap` above the lowest of a
    tier share it. A limb shorter than `stub` is a stub or a twig and has no tier. Each tier is a
    list of (the height where a limb leaves, the limb, its cells from there to its end). A tier's
    layer lies at the `level` percentile of the heights of its limbs' ends; with `wire`, the layers
    are spread evenly from the lowest to the highest, so the gaps between them are even.
    """
    height = spec['height']
    low = spec['bare'] * height
    kept = [
        k for k, e in enumerate(ends)
        if middles[e][2] > low and distance[e] - distance[starts[k]] > spec['stub'] * height
    ]
    limbs = []
    for k in kept:
        path = root_path(ends[k], parent)
        points = middles[path]
        along = distance[path]
        leave = len(path) - 2
        for j in range(len(path) - 1):
            if points[j][2] < 0.9 * low:
                continue
            q = points[min(int(np.searchsorted(along, along[j] + spec['spacing'] * spec['pad'][-1])), len(path) - 1)]
            if runs_level(points[j], q, spec['slope']):
                leave = j
                break
        limbs.append((points[leave][2], k, path[leave:]))
    limbs.sort()
    tiers = []
    for limb_entry in limbs:
        if tiers and limb_entry[0] - tiers[-1][0][0] < spec['gap'] * height:
            tiers[-1].append(limb_entry)
        else:
            tiers.append([limb_entry])
    levels = [float(np.percentile([middles[ends[k]][2] for _, k, _ in tier], spec['level'])) for tier in tiers]
    if 'wire' in spec and len(levels) > 1:
        levels = list(np.linspace(min(levels), max(levels), len(levels)))
    return tiers, levels


def wired(middles, tiers, levels, distance, limb, spec):
    """
    How far each cell of the wood rises or falls as a gardener wires a pruned pine's limbs level:
    past the point where a limb leaves, its middle line eases to its tier's layer within `wire`
    meters out. Each cell moves as the middle line does at its distance along the wood, so the
    limb keeps its section.
    """
    rise = np.zeros(len(middles))
    for tier, level in zip(tiers, levels):
        for _, k, cells in tier:
            along = distance[cells]
            mine = np.where((limb == k) & (distance >= along[0]))[0]
            line = np.interp(distance[mine], along, middles[cells, 2])
            out = np.hypot(*(middles[mine, :2] - middles[cells[0], :2]).T)
            rise[mine] = (level - line) * smoothstep(0.0, spec['wire'], out)
    return rise


def pine_pads(spec, tiers, levels, ends, middles, distance, axis):
    """
    The pine's crown: a layer of pads for each tier of limbs. Along the wood from `inner` of the
    way out to each limb's end, a pad sits wherever the wood runs no steeper than `slope`, every
    `spacing` of a pad's width, and one at the end, so each layer breaks into clumps. `flatten`
    moves each pad toward its tier's layer by no more than `hold` times its thickness, so a tier
    reads as one plate across the trunk that still carries every limb, and the limbs show bare in
    the gaps between the plates. A `floor`, as a share of the height, keeps every pad's underside
    above it. A pad's width runs through `pad` and the most it reaches to the front or the back
    through `deep`, from the lowest tier to the top, and it narrows by `taper` toward the limb's
    end, so a layer thins to a tip. With `crest`, one broad flat pad that wide a share of the
    crown's width tops the trunk, as a pruned pine's crown is flat on top.
    """
    height = spec['height']
    low = spec['bare'] * height
    plant = Plant()
    high = max(middles[ends[k]][2] for tier in tiers for _, k, _ in tier)
    for tier, level_z in zip(tiers, levels):
        share = (level_z - low) / max(high - low, 1e-3)
        across = float(profile(spec['pad'], share))
        deep = float(profile(spec['deep'], share))
        for _, k, cells in tier:
            points = middles[cells]
            # How far out along its limb each point lies, from 0 where the limb leaves to 1 at its farthest.
            out = np.hypot(points[:, 0] - points[0, 0], points[:, 1] - points[0, 1])
            out = out / max(out.max(), 1e-3)
            along = distance[cells] - distance[cells[0]]
            mark = along[-1]
            first = True
            while mark >= 0:
                j = min(int(np.searchsorted(along, mark)), len(points) - 1)
                p = points[j]
                q = points[int(np.searchsorted(along, max(mark - spec['spacing'] * across, 0)))]
                level = runs_level(p, q, spec['slope'])
                size = across * (1 - spec['taper'] * out[j])
                thick = size / spec['flat']
                # The pad moves toward its layer, but never so far that it lets go of its own wood.
                shift = float(np.clip((level_z - p[2]) * spec['flatten'], -spec['hold'] * thick, spec['hold'] * thick))
                z = p[2] + shift + spec['rise']
                # A crown with a floor keeps every pad's underside above it, so its lower edge is level.
                if 'floor' in spec:
                    z = max(z, spec['floor'] * height + thick)
                # Limbs that share a stretch of wood share its pads.
                taken = any(
                    math.hypot(c.x - p[0], c.y - p[1]) < spec['spacing'] * size and abs(c.z - z) < r.z
                    for c, r, _ in plant.pads
                )
                if (first or (level and p[2] > low and out[j] >= spec['inner'])) and not taken:
                    plant.pad((p[0], p[1], z), (size, min(size, deep), thick), k + 1)
                first = False
                mark -= spec['spacing'] * across
    if 'crest' in spec:
        left = min(c.x - r.x for c, r, _ in plant.pads)
        right = max(c.x + r.x for c, r, _ in plant.pads)
        radius = spec['crest'] * (right - left) / 2
        slope, foot = axis
        x, y = levels[-1] * slope + foot
        plant.pad((x, y, levels[-1] + spec['rise']), (radius, min(radius, spec['deep'][-1]), radius / spec['flat']), tiers[-1][0][1] + 1)
    return plant


def held(points, pads, grow, hang=0.0):
    """
    True where a point lies inside one of the pads, each grown `grow` times in its squared measure,
    or under one, within its outline across so grown, no more than `hang` meters below it.
    """
    inside_any = np.zeros(len(points), bool)
    for c, r, _ in pads:
        q = (points - np.array(c)) / np.array(r)
        inside_any |= (q ** 2).sum(axis=1) < grow
        if hang > 0:
            inside_any |= ((q[:, :2] ** 2).sum(axis=1) < grow) & (points[:, 2] < c.z) & (points[:, 2] > c.z - r.z - hang)
    return inside_any


def cap_trunk(plant, spec, middles, limb, axis):
    """
    Hides the trunk's top end in a pad, as a pruned pine's leader ends inside its top layer, when
    no pad holds it yet: the top cell within `keep` of the trunk's axis carries a pad as wide as
    the top tier's.
    """
    slope, foot = axis
    trunk = np.where(np.hypot(*(middles[:, :2] - (middles[:, 2:3] * slope + foot)).T) < spec['keep'])[0]
    top = trunk[np.argmax(middles[trunk, 2])]
    if held(middles[top:top + 1], plant.pads, 1.0)[0]:
        return
    size = spec['pad'][-1]
    plant.pad(tuple(middles[top]), (size, min(size, spec['deep'][-1]), size / spec['flat']), int(limb[top]) + 1)


def trim_twigs(obj, plant, spec, ends, starts, inverse, middles, distance, parent, limb, around, cell, axis):
    """
    Prunes the wood to the crown, cell by cell of the wood, so each cut runs across a limb and
    leaves no torn piece:
    - each limb is cut back to its last pad: past the farthest of its cells that a pad holds, or
      that a held limb leaves from; a limb that no pad holds goes back to where it leaves. Under a
      crown that stands on its limbs, `hang` is how far under its pads a limb is still held;
    - a bare twig, the last `twig` of the wood's height before a limb's end, goes where no pad
      grown by half again holds it, above the bare trunk;
    - with `prune`, any wood that reaches out past the pads goes;
    - nothing else within `keep` of the trunk's axis or in the lowest tenth of the height is cut,
      so the trunk and its foot never show a hole;
    - all wood above the middle of the highest pad goes, so the trunk's top ends inside a pad;
    - wood that the cuts part from the foot goes, whatever its size.
    Each cut end is closed, and a pad left with no wood in or near it goes.
    """
    height = spec['height']
    tips = KDTree(len(middles))
    count = 0
    for e in ends:
        for c in root_path(e, parent):
            if distance[e] - distance[c] < spec['twig'] * height:
                tips.insert(middles[c], c)
                count += 1
    tips.balance()
    near = np.array([count > 0 and tips.find(m)[2] < 1.5 * cell for m in middles])
    z = middles[:, 2]
    slope, foot = axis
    clear = (np.hypot(*(middles[:, :2] - (middles[:, 2:3] * slope + foot)).T) > spec['keep']) & (z > 0.1 * height)
    # How far along the wood each limb keeps: to its last held cell, or to where a held limb leaves
    # it, the limbs farthest from the foot first, so a limb's pads keep the wood that bears them.
    holds = held(middles, plant.pads, 1.5, spec.get('hang', 0.0))
    reach = distance[np.array(starts)].copy()
    np.maximum.at(reach, limb[holds], distance[holds])
    bearing = np.zeros(len(ends), bool)
    bearing[limb[holds]] = True
    for k in sorted(range(len(ends)), key=lambda k: -distance[starts[k]]):
        below = parent[starts[k]]
        if bearing[k] and below >= 0 and limb[below] != k:
            reach[limb[below]] = max(reach[limb[below]], distance[below])
            bearing[limb[below]] = True
    # Wood above the middle of the highest pad goes, the trunk's top too, so the trunk ends
    # inside its top pad.
    gone = (z > max(c.z for c, _, _ in plant.pads)) | (clear & (
        (distance > reach[limb]) | (~held(middles, plant.pads, 2.0) & (z > spec['bare'] * height) & near)
    ))
    if spec.get('prune'):
        # The crown is pruned to its outline: no wood reaches out past its pads.
        under = np.zeros(len(middles), bool)
        for c, r, _ in plant.pads:
            under |= ((middles[:, 0] - c.x) / r.x) ** 2 + ((middles[:, 1] - c.y) / r.y) ** 2 < 1.3
        gone |= ~under & clear & (z > spec['climb'][0] * height)
    # Only wood that still joins the foot through the cells that stay is kept.
    joined = (z < z.min() + 2 * cell) & ~gone
    stack = list(np.where(joined)[0])
    while stack:
        i = stack.pop()
        for n in around[i]:
            if not joined[n] and not gone[n]:
                joined[n] = True
                stack.append(n)
    cut = ~joined[inverse]
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    open_before = {e.index for e in bm.edges if e.is_boundary}
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(cut)[0]], context='VERTS')
    # A piece of the mesh that the cuts part from the trunk goes too, and so does a small scrap.
    drop_loose(bm, 0.03, 400)
    close_cuts(bm, open_before)
    bm.to_mesh(mesh)
    bm.free()
    # A pad whose wood was all cut would float, so it goes too.
    co = positions(mesh)
    plant.pads = [pad for pad in plant.pads if held(co, [pad], 2.0).any()]
    return int(cut.sum())


def close_cuts(bm, open_before):
    """
    Closes each hole that a cut opened in the wood with a fan of faces, so no cut limb shows an
    open tube. The new corners take the texture and sway coordinates of their vertices' other
    corners, so a closed end sways with its limb.
    """
    bm.edges.ensure_lookup_table()
    edges = [e for e in bm.edges if e.is_boundary and e.index not in open_before]
    made = set(bmesh.ops.holes_fill(bm, edges=edges, sides=64)['faces'])
    layers = list(bm.loops.layers.uv.values())
    for face in made:
        for loop in face.loops:
            other = next((o for o in loop.vert.link_loops if o.face not in made), None)
            if other is not None:
                for layer in layers:
                    loop[layer].uv = other[layer].uv


def pad_bodies(builder, plant, spec, around, rings):
    """
    The body of each pad: a closed ellipsoid of the needle mat, `body` times the pad's size, under
    its cards, so the gaps between the cards read as dense needles and the crown never shows black
    or sky through a pad. Its underside is up to `underside` darker, as a layer's shade is. It shades and sways as the cards on it do, and a face hidden inside an
    earlier pad's body is left out, so the bodies' union stays closed.
    """
    top, reach = plant_top(plant), plant_reach(plant)
    center = Vector(np.array([tuple(c) for c, _, _ in plant.pads]).mean(axis=0))
    shade = spec.get('shade', 0.35)
    bodies = [(c, Vector((r.x * spec['body'], r.y * spec['body'], r.z * spec['body']))) for c, r, _ in plant.pads]
    for index, ((c, r), (_, _, branch)) in enumerate(zip(bodies, plant.pads)):
        rows = []
        for i in range(rings + 1):
            t = i / rings
            lift, spread = -math.cos(math.pi * t), math.sin(math.pi * t)
            row = []
            for j in range(around + 1):
                a = 2 * math.pi * j / around
                n = Vector((spread * math.cos(a), spread * math.sin(a), lift))
                p = c + Vector((n.x * r.x, n.y * r.y, n.z * r.z))
                normal = Vector((n.x / r.x, n.y / r.y, n.z / r.z)).normalized()
                out = p - center
                out = out.normalized() if out.length > 1e-4 else normal
                rim = min(1.0, (p - center).length / max(reach, 1e-3))
                ao = shade + (1 - shade) * float(smoothstep(-0.7, 0.7, 0.8 * normal.z + 0.5 * rim - 0.1))
                # A layer is lighter on top and darker underneath, which is half of why it reads as a layer.
                ao *= 1 - spec['underside'] * float(smoothstep(0.0, -0.8, normal.z))
                color = tuple(ao * 0.85 * k for k in spec['tint'])
                sway = (0.75 * max(0.0, p.z) / top + 0.35 * math.hypot(p.x, p.y) / reach, branch_phase(branch))
                uv = (0.52 + 0.46 * j / around, 0.52 + 0.46 * t)
                row.append((builder.vertex(p, uv, color, (normal + out * spec['bend']).normalized(), sway), p))
            rows.append(row)
        hidden = lambda p, index=index: any(inside(p - o, s) < 0.95 for o, s in bodies[:index])
        for lower, upper in zip(rows, rows[1:]):
            for j in range(around):
                quad = (lower[j], lower[j + 1], upper[j + 1], upper[j])
                if not all(hidden(p) for _, p in quad):
                    builder.face(*(k for k, _ in quad))


def linear(srgb):
    """Colors as a texture stores them, in sRGB, made linear."""
    srgb = np.asarray(srgb, np.float64)
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def pine_wood(obj, plant, inverse, phase, shade):
    """
    The wood's vertex colors and sway: darker at the foot and under the pads, times `shade`, and
    the sway as the island's wood carries it, with each vertex's phase from its limb.
    """
    mesh = obj.data
    co = positions(mesh)
    top, reach = plant_top(plant), plant_reach(plant)
    ground = smoothstep(0.0, 1.0, co[:, 2])
    under = np.zeros(len(co))
    for c, r, _ in plant.pads:
        inside_across = ((co[:, 0] - c.x) / r.x) ** 2 + ((co[:, 1] - c.y) / r.y) ** 2
        under = np.maximum(under, (inside_across < 1) * (co[:, 2] < c.z) * smoothstep(1.0, 0.3, inside_across))
    light = (0.55 + 0.45 * ground) * (1 - 0.35 * under)
    colors = np.ones((len(co), 4), np.float32)
    colors[:, :3] = light[:, None] * shade[None]
    attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.ravel())
    mesh.color_attributes.active_color = attr
    weight = np.clip(0.75 * np.maximum(co[:, 2], 0) / top + 0.25 * np.hypot(co[:, 0], co[:, 1]) / reach, 0, 1)
    vertex_sway = np.stack([weight, phase[inverse] % 1.0], axis=1).astype(np.float32)
    loops = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', loops)
    uv = mesh.uv_layers[0]
    uv.name = 'UVMap'
    for extra in list(mesh.uv_layers)[1:]:
        mesh.uv_layers.remove(extra)
    sway = mesh.uv_layers.new(name='Sway')
    sway.data.foreach_set('uv', vertex_sway[loops].ravel())
    mesh.uv_layers.active = mesh.uv_layers['UVMap']


def decimated(obj, triangles, name):
    """A copy of the object cut to about `triangles` triangles, which keeps its UVs and colors."""
    copy = link(bpy.data.objects.new(name, obj.data.copy()))
    have = sum(len(p.vertices) - 2 for p in copy.data.polygons)
    if have > triangles:
        cut = copy.modifiers.new('decimate', 'DECIMATE')
        cut.ratio = triangles / have
        cut.use_collapse_triangulate = True
        depsgraph = bpy.context.evaluated_depsgraph_get()
        mesh = bpy.data.meshes.new_from_object(copy.evaluated_get(depsgraph))
        copy.modifiers.clear()
        old = copy.data
        copy.data = mesh
        bpy.data.meshes.remove(old)
    copy.data.name = name
    return copy


def trunk_axis(co, spec):
    """
    The trunk's axis: a line through the middles of the trunk's slices under the crown, as the
    slope and the foot of x and y against the height.
    """
    low = spec['bare'] * spec['height']
    heights = np.linspace(0.3, 0.9 * low, 8)
    middles = np.array([co[np.abs(co[:, 2] - z) < 0.1][:, :2].mean(axis=0) for z in heights])
    return np.polyfit(heights, middles, 1)


def trained(points, spec, axis):
    """
    Where `train_flat` moves points, as a gardener trains a pruned pine's tiers into fans. Above
    the bare trunk, a point's distance from the trunk's axis past `fan[0]` eases toward at most a
    reach to the front or the back that runs through `fan[1]`, in meters, from the lowest tier to
    the top, and its reach to the sides grows by a share that runs through `fan[2]`, so the crown
    can be deepest at its foot and widest in its middle. Limbs that spread under a crown's
    `floor` are trained up into it: past `climb[1]` meters from the trunk, above `climb[0]` of the
    height, a point rises by `climb[2]` for each meter farther out, up to the floor. The flat face
    looks to the front, -y here and +z in the exported file, which the scene turns toward its main
    view.
    """
    slope, foot = axis
    out = points.copy()
    height, low = spec['height'], spec['bare'] * spec['height']
    centre = points[:, 2:3] * slope + foot
    start, reaches, sides = spec['fan']
    share = np.clip((points[:, 2] - low) / max(height - low, 1e-3), 0, 1)
    reach = profile(reaches, share)
    side = profile(sides, share)
    offset = points[:, :2] - centre
    far = np.abs(offset) > start
    eased = offset.copy()
    eased[:, 0] = np.where(far[:, 0], np.sign(offset[:, 0]) * (start + (np.abs(offset[:, 0]) - start) * side), offset[:, 0])
    eased[:, 1] = np.where(far[:, 1], np.sign(offset[:, 1]) * (start + reach * np.tanh((np.abs(offset[:, 1]) - start) / reach)), offset[:, 1])
    blend = smoothstep(0.85 * low, low, points[:, 2])[:, None]
    out[:, :2] = centre + offset + (eased - offset) * blend
    if 'climb' in spec:
        above, beyond, rate = spec['climb']
        far_out = np.maximum(np.hypot(*(out[:, :2] - centre).T) - beyond, 0)
        rise = rate * far_out * smoothstep(above * height, (above + 0.05) * height, points[:, 2])
        out[:, 2] = np.minimum(points[:, 2] + rise, np.maximum(points[:, 2], spec['floor'] * height))
    return out


def train_flat(mesh, middles, inverse, target, rigid):
    """
    Moves the wood's cells toward their `target` places without crushing a limb: each cell moves by
    the mean of the moves of the cells within `rigid` meters of it, more than a limb's width, so a
    limb moves as a whole and keeps its round section. It returns the cells' new middles.
    """
    move = target - middles
    tree = KDTree(len(middles))
    for i, m in enumerate(middles):
        tree.insert(m, i)
    tree.balance()
    smooth = np.array([move[[n for _, n, _ in tree.find_range(m, rigid)]].mean(axis=0) for m in middles])
    co = positions(mesh) + smooth[inverse]
    mesh.vertices.foreach_set('co', co.astype(np.float32).ravel())
    mesh.update()
    return middles + smooth


def build_pine(name, spec, raw, leaf_mat, rng):
    """
    The pine's wood and needles objects at each level, its pads, its number of limb ends and of
    tiers, how many vertices of bare twig it cut, and each part's measured level errors.
    """
    path = os.path.join(raw, spec['raw'])
    with open(path, 'rb') as f:
        found = hashlib.sha256(f.read()).hexdigest()
    if found != spec['sha256']:
        raise SystemExit(f"{path} is not the raw trunk that {name} is built from: its SHA-256 is {found}, not {spec['sha256']}")
    wood, maps = import_raw(path, f'{name}-raw', spec['height'], spec['turn'], spec['sink'])
    wood.data.materials.append(raw_bark(maps, name, 512))
    # The vertex colors bring the bark's mean color to the concept's.
    shade = linear(spec['bark']) / np.maximum(linear(maps['Base Color'][..., :3].reshape(-1, 3).mean(axis=0)), 1e-3)
    co = positions(wood.data)
    edges = np.empty(len(wood.data.edges) * 2, np.int32)
    wood.data.edges.foreach_get('vertices', edges)
    cell = spec['height'] / 120
    # The limbs and their tiers are found on the wood as it grew, then the crown is trained.
    ends, inverse, middles, distance, parent, limb, around = limb_ends(co, edges.reshape(-1, 2), cell, spec['height'] / 25)
    axis = trunk_axis(co, spec)
    starts = limb_starts(ends, distance, limb)
    tiers, levels = pine_tiers(spec, ends, starts, middles, distance, parent)
    target = trained(middles, spec, axis)
    if 'wire' in spec:
        target[:, 2] += wired(target, tiers, levels, distance, limb, spec)
    middles = train_flat(wood.data, middles, inverse, target, spec['rigid'])
    plant = pine_pads(spec, tiers, levels, ends, middles, distance, axis)
    cap_trunk(plant, spec, middles, limb, axis)
    pine_wood(wood, plant, inverse, limb_phases(ends, starts, distance, parent, limb), shade)
    cut = trim_twigs(wood, plant, spec, ends, starts, inverse, middles, distance, parent, limb, around, cell, axis)
    places = crown_cards(plant, rng, spec['cards'], spec['up'], spec['depth'])

    def needles(chosen, stream, grow, body):
        leaves = leaf_part(spec, plant, chosen, stream, grow)
        pad_bodies(leaves, plant, spec, *body)
        return leaves

    full = {
        'wood': decimated(wood, spec['wood'][0], f'{name}-wood'),
        'leaves': needles(places, rng, 1.0, spec['bodies'][0]).build(f'{name}-leaves', leaf_mat),
    }
    objects, errors = list(full.values()), {f'{name}-{part}': [] for part in full}
    for k, (every, grow) in enumerate(spec['levels'], start=1):
        own = np.random.default_rng((SEED, 60 + k, sum(map(ord, name))))
        level = {
            'wood': decimated(wood, spec['wood'][k], f'{name}-wood-{k}'),
            'leaves': needles(places[::every], own, grow, spec['bodies'][k]).build(f'{name}-leaves-{k}', leaf_mat),
        }
        for part, obj in level.items():
            # Each level's error is measured, and one past the limit stops the build: the engine
            # would keep the finest level far too long, or switch to a level that looks wrong.
            error = round(level_error(obj, full[part]), 4)
            if error > spec['limit'] * spec['height']:
                raise SystemExit(f"{name}-{part}-{k}: its surface error is {error} m, over the limit of {spec['limit'] * spec['height']:.3f} m")
            errors[f'{name}-{part}'].append(error)
        objects += list(level.values())
    raw_mesh = wood.data
    bpy.data.objects.remove(wood)
    bpy.data.meshes.remove(raw_mesh)
    return objects, plant, len(ends), len(tiers), cut, errors


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

    # The pines draw from random streams of their own, after the other models, so they leave every
    # other file as it was, and a build that does not want them skips them and their raw trunks.
    wanted = PINES if 'pines' in chosen_models() else {}
    files = ['trees.glb', 'plants.glb', 'cave.glb']
    crowns = {}
    if wanted:
        raw = raw_folder()
        needles = material(
            'needles', image('needles', needle_atlas(1024, np.random.default_rng((SEED, 50)), NEEDLE_TONES, NEEDLE_TWIG, mat=True)),
            cutout=True, roughness=0.7,
        )
        pines = []
        errors = {}
        for name, spec in wanted.items():
            objects, plant, ends, tiers, cut, measured = build_pine(name, spec, raw, needles, np.random.default_rng((SEED, 51, sum(map(ord, name)))))
            pines += objects
            crowns[name] = (plant, ends, tiers, cut)
            errors.update(measured)
        report.update(export(os.path.join(out, 'pines.glb'), pines, {'needles'}, errors))
        files.append('pines.glb')

    for name, triangles in report.items():
        print(f'CREEK {name}: {triangles} triangles')
    for name, (plant, ends, tiers, cut) in crowns.items():
        print(f'CREEK {name}: {plant_top(plant):.1f} m high, {2 * plant_reach(plant):.1f} m across, '
              f'{ends} limb ends, {tiers} tiers, {len(plant.pads)} pads, {cut} vertices of bare twig cut')
    for part, measured in sorted(errors.items()) if wanted else ():
        print(f"CREEK {part} level errors: {', '.join(f'{e} m (switch at {e / PIXEL_PER_METER:.0f} m)' for e in measured)}")
    for file in files:
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
        preview_pines(shots, wanted, errors if wanted else {})


def preview_pines(shots, pines, errors):
    """
    Renders each pine's views, close views and levels under the overcast sky into `shots`. The
    levels show side by side at each switch of the needles, from their measured `errors`.
    """
    for name, spec in pines.items():
        parts = [bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']]
        # The concept's camera looks down about 27 degrees under an overcast sky, at the pine's flat
        # face; the other views show the sides it hides: the side, where the pine shows end-on, the
        # back, the top and the crown from below.
        for view, azimuth, down in (('concept', 0, 27), ('side', 90, 10), ('back', 180, 10), ('top', 30, 70), ('below', 0, -25)):
            overcast(parts, os.path.join(shots, f'{name}-{view}.png'), azimuth, down)
        # The concept's view again with no ground or sky, for the measures of layers and bare trunk.
        overcast(parts, os.path.join(shots, f'{name}-concept-matte.png'), 0, 27, matte=True)
        # Close views of the crown's middle, from the concept's camera and from below.
        overcast(parts, os.path.join(shots, f'{name}-close.png'), 0, 27, (1440, 960), 2.2, 0.7)
        overcast(parts, os.path.join(shots, f'{name}-close-below.png'), 0, -25, (1440, 960), 2.2, 0.6)
        # Each level beside the others, from the concept's camera and from below, at each switch.
        levels = [parts] + [[bpy.data.objects[f'{name}-wood-{k}'], bpy.data.objects[f'{name}-leaves-{k}']] for k in (1, 2)]
        for distance in (round(e / PIXEL_PER_METER) for e in errors[f'{name}-leaves']):
            for view, down in (('concept', 27), ('below', -15)):
                overcast_levels(levels, os.path.join(shots, f'{name}-levels-{distance}m-{view}.png'), distance, down)


def chosen_models():
    """The models that `--models <a,b>` after `--` names, or every model the script writes."""
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--models' not in args:
        return ('trees', 'plants', 'cave', 'pines')
    return tuple(args[args.index('--models') + 1].split(','))


def raw_folder():
    """The folder of raw Tripo3D models that `--raw` names after `--`."""
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--raw' not in args:
        raise SystemExit('Give the folder of raw models: blender --background --python creek.py -- <folder> --raw <folder>')
    return os.path.abspath(args[args.index('--raw') + 1])


def overcast_light(objects, size):
    """
    Stages the objects under an overcast sky: a pale grey dome as bright as the concept's sky, and
    a faint, wide sun from the upper left and front, so nothing casts a hard shadow. The plain view
    transform shows each color as the sky lights it, with no tone curve, so a picture's tones
    compare with the concept's. It returns the camera, the objects' bounds and the call that puts
    the light and the view back.
    """
    cam, low, high = stage(objects, (0.64, 0.64, 0.68), size, 64)
    scene = bpy.context.scene
    # Rays pass through many cutout cards in a crown, and run out of bounces into black otherwise.
    scene.cycles.transparent_max_bounces = 64
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects['preview-sun']
    sun.data.energy, sun.data.angle = 1.5, math.radians(50)
    sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
    view = scene.view_settings.view_transform
    scene.view_settings.view_transform = 'Standard'

    def restore():
        scene.view_settings.view_transform = view
        sun.data.angle = math.radians(0.526)

    return cam, low, high, restore


def overcast(objects, path, azimuth, down, size=(960, 960), zoom=1.0, aim=0.5, matte=False):
    """
    Renders the objects under the overcast sky, standing on a mossy ground when seen from above. The
    camera looks from
    `azimuth` degrees around the vertical, measured from the front, and `down` degrees above level,
    at the point `aim` of the way up the objects, from close enough that `zoom` times their size
    fills the frame. A `matte` picture leaves out the ground and the sky, so a measure can tell the
    plant from what is behind it.
    """
    cam, low, high, restore = overcast_light(objects, size)
    ground = bpy.data.objects.get('preview-ground')
    if ground is None:
        plane = Builder()
        plane.face(*(plane.vertex((x * 30, y * 30, 0), (0, 0), (1, 1, 1)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))))
        moss = material('preview-moss', image('preview-moss', np.full((4, 4, 3), (0.36, 0.33, 0.17), np.float32)))
        ground = plane.build('preview-ground', moss)
    # The ground shows only from above it, as a camera under it would see nothing else.
    ground.hide_render = matte or down < 0
    bpy.context.scene.render.film_transparent = matte
    middle, radius = (low + high) / 2, (high - low).length / 2
    middle.z = low.z + aim * (high.z - low.z)
    a, d = math.radians(azimuth), math.radians(down)
    direction = Vector((math.sin(a) * math.cos(d), -math.cos(a) * math.cos(d), math.sin(d)))
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'AUTO'
    cam.data.lens = 50
    cam.location = middle + direction * radius * 2.3 / zoom
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    ground.hide_render = True
    bpy.context.scene.render.film_transparent = False
    restore()


def overcast_levels(groups, path, distance, down):
    """
    The levels of a plant side by side under the overcast sky, each as a page's camera sees it
    from `distance` meters, `down` degrees above level: a 45 degree view on a screen 1,080 pixels
    high, so each level draws at the size in pixels that the page gives it there. Each level is
    drawn on its own and cut to its outline, so none is cut by the frame.
    """
    width, height = 1920, 1080
    pictures = []
    for group in groups:
        cam, low, high, restore = overcast_light(group, (width, height))
        middle = (low + high) / 2
        d = math.radians(down)
        cam.data.type = 'PERSP'
        cam.data.sensor_fit = 'VERTICAL'
        cam.data.angle_y = math.radians(45)
        cam.location = middle + Vector((0, -math.cos(d), math.sin(d))) * distance
        cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene = bpy.context.scene
        scene.render.film_transparent = True
        whole = f'{path[:-4]}-part.png'
        scene.render.filepath = whole
        bpy.ops.render.render(write_still=True)
        scene.render.film_transparent = False
        restore()
        shot = bpy.data.images.load(whole)
        texels = np.array(shot.pixels[:], np.float32).reshape(height, width, 4)
        bpy.data.images.remove(shot)
        os.remove(whole)
        rows = np.where(texels[..., 3].max(axis=1) > 0)[0]
        cols = np.where(texels[..., 3].max(axis=0) > 0)[0]
        pictures.append(texels[max(0, rows[0] - 8):rows[-1] + 9, max(0, cols[0] - 8):cols[-1] + 9])
    tall = max(p.shape[0] for p in pictures)
    sky = np.array([0.64, 0.64, 0.68], np.float32) ** (1 / 2.2)
    sheet = []
    for p in pictures:
        # The levels stand on one line, each over the sky's color.
        padded = np.zeros((tall, p.shape[1] + 16, 4), np.float32)
        padded[:p.shape[0], 8:8 + p.shape[1]] = p
        flat = np.ones_like(padded)
        flat[..., :3] = padded[..., :3] * padded[..., 3:4] + sky * (1 - padded[..., 3:4])
        sheet.append(flat)
    both = np.ascontiguousarray(np.concatenate(sheet, axis=1))
    img = bpy.data.images.new(os.path.basename(path), both.shape[1], both.shape[0], alpha=False)
    img.pixels.foreach_set(both.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)

main()
