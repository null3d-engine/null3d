# Builds the plants of the island showcase scene in Blender: three Mediterranean trees and a
# flowering shrub. Everything comes from this script and a fixed seed: the shapes, and every
# texture, which numpy paints. Nothing is downloaded.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/island.py -- <output folder> [--preview <folder>]
#
# `bun tools/samples/blender/island.ts <folder>` runs it and optimizes the files for the scene.
#
# It writes two binary glTF files into the output folder, and prints each part's triangles:
#   trees.glb   stone-pine, olive and holm-oak, each a wood node and a leaves node, with two lower
#               levels of detail (MSFT_lod): fewer, larger leaf cards and fewer, plainer branches
#   shrubs.glb  oleander, a wood node and a leaves node, with two lower levels the same way
# Each plant also has a far card, `<plant>-card`, a node of its own with a material of its own: two
# crossed upright quads and one level quad, textured from views of the full plant that Cycles
# renders in this script, for the copies too far away to need the mesh.
# A crown is a group of pads, each the foliage at the end of a branch. Its leaf cards lie on the
# pads' outer surface and face out of it, so the crown's outline is the species' own: the stone
# pine's flat umbrella, the olive's open, broken crown and the holm oak's dense dome. Each card
# shows a cluster of needles, leaves or flowers that its texture's alpha cuts out, so the leaf
# materials are masked and double sided. The wood and the cards carry ambient occlusion and tints
# in their vertex colors, which glTF multiplies into the base color.
#
# Every vertex carries its sway in the second texture coordinates (TEXCOORD_1), as `common.py`
# says: the first is the bend weight, from 0 at the root to 1 at the freest tips, and the second
# is the phase of the branch that the vertex hangs from, from 0 to 1. --preview also renders each
# plant with Cycles, a lineup of all four at their true sizes, and the same lineup at the farthest
# level of detail, for a quick look without the engine.
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

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
    TEXTURE_DIR, Builder, Plant, arguments, branch_phase, cells, close_up, crown_cards, dilate, export, fbm,
    frame_of, half, image, leaf_part, material, needle_atlas, normal_map, occlusion_of, orm, over, paint_leaf,
    paint_line, plant_reach, plant_top, preview, smoothstep, sprig_atlas, tent, tube, value_noise,
)

SEED = 20261118

# ---------------------------------------------------------------------------------------------
# Painting
# ---------------------------------------------------------------------------------------------


def clump_atlas(size, rng, leaves, length, width, tones, twig, gloss):
    """
    Four clumps of small leaves in a 2 x 2 atlas, as a dense evergreen's foliage looks from a few
    meters away: twigs that fan out from the middle of the bottom edge, and leaves set every way
    around them, thick in the middle and scattered toward a lobed edge, so a card reads as a loose
    tuft of leaves with sky between its outer ones, never as one round sheet.
    """
    cell, offsets = cells(size)
    out = np.zeros((size, size, 4), np.float32)
    mottle = fbm(size, size, 8, 8, rng, 4)
    for k, (oy, ox) in enumerate(offsets):
        tile = np.zeros((cell, cell, 4), np.float32)
        for j in range(5):
            a = math.pi / 2 + (j - 2) * 0.45 + rng.normal(0, 0.1)
            paint_line(tile, (0.5, 0.0), (0.5 + 0.35 * math.cos(a), 0.12 + 0.35 * math.sin(a)), 0.007, twig)
        lobes = rng.random(5) * 2 * math.pi
        for j in range(leaves):
            # A point in a lobed disc, its edge pulled in and out by a few waves.
            a = rng.random() * 2 * math.pi
            edge = 0.38 + 0.08 * math.cos(3 * a + lobes[0]) + 0.05 * math.cos(5 * a + lobes[1]) + 0.03 * math.cos(7 * a + lobes[2])
            r = edge * min(1.0, abs(rng.normal(0, 0.55)))
            base = (0.5 + r * math.cos(a), 0.52 + r * math.sin(a))
            angle = rng.random() * 2 * math.pi
            reach = length * (0.75 + 0.5 * rng.random())
            tip = (base[0] + math.cos(angle) * reach, base[1] + math.sin(angle) * reach)
            if not (0.04 < tip[0] < 0.96 and 0.04 < tip[1] < 0.96):
                continue
            tone = np.array(tones[k % len(tones)]) * (0.75 + 0.5 * rng.random())
            paint_leaf(tile, base, angle, reach, width, tone, 0.0, mottle[oy:oy + cell, ox:ox + cell], 0.85, gloss * rng.random())
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


def flower(tile, center, radius, tilt, turn, rng, px, py):
    """
    One oleander flower on a cell: five broad petals that twist around a pale throat, each lit on
    its leading side so the petals read as tilted, a darker ring where they meet, and the whole
    flower foreshortened by `tilt` toward `turn`, as a flower that faces a little away does.
    """
    cell = tile.shape[0]
    dx, dy = px - center[0], py - center[1]
    # Foreshortening: the flower's axis leans by `tilt` toward the direction `turn`.
    ca, sa = math.cos(turn), math.sin(turn)
    a = (dx * ca + dy * sa) / max(math.cos(tilt), 0.3)
    b = -dx * sa + dy * ca
    rr = np.hypot(a, b) / radius
    theta = np.arctan2(b, a) + rng.random() * 6.3
    twisted = theta - 0.9 * rr
    petal = 0.8 + 0.2 * np.cos(5 * twisted)
    coverage = np.clip((petal - rr) * radius * cell * 0.8 + 0.5, 0, 1)
    pink = np.array([0.9, 0.36, 0.52]) * (0.85 + 0.25 * rng.random())
    light = 0.62 + 0.3 * np.sin(5 * twisted + 0.8) + 0.25 * np.clip(rr, 0, 1)
    over(tile, pink[None, None] * light[..., None], coverage)
    ring = np.clip((0.34 - rr) * radius * cell + 0.5, 0, 1) * np.clip((rr - 0.18) * radius * cell + 0.5, 0, 1)
    over(tile, (pink * 0.6)[None, None] * np.ones((cell, cell, 1)), ring * coverage)
    throat = np.clip((0.18 - rr) * radius * cell + 0.5, 0, 1)
    over(tile, np.array([0.98, 0.88, 0.84])[None, None] * np.ones((cell, cell, 1)), throat)


def oleander_atlas(size, rng):
    """
    The oleander: two cells of long, narrow, dark leaves in whorls along a stem, and two cells of
    its flower heads: cymes of pink five-petalled flowers that face every way a little, among a few
    leaves, with a cluster of closed buds.
    """
    out = sprig_atlas(size, rng, 22, 0.42, 0.12, ([0.16, 0.3, 0.11], [0.17, 0.32, 0.12]), 0.0, [0.28, 0.3, 0.18], 0.5, (0.25, 0.7), 0, 0.15)
    cell, offsets = cells(size)
    py, px = np.mgrid[0:cell, 0:cell].astype(np.float32) / cell
    for k, (oy, ox) in enumerate(offsets[2:]):
        tile = np.zeros((cell, cell, 4), np.float32)
        mottle = value_noise(cell, cell, 16, 16, rng)
        for j in range(7):
            a = j * 2 * math.pi / 7 + rng.random() * 0.4
            paint_leaf(tile, (0.5, 0.5), a, 0.44, 0.12, np.array([0.16, 0.3, 0.11]), 0.0, mottle, 0.5, 0.15)
        heads = []
        for j in range(11 + k):
            r = 0.27 * math.sqrt(rng.random())
            a = rng.random() * 2 * math.pi
            heads.append((0.5 + r * math.cos(a), 0.5 + r * math.sin(a)))
        # The flowers lower in the cell lie under the ones above, as a head seen from its side does.
        for cx, cy in sorted(heads, key=lambda h: -h[1]):
            flower(tile, (cx, cy), 0.1 + 0.035 * rng.random(), 0.55 * rng.random(), rng.random() * 6.3, rng, px, py)
        for j in range(7):
            r = 0.3 + 0.08 * rng.random()
            a = rng.random() * 2 * math.pi
            cx, cy = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a)
            ca, sa = math.cos(a), math.sin(a)
            u = ((px - cx) * ca + (py - cy) * sa) / 0.045
            v = (-(px - cx) * sa + (py - cy) * ca) / 0.024
            bud = np.clip((1 - np.hypot(u, v)) * 0.024 * cell + 0.5, 0, 1)
            shade = (0.8 + 0.25 * np.clip(u, -1, 1))[..., None]
            over(tile, np.array([[[0.72, 0.24, 0.38]]]) * shade, bud)
        out[oy:oy + cell, ox:ox + cell] = dilate(tile)
    return out


def bark(kind, w, h, rng):
    """Bark that tiles around and along a branch: color, height, and roughness."""
    if kind == 'pine':
        # Broad orange-brown plates between dark fissures that run along the trunk.
        plates = fbm(h, w, 10, 6, rng, 4)
        ridges = 1 - np.abs(2 * fbm(h, w, 6, 10, rng, 4) - 1)
        fissure = 1 - smoothstep(0.55, 0.8, ridges)
        height = plates * 0.6 - 0.8 * fissure
        flake = fbm(h, w, 24, 16, rng, 3)
        plate = np.array([0.52, 0.27, 0.15])[None, None] * (0.75 + 0.5 * plates[..., None]) * (0.85 + 0.3 * flake[..., None])
        color = plate * (1 - fissure[..., None]) + np.array([0.17, 0.14, 0.12]) * fissure[..., None]
        rough = 0.8 + 0.15 * fissure
    elif kind == 'olive':
        # Pale grey bark with twisted furrows and patches of lichen.
        twist = np.arange(w)[None, :] / w + np.arange(h)[:, None] / h * 0.6
        ridges = 0.5 + 0.5 * np.sin(twist * np.pi * 2 * 9 + fbm(h, w, 6, 6, rng, 4) * 8)
        furrow = smoothstep(0.65, 0.95, ridges)
        mottle = fbm(h, w, 6, 4, rng, 5)
        height = 0.4 * mottle - 0.6 * furrow
        color = np.array([0.45, 0.43, 0.38])[None, None] * (0.8 + 0.35 * mottle[..., None])
        color = color * (1 - 0.55 * furrow[..., None])
        lichen = smoothstep(0.66, 0.82, fbm(h, w, 8, 6, rng, 4))
        color = color * (1 - 0.5 * lichen[..., None]) + np.array([0.62, 0.64, 0.5]) * 0.5 * lichen[..., None]
        rough = 0.82 + 0.12 * furrow
    elif kind == 'holm':
        # Dark bark broken into small square scales.
        across = 0.5 + 0.5 * np.sin(np.arange(w)[None, :] / w * np.pi * 2 * 14 + fbm(h, w, 8, 8, rng, 3) * 4)
        along = 0.5 + 0.5 * np.sin(np.arange(h)[:, None] / h * np.pi * 2 * 26 + fbm(h, w, 8, 8, rng, 3) * 4)
        cracks = np.maximum(smoothstep(0.82, 0.97, across), smoothstep(0.86, 0.98, along))
        mottle = fbm(h, w, 6, 4, rng, 4)
        height = 0.3 * mottle - 0.7 * cracks
        color = np.array([0.26, 0.22, 0.19])[None, None] * (0.8 + 0.35 * mottle[..., None]) * (1 - 0.6 * cracks[..., None])
        rough = 0.85 + 0.1 * cracks
    else:
        # The oleander's smooth grey-green stems.
        mottle = fbm(h, w, 6, 4, rng, 4)
        height = 0.15 * mottle
        color = np.array([0.36, 0.37, 0.29])[None, None] * (0.85 + 0.3 * mottle[..., None])
        rough = 0.7 + 0.1 * mottle
    return color, height, rough


# ---------------------------------------------------------------------------------------------
# Skeletons and crowns
# ---------------------------------------------------------------------------------------------


def path(start, direction, length, r0, r1, steps, rng, wobble=0.1, pull=(0, 0, 0)):
    """A branch's points and radii: `steps` steps along a direction that wobbles and leans toward `pull`."""
    points, radii = [Vector(start)], [r0]
    d = Vector(direction).normalized()
    pull = Vector(pull)
    for i in range(1, steps + 1):
        d = (d + pull * (1 / steps) + Vector(rng.normal(0, wobble, 3)) * 0.35).normalized()
        points.append(points[-1] + d * (length / steps))
        radii.append(r0 + (r1 - r0) * (i / steps) ** 0.8)
    return points, radii


def at(points, t):
    """The point and direction at a share `t` of a path."""
    f = t * (len(points) - 1)
    i = min(int(f), len(points) - 2)
    return points[i].lerp(points[i + 1], f - i), (points[i + 1] - points[i]).normalized()


def outward(az, tilt):
    """A direction at an azimuth, tilted from the vertical by `tilt` radians."""
    return Vector((math.sin(tilt) * math.cos(az), math.sin(tilt) * math.sin(az), math.cos(tilt)))


def stone_pine(rng):
    """
    A stone pine: a tall bare trunk with a slight lean, forking high into a few limbs that spread
    out and up, and a flat, wide umbrella of needle pads at their ends. A few dead stubs stay on the
    trunk below the crown, as on a pine that shed its lower branches.
    """
    plant = Plant()
    lean = outward(rng.random() * 2 * math.pi, math.radians(4 + 4 * rng.random()))
    points, radii = path((0, 0, -0.3), lean, 9.6, 0.36, 0.22, 10, rng, 0.04)
    trunk = plant.branch(points, radii, 0)
    fork = points[-1]
    for k in range(3):
        p, d = at(points, 0.35 + 0.35 * rng.random())
        stub = outward(rng.random() * 6.3, math.radians(70 + 15 * rng.random()))
        plant.branch(*path(p, stub, 0.5 + 0.4 * rng.random(), 0.05, 0.03, 2, rng, 0.05), 2)
    limbs = 5
    for k in range(limbs):
        az = k * 2 * math.pi / limbs + rng.random() * 0.7
        start = fork + Vector((0, 0, -0.6 * rng.random()))
        lp, lr = path(start, outward(az, math.radians(38 + 14 * rng.random())), 3.3 + 0.8 * rng.random(), 0.17, 0.08, 6, rng, 0.06,
                      (math.cos(az) * 0.9, math.sin(az) * 0.9, -0.2))
        limb = plant.branch(lp, lr, 1)
        plant.pad(lp[-1] + Vector((0, 0, 0.45)), (1.7, 1.7, 0.75), limb)
        for j in range(3):
            p, d = at(lp, 0.55 + 0.4 * j / 3 + 0.1 * rng.random())
            a = az + (j - 1) * 0.9 + rng.normal(0, 0.25)
            sp, sr = path(p, outward(a, math.radians(70 + 12 * rng.random())), 1.2 + 0.8 * rng.random(), 0.06, 0.025, 3, rng, 0.08, (0, 0, 0.25))
            twig = plant.branch(sp, sr, 2)
            plant.pad(sp[-1] + Vector((0, 0, 0.3)), (1.6 + 0.5 * rng.random(), 1.6 + 0.5 * rng.random(), 0.6 + 0.15 * rng.random()), twig)
    # The crown's middle fills too, over the fork, so the umbrella shows no hole from above.
    plant.pad(fork + Vector((0, 0, 1.6)), (2.0, 2.0, 0.8), trunk)
    return plant


def olive(rng):
    """
    An olive: a short trunk of two or three stems that twist around each other, which part into
    kinked limbs, and an open, broken crown of small leafy pads at their ends.
    """
    plant = Plant()
    stems = 3
    for k in range(stems):
        a0 = k * 2 * math.pi / stems + rng.random() * 0.5
        points, radii = [], []
        for i in range(9):
            t = i / 8
            a = a0 + 2.2 * t
            r = 0.16 + 0.07 * math.sin(t * 7 + k) + 0.06 * t
            points.append(Vector((math.cos(a) * r, math.sin(a) * r, -0.3 + 2.3 * t)))
            radii.append((0.23 - 0.07 * t) * (1 + 0.22 * math.sin(t * 11 + k * 2)))
        stem = plant.branch(points, radii, 0)
        for j in range(2):
            az = a0 + (j - 0.5) * 1.1 + rng.normal(0, 0.2)
            lp, lr = path(points[-1], outward(az, math.radians(28 + 22 * rng.random())), 2.6 + 1.0 * rng.random(), 0.12, 0.05, 5, rng, 0.28,
                          (math.cos(az) * 0.4, math.sin(az) * 0.4, 0.2))
            limb = plant.branch(lp, lr, 1)
            for m in range(3):
                p, d = at(lp, 0.45 + 0.5 * m / 3 + 0.1 * rng.random())
                a = az + (m - 1) * 1.0 + rng.normal(0, 0.3)
                sp, sr = path(p, outward(a, math.radians(35 + 30 * rng.random())), 1.0 + 0.8 * rng.random(), 0.045, 0.018, 3, rng, 0.25, (0, 0, 0.2))
                twig = plant.branch(sp, sr, 2)
                size = 0.85 + 0.45 * rng.random()
                plant.pad(sp[-1] + Vector((0, 0, 0.1)), (size, size, 0.6 + 0.25 * rng.random()), twig)
    # A thinner pad over the middle, so the crown is broken but has no gap down its middle.
    plant.pad((0, 0, 4.4), (1.2, 1.2, 0.8), stem)
    return plant


def holm_oak(rng):
    """
    A holm oak: a short, stout trunk that parts into a few thick limbs, which show under the
    crown's edge, and a dense, dark dome of rounded sub-domes, one at each limb's and twig's end.
    """
    plant = Plant()
    lean = outward(rng.random() * 2 * math.pi, math.radians(4))
    points, radii = path((0, 0, -0.3), lean, 2.3, 0.5, 0.36, 4, rng, 0.06)
    trunk = plant.branch(points, radii, 0)
    top = points[-1]
    limbs = 5
    for k in range(limbs):
        az = k * 2 * math.pi / limbs + rng.random() * 0.6
        lp, lr = path(top, outward(az, math.radians(34 + 14 * rng.random())), 3.9 + 0.8 * rng.random(), 0.24, 0.08, 6, rng, 0.12, (0, 0, 0.6))
        limb = plant.branch(lp, lr, 1)
        plant.pad(lp[-1] + Vector((0, 0, 0.5)), (2.2, 2.2, 1.9), limb)
        for j in range(2):
            p, d = at(lp, 0.55 + 0.3 * j + 0.1 * rng.random())
            a = az + (j - 0.5) * 1.4 + rng.normal(0, 0.2)
            sp, sr = path(p, outward(a, math.radians(35 + 20 * rng.random())), 1.4 + 0.6 * rng.random(), 0.07, 0.03, 3, rng, 0.1)
            twig = plant.branch(sp, sr, 2)
            size = 1.7 + 0.4 * rng.random()
            plant.pad(sp[-1] + Vector((0, 0, 0.2)), (size, size, size * 0.9), twig)
    plant.pad(top + Vector((0, 0, 5.8)), (2.6, 2.6, 2.2), trunk)
    plant.pad(top + Vector((0, 0, 3.9)), (3.0, 3.0, 1.9), trunk)
    return plant


def oleander(rng):
    """
    An oleander: many stems from one clump, from upright in the middle to nearly level at the rim,
    where they arch up, each as long as reaches the shrub's rounded outline, about as wide as it is
    high.
    """
    plant = Plant()
    stems = 16
    for k in range(stems):
        az = k * 2.39996 + rng.random() * 0.5
        foot = Vector((math.cos(az), math.sin(az), 0)) * 0.18 * math.sqrt(rng.random()) + Vector((0, 0, -0.15))
        tilt = math.radians(70 * (k + 0.5) / stems)
        d = outward(az, tilt)
        # The stem ends on an upright half ellipsoid about two meters across and two meters high.
        length = (0.92 + 0.12 * rng.random()) / math.sqrt((math.sin(tilt) / 1.1) ** 2 + (math.cos(tilt) / 2.25) ** 2)
        sp, sr = path(foot, d, length, 0.028, 0.01, 2, rng, 0.05, (0, 0, 0.35 * math.sin(tilt)))
        plant.branch(sp, sr, 1)
    return plant


# ---------------------------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------------------------


def wood_part(spec, plant, depth, fewer, thin):
    """The wood: branches down to `depth` levels, `fewer` sides each, every `thin`-th ring kept."""
    wood = Builder()
    top = plant_top(plant)
    reach = plant_reach(plant)
    for index, (points, radii, level) in enumerate(plant.branches):
        if level > depth:
            continue
        keep = list(range(0, len(points), thin))
        if keep[-1] != len(points) - 1:
            keep.append(len(points) - 1)
        pts, rad = [points[i] for i in keep], [radii[i] for i in keep]
        if len(pts) < 2:
            continue
        r = rad[0]
        around = max(1, round(2 * math.pi * r / 0.6))
        along = 2 * math.pi * r / around * 2

        def wood_color(p, t, level=level):
            # Darker at the foot and deep in the crown.
            ground = smoothstep(0.0, 1.2, p.z)
            shade = (0.62 + 0.38 * ground) * (0.8 if level >= 2 else 1.0)
            return (shade, shade, shade)

        flare = None
        if level == 0 and spec['flare'] > 0:
            phase = index * 1.7
            lift = spec['flare']
            flare = lambda z, a, phase=phase, lift=lift: 1 + lift * math.exp(-max(z, 0) / 0.45) * (
                0.4 + 0.6 * max(0.0, math.cos(4 * a + phase)) ** 2
            )
        sides = max(3, spec['sides'][min(level, 2)] - fewer)
        sway_of = lambda p, t, index=index: (
            0.75 * max(0.0, p.z) / top + 0.25 * math.hypot(p.x, p.y) / reach, branch_phase(index))
        tube(wood, pts, rad, sides, (around, max(along, 0.3)), wood_color, flare, sway_of)
    wood.normals = [None] * len(wood.positions)
    return wood


def oleander_places(plant, rng):
    """
    The oleander's cards: leaf whorls from low on each stem to its tip, more on short side shoots
    that fill the clump, and at each tip a cyme of three flower heads that face up and out.
    Each is (point, facing, stem, flower).
    """
    places = []
    for index, (points, _, _) in enumerate(plant.branches):
        for k in range(11):
            p, d = at(points, 0.03 + 0.94 * k / 11)
            n = Vector((p.x, p.y, 0)) + Vector(rng.normal(0, 0.6, 3))
            n = (n - d * n.dot(d))
            n = n.normalized() if n.length > 1e-3 else frame_of(d)[0]
            places.append((p, n, index, False))
        for k in range(5):
            p, d = at(points, 0.2 + 0.6 * rng.random())
            out = Vector((p.x, p.y, 0.3))
            out = out.normalized() if out.length > 1e-3 else Vector((0, 0, 1))
            places.append((p + out * 0.15, (out + Vector(rng.normal(0, 0.3, 3))).normalized(), index, False))
        # A cyme at the tip, and on every other stem a second one on a side shoot below it.
        for t, heads in ((1.0, 3), (0.78, 2 if index % 2 else 0)):
            p, d = at(points, t)
            out = Vector((p.x, p.y, 0))
            out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
            p = p + out * (0.0 if t == 1.0 else 0.18)
            for k in range(heads):
                offset = Vector(rng.normal(0, 0.08, 3))
                facing = (out * 0.6 + Vector((0, 0, 1)) + Vector(rng.normal(0, 0.35, 3))).normalized()
                places.append((p + offset + Vector((0, 0, 0.03)), facing, index, True))
    return places


def oleander_cards(spec, plant, places, rng, grow):
    """The oleander's cards: leaves that run along their stems, and flower heads that face up and out."""
    cards = Builder()
    top = plant_top(plant)
    center = Vector((0, 0, top * 0.5))
    for p, n, branch, flower in places:
        if flower:
            facing = n
            along = frame_of(facing)[0]
            size = (0.36 + 0.08 * rng.random()) * grow
            cell = 2 + int(rng.random() * 2)
            base = p - along * size * 0.5
            color = (1.0, 1.0, 1.0)
            rise = 0.3
        else:
            _, d = at(plant.branches[branch][0], 0.5)
            facing = n
            along = (d + Vector((0, 0, 0.3)) - facing * d.dot(facing))
            along = along.normalized() if along.length > 1e-3 else frame_of(facing)[0]
            size = (0.42 + 0.12 * rng.random()) * grow
            cell = int(rng.random() * 2)
            base = p - along * size * 0.2
            # Darker deep in the clump and near the ground.
            depth = min(1.0, Vector((p.x, p.y, 0)).length / 0.7)
            ao = 0.45 + 0.55 * min(1.0, 0.5 * depth + 0.5 * float(smoothstep(0.0, 1.6, p.z)))
            color = (ao * 0.95, ao, ao * 0.9)
            rise = 0.18
        cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
        sway = (max(0.0, p.z) / top, branch_phase(branch))
        tent(cards, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, rise, 0.5)
    return cards


# The species: their bark, how their cards sit, and their card budget. The cards' own shape and
# turn (card, lift, scatter, centered, cells, fold, bend, tent and tint) are as `leaf_part` says.
#   cards    cards at the full level
#   up       how much more of the cards gather where a pad's surface faces the sky
#   depth    how deep under the pads' surface the cards reach, as a share of a pad's size
#   levels   the species' own lower levels, where its cards differ in size from the others'
#   flare    how far the trunk's foot spreads into roots; sides are each level's sides
TREES = {
    'stone-pine': dict(
        grow=stone_pine, bark='pine', cards=700, card=1.5, lift=0.45, scatter=0.25, centered=0.5,
        cells=(0, 1, 2, 3), fold=0.06, bend=0.55, flare=0.45, sides=(8, 5, 3), tint=(1.0, 1.0, 1.0), up=0.85,
    ),
    'olive': dict(
        grow=olive, bark='olive', cards=520, card=0.85, lift=0.15, scatter=0.45, centered=0.3,
        cells=(0, 1, 2, 3), fold=0.12, bend=0.6, flare=0.35, sides=(7, 5, 3), tint=(1.0, 1.0, 1.0), up=0.5,
    ),
    'holm-oak': dict(
        grow=holm_oak, bark='holm', cards=1800, card=1.0, lift=0.1, scatter=0.4, centered=0.5,
        cells=(0, 1, 2, 3), tent=True, fold=0.2, bend=0.55, flare=0.35, sides=(9, 6, 3), tint=(1.0, 1.0, 1.0),
        up=0.5, depth=0.6,
        levels=(
            dict(every=4, grow=1.9, branches=1, sides=2, thin=2, error=0.03),
            dict(every=16, grow=3.7, branches=1, sides=6, thin=3, error=0.07),
        ),
    ),
}
SHRUB = dict(bark='stem', sides=(4, 3, 3), flare=0.0)

# The lower levels of detail, from the finest down. Each keeps one card in `every` of the full
# plant's, larger by `grow` so the crown stays as full, and draws branches up to `branches` levels
# deep with `sides` fewer sides each (three at least) and one ring in `thin`. `error` is the level's
# surface error in meters, which the engine compares with the size of a pixel at the plant's
# distance: on a screen 1,080 pixels high at a 45 degree view, a pixel spans 0.00077 m per meter
# away, so the trees' levels switch about 40 m and 90 m away.
TREE_LEVELS = (
    dict(every=3, grow=1.6, branches=1, sides=2, thin=2, error=0.03),
    dict(every=10, grow=2.9, branches=1, sides=5, thin=3, error=0.07),
)
# The shrub's levels switch about 15 m and 35 m away, since it stands a fifth as high.
SHRUB_LEVELS = (
    dict(every=2, grow=1.35, branches=1, sides=1, thin=2, error=0.012),
    dict(every=5, grow=2.1, branches=1, sides=1, thin=4, error=0.027),
)


def build_tree(name, spec, bark_mat, leaf_mat, rng):
    """A tree's wood and leaves objects, their lower levels, and the triangles of each part."""
    plant = spec['grow'](rng)
    places = crown_cards(plant, rng, spec['cards'], spec['up'], spec.get('depth', 0.25))
    wood = wood_part(spec, plant, 2, 0, 1)
    leaves = leaf_part(spec, plant, places, rng, 1.0)
    objects = [wood.build(f'{name}-wood', bark_mat), leaves.build(f'{name}-leaves', leaf_mat)]
    for k, level in enumerate(spec.get('levels', TREE_LEVELS), start=1):
        # Each level draws with a random stream of its own, so it leaves the other models as they were.
        own = np.random.default_rng((SEED, k, sum(map(ord, name))))
        objects += [
            wood_part(spec, plant, level['branches'], level['sides'], level['thin']).build(f'{name}-wood-{k}', bark_mat),
            leaf_part(spec, plant, places[:: level['every']], own, level['grow']).build(f'{name}-leaves-{k}', leaf_mat),
        ]
    return objects, plant


def build_oleander(bark_mat, leaf_mat, rng):
    """The oleander's stems and cards, and their lower levels."""
    plant = oleander(rng)
    places = oleander_places(plant, rng)
    objects = [
        wood_part(SHRUB, plant, 2, 0, 1).build('oleander-wood', bark_mat),
        oleander_cards(SHRUB, plant, places, rng, 1.0).build('oleander-leaves', leaf_mat),
    ]
    for k, level in enumerate(SHRUB_LEVELS, start=1):
        own = np.random.default_rng((SEED, k, 7))
        # The flower heads stay at every level, so the shrub keeps its color far away.
        kept = [place for i, place in enumerate(places) if place[3] or i % level['every'] == 0]
        # The far levels keep one head of each cyme, larger.
        if k == 2:
            kept = [place for i, place in enumerate(kept) if not place[3] or i % 3 == 0]
        objects += [
            wood_part(SHRUB, plant, 1, level['sides'], level['thin']).build(f'oleander-wood-{k}', bark_mat),
            oleander_cards(SHRUB, plant, kept, own, level['grow']).build(f'oleander-leaves-{k}', leaf_mat),
        ]
    return objects, plant


def bark_material(kind, rng, strength):
    color, height, rough = bark(kind, 256, 512, rng)
    return material(
        f'bark-{kind}',
        image(f'bark-{kind}-color', color),
        image(f'bark-{kind}-normal', half(normal_map(height, strength)), 'Non-Color'),
        image(f'bark-{kind}-orm', half(orm(occlusion_of(height, 12), rough)), 'Non-Color'),
    )


# ---------------------------------------------------------------------------------------------
# Far cards
# ---------------------------------------------------------------------------------------------

# The texels of each view that a card's atlas holds, side by side: the side view, then the top.
CARD_TEXELS = {'stone-pine': 512, 'olive': 512, 'holm-oak': 512, 'oleander': 256}
# The share of the crown's height, from its foot, where the top view's card lies.
CARD_TOP_AT = 0.65
# How far each face of a quad stands out from the quad's middle toward its own side, in meters, so
# a ray tracer meets the face that looks at it first.
CARD_GAP = 0.01


def bounds(objects):
    """The lowest and highest points of the objects, in their own frame."""
    co = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in objects])
    return co.min(axis=0), co.max(axis=0)


def unlit(objects):
    """
    Turns each material of the objects into an emitter of its own base color, the texture times the
    vertex colors, with its cutout, so a render shows the surfaces' colors and no light. It returns
    the call that puts the materials back.
    """
    undo = []
    for mat in {slot.material for o in objects for slot in o.material_slots if slot.material}:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        output = nodes.get('Material Output')
        bsdf = nodes.get('Principled BSDF')
        surface = output.inputs['Surface'].links[0].from_socket
        color = bsdf.inputs['Base Color'].links[0].from_socket
        alpha = bsdf.inputs['Alpha'].links[0].from_socket if bsdf.inputs['Alpha'].links else None
        glow = nodes.new('ShaderNodeEmission')
        clear = nodes.new('ShaderNodeBsdfTransparent')
        mix = nodes.new('ShaderNodeMixShader')
        links.new(color, glow.inputs['Color'])
        glow.inputs['Strength'].default_value = 1.0
        if alpha is not None:
            links.new(alpha, mix.inputs['Fac'])
        else:
            mix.inputs['Fac'].default_value = 1.0
        links.new(clear.outputs['BSDF'], mix.inputs[1])
        links.new(glow.outputs['Emission'], mix.inputs[2])
        links.new(mix.outputs['Shader'], output.inputs['Surface'])
        undo.append((mat, surface, (glow, clear, mix)))

    def restore():
        for mat, surface, added in undo:
            mat.node_tree.links.new(surface, mat.node_tree.nodes.get('Material Output').inputs['Surface'])
            for node in added:
                mat.node_tree.nodes.remove(node)

    return restore


def render_view(objects, path, size, location, rotation, scale):
    """
    Renders the objects' own colors, unlit, with an orthographic camera into a transparent image,
    and returns its texels as the PNG stores them, in sRGB.
    """
    scene = bpy.context.scene
    for o in scene.collection.objects:
        if o.type == 'MESH':
            o.hide_render = o not in objects
    cam = bpy.data.objects.get('bake-camera')
    if cam is None:
        cam = bpy.data.objects.new('bake-camera', bpy.data.cameras.new('bake-camera'))
        scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.data.clip_end = 1000
    cam.location = location
    cam.rotation_euler = rotation
    scene.camera = cam
    world = scene.world or bpy.data.worlds.new('bake')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    lights = [o for o in scene.collection.objects if o.type == 'LIGHT' and not o.hide_render]
    for light in lights:
        light.hide_render = True
    restore = unlit(objects)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.cycles.filter_width = 0.8
    scene.render.film_transparent = True
    # The plain view transform writes each color with sRGB's own curve and no tone curve, so the
    # PNG holds the surfaces' colors as a texture stores them.
    previous = scene.view_settings.view_transform
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x, scene.render.resolution_y = size, size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    rendered = bpy.data.images.load(path)
    texels = np.array(rendered.pixels[:], np.float32).reshape(size, size, 4)
    bpy.data.images.remove(rendered)
    restore()
    for light in lights:
        light.hide_render = False
    scene.render.film_transparent = False
    scene.view_settings.view_transform = previous
    return texels


def card_atlas(name, objects, size, side, top):
    """
    The card's atlas: the plant from the side and from above, each rendered orthographically over
    a square that `side` and `top` give in meters, in its own unlit colors, which carry the crown's
    depth in their vertex colors. Its alpha is the render's, hardened so a cutoff at one half keeps
    the outline, and its colors spread into the clear texels as `dilate` does.
    """
    low, high = bounds(objects)
    folder = os.path.join(TEXTURE_DIR, 'cards')
    os.makedirs(folder, exist_ok=True)
    front = render_view(objects, os.path.join(folder, f'{name}-side.png'), size,
                        (0, -500, low[2] + side / 2), (math.radians(90), 0, 0), side)
    above = render_view(objects, os.path.join(folder, f'{name}-top.png'), size,
                        (0, 0, high[2] + 100), (0, 0, 0), top)
    atlas = np.concatenate([front, above], axis=1)
    alpha = atlas[..., 3]
    atlas[..., 3] = np.clip((alpha - 0.5) * 2.5 + 0.5, 0, 1)
    return dilate(atlas)


def build_card(name, objects):
    """
    A far card of the plant: two upright quads crossed through the trunk, which show its side view,
    and one level quad through its crown, which shows the view from above. Each quad carries its
    own back faces, with the same outward normals, so a card shades the same from either side: the
    upright quads' normals lean out from the trunk and up, as the crown's do, and the level quad's
    face the sky. The card stands still in the wind, so its sway is zero.
    """
    low, high = bounds(objects)
    reach = float(max(abs(low[0]), abs(high[0]), abs(low[1]), abs(high[1])))
    side = max(2 * reach, float(high[2] - low[2]))
    top = 2 * reach
    size = CARD_TEXELS[name]
    leaves_low, _ = bounds([objects[1]])
    level = float(leaves_low[2] + CARD_TOP_AT * (high[2] - leaves_low[2]))
    texels = card_atlas(name, objects, size, side, top)
    mat = material(f'{name}-card', image(f'{name}-card', texels), cutout=True, roughness=1.0)
    b = Builder()
    up = Vector((0, 0, 1))
    for axis in (Vector((1, 0, 0)), Vector((0, 1, 0))):
        facing = axis.cross(up)
        for f in (facing, -facing):
            # The vertices run left to right as a viewer on this side sees them.
            right = (-f).cross(up)
            ids = []
            for row in (0, 1):
                for col in (-1, 0, 1):
                    p = right * col * side / 2 + Vector((0, 0, low[2] + row * side)) + f * CARD_GAP
                    u = 0.25 + 0.25 * p.dot(axis) / (side / 2)
                    n = (f * 0.35 + right * col * 0.55 + up * 0.45).normalized()
                    ids.append(b.vertex(p, (u, row), (1, 1, 1), n))
            a0, a1, a2, b0, b1, b2 = ids
            b.face(a0, a1, b1, b0)
            b.face(a1, a2, b2, b1)
    for f in (up, -up):
        right = Vector((1, 0, 0))
        ahead = f.cross(right)
        ids = []
        for corner in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = right * corner[0] * top / 2 + ahead * corner[1] * top / 2 + Vector((0, 0, level)) + f * CARD_GAP
            ids.append(b.vertex(p, (0.5 + 0.25 * (1 + p.x / (top / 2)), 0.5 + 0.5 * p.y / (top / 2)), (1, 1, 1), up))
        b.face(*ids)
    return b.build(f'{name}-card', mat)


def cull(mat):
    """
    Makes a material's back faces clear in Cycles, which culls none, so a card that carries its own
    back faces previews as the engine draws it. It runs after the export, which reads the plain
    material.
    """
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    output = nodes.get('Material Output')
    surface = output.inputs['Surface'].links[0].from_socket
    facing = nodes.new('ShaderNodeNewGeometry')
    clear = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(facing.outputs['Backfacing'], mix.inputs['Fac'])
    links.new(surface, mix.inputs[1])
    links.new(clear.outputs['BSDF'], mix.inputs[2])
    links.new(mix.outputs['Shader'], output.inputs['Surface'])


def compare_card(name, path):
    """Renders the card beside the plant's farthest level, from far above and from the ground, one over the other."""
    card = bpy.data.objects[f'{name}-card']
    cull(card.data.materials[0])
    far = [bpy.data.objects[f'{name}-wood-2'], bpy.data.objects[f'{name}-leaves-2']]
    low, high = bounds(far)
    shift = float(max(high[0] - low[0], high[1] - low[1])) * 1.3
    card.location.x = shift
    bpy.context.view_layer.update()
    rows = []
    for k, view in enumerate(((0.3, -2.0, 1.6), (0.0, -2.4, 0.12))):
        part = f'{path[:-4]}-{k}.png'
        preview([*far, card], part, view, size=(480, 240))
        shot = bpy.data.images.load(part)
        rows.append(np.array(shot.pixels[:], np.float32).reshape(240, 480, 4))
        bpy.data.images.remove(shot)
        os.remove(part)
    card.location.x = 0
    bpy.context.view_layer.update()
    both = np.concatenate(rows[::-1], axis=0)
    img = bpy.data.images.new(f'{name}-compare', 480, 480, alpha=False)
    img.pixels.foreach_set(both.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def stream(name, part):
    """The random stream of one part of one plant: its atlas, its bark or its shape."""
    return np.random.default_rng((SEED, part, sum(map(ord, name)), len(name)))


def main():
    out, shots = arguments('island.py')

    atlases = {
        'stone-pine': lambda rng: needle_atlas(1024, rng),
        'olive': lambda rng: sprig_atlas(1024, rng, 90, 0.13, 0.15, ([0.36, 0.4, 0.28], [0.32, 0.37, 0.25]), 0.3, [0.36, 0.33, 0.28], 0.6, (0.35, 0.9), 4),
        # Small oval leaves, 2 to 4 cm on a card, dark and waxy, many to a spray.
        'holm-oak': lambda rng: clump_atlas(1024, rng, 620, 0.05, 0.55, ([0.19, 0.29, 0.14], [0.21, 0.31, 0.15], [0.17, 0.26, 0.12]), [0.22, 0.18, 0.14], 0.5),
        'oleander': lambda rng: oleander_atlas(1024, rng),
    }
    leaf_mats = {
        name: material(f'{name}-leaves', image(f'{name}-leaves', paint(stream(name, 0))), cutout=True, roughness=0.62 if name == 'holm-oak' else 0.7)
        for name, paint in atlases.items()
    }
    barks = {
        kind: bark_material(kind, stream(f'bark-{kind}', 1), strength)
        for kind, strength in (('pine', 8), ('olive', 6), ('holm', 5), ('stem', 2))
    }

    trees, plants = [], {}
    for name, spec in TREES.items():
        objects, plant = build_tree(name, spec, barks[spec['bark']], leaf_mats[name], stream(name, 2))
        trees += objects
        plants[name] = plant
    shrubs, plants['oleander'] = build_oleander(barks['stem'], leaf_mats['oleander'], stream('oleander', 2))
    # Each plant's far card is baked from its full level, so it draws what the near plant does.
    cards = {}
    for name in [*TREES, 'oleander']:
        cards[name] = build_card(name, [bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']])
    trees += [cards[name] for name in TREES]
    shrubs.append(cards['oleander'])

    report = {}
    tree_cards = {f'{name}-card' for name in TREES}
    report.update(export(
        os.path.join(out, 'trees.glb'), trees, {f'{name}-leaves' for name in TREES} | tree_cards,
        [level['error'] for level in TREE_LEVELS], tree_cards,
    ))
    report.update(export(
        os.path.join(out, 'shrubs.glb'), shrubs, {'oleander-leaves', 'oleander-card'},
        [level['error'] for level in SHRUB_LEVELS], {'oleander-card'},
    ))
    for name, triangles in sorted(report.items()):
        print(f'ISLAND {name}: {triangles} triangles')
    for name, plant in plants.items():
        print(f'ISLAND {name}: {plant_top(plant):.1f} m high, {2 * plant_reach(plant):.1f} m across')
    for file in ('trees.glb', 'shrubs.glb'):
        print(f'ISLAND {file}: {os.path.getsize(os.path.join(out, file)) / 1e6:.2f} MB')
    if shots:
        names = [*TREES, 'oleander']
        for name in names:
            parts = [bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']]
            preview(parts, os.path.join(shots, f'{name}.png'), (0.9, -2.2, 0.35))
            close_up(parts, os.path.join(shots, f'{name}-close.png'))
        lineup(names, '', os.path.join(shots, 'lineup.png'))
        lineup(names, '-2', os.path.join(shots, 'lineup-far.png'), (480, 160))
        for name in names:
            compare_card(name, os.path.join(shots, f'{name}-card-compare.png'))


def lineup(names, level, path, size=(1440, 480)):
    """Renders the plants side by side at their true sizes, then puts them back."""
    objects, x = [], 0.0
    for name in names:
        parts = [bpy.data.objects[f'{name}-wood{level}'], bpy.data.objects[f'{name}-leaves{level}']]
        width = max(max(abs(v.co.x) for v in o.data.vertices) for o in parts)
        x += width
        for o in parts:
            o.location.x = x
        x += width + 1.5
        objects += parts
    bpy.context.view_layer.update()
    preview(objects, path, (0.0, -2.9, 0.2), size=size)
    for o in objects:
        o.location.x = 0
    bpy.context.view_layer.update()


main()
