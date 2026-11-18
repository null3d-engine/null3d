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
    TEXTURE_DIR, Builder, arguments, card, dilate, export, fbm, frame_of, half, image, leaf_mask, material,
    normal_map, occlusion_of, orm, over, preview, smoothstep, tube, value_noise,
)

SEED = 20261118

# ---------------------------------------------------------------------------------------------
# Painting
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


def paint_leaf(tile, base, angle, length, width, tone, underside, mottle, taper=0.72):
    """
    One leaf on a cell, from `base` at `angle`, painted only in its own box. `underside` from 0 to 1
    blends its upper face's tone toward the pale felt that an olive's leaves show beneath.
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
    color = np.array(tone)[None, None] * shade[..., None]
    pale = np.array([0.62, 0.66, 0.58])[None, None] * (0.9 + 0.1 * s[..., None])
    color = color * (1 - underside) + pale * underside
    over(tile[y0:y1, x0:x1], color, coverage)


def cells(size):
    """The four cells of a 2 x 2 atlas, as their texel offsets."""
    cell = size // 2
    return cell, [((k // 2) * cell, (k % 2) * cell) for k in range(4)]


def needle_atlas(size, rng):
    """
    The stone pine's needles: three tufts seen from above, each a burst of long fine needles from a
    hidden twig, and a cell of a twig end seen from the side with its needles brushing upward.
    Every needle stays inside its cell, and its edge fades over a texel.
    """
    cell, offsets = cells(size)
    out = np.zeros((size, size, 4), np.float32)
    for k, (oy, ox) in enumerate(offsets):
        tile = np.zeros((cell, cell, 4), np.float32)
        if k < 3:
            # Several twig ends crowd into one tuft, so its outline is lumpy, not a round brush.
            for _ in range(5):
                cx, cy = 0.5 + rng.normal(0, 0.1), 0.5 + rng.normal(0, 0.1)
                for _ in range(70):
                    a = rng.random() * 2 * math.pi
                    reach = 0.12 + 0.2 * rng.random()
                    end = (cx + math.cos(a) * reach, cy + math.sin(a) * reach)
                    end = (min(0.97, max(0.03, end[0])), min(0.97, max(0.03, end[1])))
                    tone = np.array([0.13, 0.25, 0.09]) * (0.75 + 0.5 * rng.random())
                    paint_line(tile, (cx, cy), end, 0.0045, tone)
        else:
            # A twig from the middle of the bottom edge, with needles in pairs along it.
            paint_line(tile, (0.5, 0.0), (0.5, 0.75), 0.012, [0.32, 0.2, 0.12])
            for j in range(90):
                v = 0.05 + 0.75 * rng.random()
                side = 1 if j % 2 else -1
                a = math.pi / 2 - side * (0.35 + 0.6 * rng.random())
                reach = 0.15 + 0.12 * rng.random()
                end = (0.5 + math.cos(a) * reach, v + math.sin(a) * reach)
                end = (min(0.97, max(0.03, end[0])), min(0.97, max(0.03, end[1])))
                tone = np.array([0.14, 0.26, 0.1]) * (0.75 + 0.5 * rng.random())
                paint_line(tile, (0.5, v), end, 0.0045, tone)
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


def sprig_atlas(size, rng, leaves, length, width, tones, underside, twig, taper=0.72, spread=(0.5, 1.1), twigs=0):
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
            paint_leaf(tile, base, angle, reach * max(room, 0.2), width, tone, flip, mottle[oy:oy + cell, ox:ox + cell], taper)
        for points, _ in lines:
            # Each twig ends in a leaf that carries it on.
            a, b = points[-2], points[-1]
            heading = math.atan2(b[1] - a[1], b[0] - a[0])
            paint_leaf(tile, b, heading, min(length, 0.96 - b[1]) if b[1] < 0.9 else 0.03, width, np.array(tones[0]), 0.0, mottle[oy:oy + cell, ox:ox + cell], taper)
        out[oy:oy + cell, ox:ox + cell] = tile
    return dilate(out)


def oleander_atlas(size, rng):
    """
    The oleander: two cells of leaves in whorls of three, long and narrow, and two cells of its
    flower heads, loose clusters of pink five-petalled flowers with their buds.
    """
    out = sprig_atlas(size, rng, 14, 0.42, 0.13, ([0.17, 0.3, 0.1], [0.15, 0.27, 0.09]), 0.0, [0.3, 0.32, 0.2], 0.55, (0.3, 0.75))
    cell, offsets = cells(size)
    py, px = np.mgrid[0:cell, 0:cell].astype(np.float32) / cell
    for k, (oy, ox) in enumerate(offsets[2:]):
        tile = np.zeros((cell, cell, 4), np.float32)
        # A few leaves behind the flowers, so the head sits in green.
        mottle = value_noise(cell, cell, 16, 16, rng)
        for j in range(6):
            a = j * 2 * math.pi / 6 + rng.random() * 0.4
            paint_leaf(tile, (0.5, 0.5), a, 0.42, 0.13, np.array([0.16, 0.29, 0.1]), 0.0, mottle, 0.55)
        for j in range(16 + k * 3):
            r = 0.3 * math.sqrt(rng.random())
            a = rng.random() * 2 * math.pi
            cx, cy = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a)
            radius = 0.075 + 0.035 * rng.random()
            dx, dy = px - cx, py - cy
            rr = np.hypot(dx, dy) / radius
            theta = np.arctan2(dy, dx) + rng.random() * 6.3
            # Five broad petals, each a little twisted, as an oleander's are.
            petal = 0.72 + 0.28 * np.cos(5 * theta + 1.2 * rr)
            coverage = np.clip((petal - rr) * radius * cell + 0.5, 0, 1)
            pink = np.array([0.93, 0.42, 0.58]) * (0.85 + 0.25 * rng.random())
            shade = (0.75 + 0.35 * np.clip(rr, 0, 1))[..., None]
            over(tile, pink[None, None] * shade, coverage)
            throat = np.clip((0.22 - rr) * radius * cell + 0.5, 0, 1)
            over(tile, np.array([0.98, 0.85, 0.82])[None, None] * np.ones_like(shade), throat)
        for j in range(8):
            r = 0.36 * math.sqrt(rng.random())
            a = rng.random() * 2 * math.pi
            cx, cy = 0.5 + r * math.cos(a), 0.5 + r * math.sin(a)
            bud = np.clip((0.022 - np.hypot(px - cx, py - cy)) * cell + 0.5, 0, 1)
            over(tile, np.array([[[0.8, 0.3, 0.42]]]) * np.ones((cell, cell, 1)), bud)
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


class Plant:
    """A plant's branches, as (points, radii, level), and its pads: (center, radii, branch)."""

    def __init__(self):
        self.branches, self.pads = [], []

    def branch(self, points, radii, level):
        self.branches.append((points, radii, level))
        return len(self.branches) - 1

    def pad(self, center, radii, branch):
        self.pads.append((Vector(center), Vector(radii), branch))


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
    A holm oak: a short trunk that soon parts into rising limbs, under a dense dark dome of leafy
    pads that reaches nearly to the ground.
    """
    plant = Plant()
    lean = outward(rng.random() * 2 * math.pi, math.radians(3))
    points, radii = path((0, 0, -0.3), lean, 2.6, 0.34, 0.26, 4, rng, 0.05)
    trunk = plant.branch(points, radii, 0)
    top = points[-1]
    limbs = 6
    for k in range(limbs):
        az = k * 2 * math.pi / limbs + rng.random() * 0.5
        lp, lr = path(top, outward(az, math.radians(18 + 12 * rng.random())), 5.8 + 0.8 * rng.random(), 0.17, 0.06, 6, rng, 0.1)
        limb = plant.branch(lp, lr, 1)
        plant.pad(lp[-1] + Vector((0, 0, 0.3)), (1.8, 1.8, 1.8), limb)
        for j in range(3):
            p, d = at(lp, 0.3 + 0.55 * j / 3 + 0.1 * rng.random())
            a = az + (j - 1) * 0.8 + rng.normal(0, 0.2)
            sp, sr = path(p, outward(a, math.radians(40 + 20 * rng.random())), 1.2 + 0.8 * rng.random(), 0.06, 0.025, 3, rng, 0.1)
            twig = plant.branch(sp, sr, 2)
            size = 1.6 + 0.4 * rng.random()
            plant.pad(sp[-1], (size, size, size * 0.9), twig)
    plant.pad(top + Vector((0, 0, 5.4)), (2.6, 2.6, 2.8), trunk)
    return plant


def oleander(rng):
    """
    An oleander: stems that rise from the ground in a clump and arch a little outward, each leafy
    along its upper part and flowering at its tip. Its pads are the stems' own leafy lengths.
    """
    plant = Plant()
    stems = 14
    for k in range(stems):
        az = k * 2.39996 + rng.random() * 0.5
        foot = Vector((math.cos(az), math.sin(az), 0)) * 0.25 * math.sqrt(rng.random()) + Vector((0, 0, -0.15))
        upright = k % 3 == 0
        d = outward(az, math.radians(2 + 8 * rng.random() if upright else 14 + 20 * rng.random()))
        length = (1.75 if upright else 1.45) + 0.45 * rng.random()
        sp, sr = path(foot, d, length, 0.024, 0.009, 4, rng, 0.05, (math.cos(az) * 0.4, math.sin(az) * 0.4, 0))
        plant.branch(sp, sr, 1)
    return plant


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


# ---------------------------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------------------------


def branch_phase(index):
    """A branch's phase of flutter, from its place in the plant, spread by the golden ratio."""
    return (index * 0.6180339887) % 1.0


def plant_top(plant):
    """The height of the plant's highest branch point or pad, which its sway weights are shares of."""
    tops = [p.z for points, _, _ in plant.branches for p in points]
    tops += [c.z + r.z for c, r, _ in plant.pads]
    return max(tops)


def plant_reach(plant):
    """The plant's reach from its trunk, across the ground."""
    return max([math.hypot(c.x, c.y) + r.x for c, r, _ in plant.pads] + [0.5])


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


def leaf_part(spec, plant, places, rng, grow):
    """The leaf cards on the given places, each `grow` times its usual size."""
    leaves = Builder()
    top = plant_top(plant)
    reach = plant_reach(plant)
    center = Vector(np.array([tuple(c) for c, _, _ in plant.pads]).mean(axis=0))
    tint = Vector(spec['tint'])
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
        ao = 0.35 + 0.65 * float(smoothstep(-0.7, 0.7, 0.8 * n.z + 0.5 * rim - 0.1))
        hue = 0.9 + 0.2 * rng.random()
        color = tuple(ao * hue * c for c in tint)
        sway = (0.75 * max(0.0, p.z) / top + 0.35 * math.hypot(p.x, p.y) / reach, branch_phase(branch))
        card(leaves, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, spec['fold'], spec['bend'])
    return leaves


def oleander_places(plant, rng):
    """The oleander's cards: leaf whorls along each stem's upper part, and flower heads at its tip."""
    places = []
    for index, (points, _, _) in enumerate(plant.branches):
        for k in range(7):
            t = 0.25 + 0.7 * k / 7
            p, d = at(points, t)
            n = Vector(rng.normal(0, 1, 3))
            n = (n - d * n.dot(d)).normalized()
            places.append((p, n, index, False))
        # The heads face up and out of the clump, so they show from the side as well as from above.
        for t, rise in ((1.0, 1.0), (0.82, 0.45)):
            p, d = at(points, t)
            out = Vector((p.x, p.y, 0))
            out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
            places.append((p + Vector((0, 0, 0.04)), (out + Vector((0, 0, rise))).normalized(), index, True))
    return places


def oleander_cards(spec, plant, places, rng, grow):
    """The oleander's cards: leaves along the stems, and flower heads that face up and out."""
    cards = Builder()
    top = plant_top(plant)
    center = Vector((0, 0, top * 0.55))
    for p, n, branch, flower in places:
        if flower:
            facing = (n + Vector(rng.normal(0, 0.2, 3))).normalized()
            along = frame_of(facing)[0]
            size = (0.58 + 0.15 * rng.random()) * grow
            cell = 2 + int(rng.random() * 2)
            base = p - along * size * 0.5
            color = (1.0, 1.0, 1.0)
        else:
            _, d = at(plant.branches[branch][0], 0.5)
            facing = n
            along = (d - facing * d.dot(facing)).normalized()
            size = (0.55 + 0.15 * rng.random()) * grow
            cell = int(rng.random() * 2)
            base = p - along * size * 0.15
            depth = min(1.0, Vector((p.x, p.y, 0)).length / 0.6)
            ao = 0.55 + 0.45 * depth * float(smoothstep(0.2, 1.4, p.z))
            color = (ao * 0.95, ao, ao * 0.9)
        cu, cv = (cell % 2) * 0.5, (cell // 2) * 0.5
        sway = (max(0.0, p.z) / top, branch_phase(branch))
        card(cards, base, along, facing, size, (cu, cv, cu + 0.5, cv + 0.5), color, center, sway, 0.1, 0.5)
    return cards


# The species: their bark, how their cards sit, and their card budget.
#   cards    cards at the full level; card is a card's size in meters
#   lift     how far a card's face turns from its pad's surface toward the sky
#   scatter  the random turn of each card's face
#   centered the share of a card that reaches behind its place: 0.5 centers a tuft on it
#   cells    the atlas cells the cards draw from; fold and bend shape them as `card` says
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
        grow=holm_oak, bark='holm', cards=800, card=1.45, lift=0.1, scatter=0.4, centered=0.35,
        cells=(0, 1, 2, 3), fold=0.12, bend=0.7, flare=0.5, sides=(7, 5, 3), tint=(1.0, 1.0, 1.0), up=0.45,
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
    dict(every=5, grow=2.0, branches=1, sides=1, thin=4, error=0.027),
)


def build_tree(name, spec, bark_mat, leaf_mat, rng):
    """A tree's wood and leaves objects, their lower levels, and the triangles of each part."""
    plant = spec['grow'](rng)
    places = crown_cards(plant, rng, spec['cards'], spec['up'])
    wood = wood_part(spec, plant, 2, 0, 1)
    leaves = leaf_part(spec, plant, places, rng, 1.0)
    objects = [wood.build(f'{name}-wood', bark_mat), leaves.build(f'{name}-leaves', leaf_mat)]
    for k, level in enumerate(TREE_LEVELS, start=1):
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
# The bake's light: an even white sky and a soft sun from above and in front, so a card sits in
# any hour's light. A card lies flat where the crown it stands for is deep, and the scene lights it
# again, so the bake stays a little under the leaves' own color.
BAKE_SKY = 0.8
BAKE_SUN = 1.05
# How much the bake's colors gain in saturation: the white sky greys the leaves a little, and a
# far card should keep the green of the near crown.
CARD_SATURATION = 1.15


def bounds(objects):
    """The lowest and highest points of the objects, in their own frame."""
    co = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in objects])
    return co.min(axis=0), co.max(axis=0)


def render_view(objects, path, size, location, rotation, scale):
    """Renders the objects with an orthographic camera into a transparent image, and returns its texels."""
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
    sun = bpy.data.objects.get('bake-sun')
    if sun is None:
        sun = bpy.data.objects.new('bake-sun', bpy.data.lights.new('bake-sun', 'SUN'))
        scene.collection.objects.link(sun)
    sun.data.energy = BAKE_SUN
    sun.data.angle = math.radians(30)
    sun.rotation_euler = (math.radians(40), 0, math.radians(20))
    sun.hide_render = False
    world = scene.world or bpy.data.worlds.new('bake')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = BAKE_SKY
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.cycles.filter_width = 0.8
    scene.render.film_transparent = True
    # The plain view transform keeps the texels as the render's light, with no tone curve.
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
    scene.render.film_transparent = False
    scene.view_settings.view_transform = previous
    sun.hide_render = True
    return texels


def card_atlas(name, objects, size, side, top):
    """
    The card's atlas: the plant from the side and from above, each rendered orthographically over
    a square that `side` and `top` give in meters. Its alpha is the render's, hardened so a cutoff
    at one half keeps the outline, and its colors spread into the clear texels as `dilate` does.
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
    luma = atlas[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    atlas[..., :3] = np.clip(luma[..., None] + (atlas[..., :3] - luma[..., None]) * CARD_SATURATION, 0, 1)
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


def main():
    out, shots = arguments('island.py')
    rng = np.random.default_rng(SEED)

    atlases = {
        'stone-pine': needle_atlas(1024, rng),
        'olive': sprig_atlas(1024, rng, 90, 0.13, 0.15, ([0.36, 0.4, 0.28], [0.32, 0.37, 0.25]), 0.3, [0.36, 0.33, 0.28], 0.6, (0.35, 0.9), 4),
        'holm-oak': sprig_atlas(1024, rng, 150, 0.075, 0.5, ([0.1, 0.17, 0.07], [0.12, 0.19, 0.08], [0.09, 0.15, 0.06]), 0.04, [0.25, 0.2, 0.15], 0.78, (0.4, 1.3), 6),
        'oleander': oleander_atlas(1024, rng),
    }
    leaf_mats = {
        name: material(f'{name}-leaves', image(f'{name}-leaves', texels), cutout=True, roughness=0.6 if name == 'holm-oak' else 0.7)
        for name, texels in atlases.items()
    }
    barks = {kind: bark_material(kind, rng, strength) for kind, strength in (('pine', 8), ('olive', 6), ('holm', 5), ('stem', 2))}

    trees, plants = [], {}
    for name, spec in TREES.items():
        objects, plant = build_tree(name, spec, barks[spec['bark']], leaf_mats[name], rng)
        trees += objects
        plants[name] = plant
    shrubs, plants['oleander'] = build_oleander(barks['stem'], leaf_mats['oleander'], rng)
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
            preview([bpy.data.objects[f'{name}-wood'], bpy.data.objects[f'{name}-leaves']], os.path.join(shots, f'{name}.png'), (0.9, -2.2, 0.35))
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
