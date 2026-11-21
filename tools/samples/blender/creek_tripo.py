# Finishes the Creek garden's models that start as Tripo3D meshes: the bronze statue of the seated
# Buddha. Each raw model is a download kept unchanged in the sample-assets repository, with the
# command and the task record that made it, so the build never calls the network and gives the same
# files from the same download.
#
#   blender --threads 4 --background --factory-startup \
#     --python tools/samples/blender/creek_tripo.py -- <output folder> --raw <folder> [--preview <folder>]
#     [--models <model>,<model>]
#
# `--raw` names the folder that holds one folder per model, as the sample-assets repository keeps
# them in `sources/showcase/creek-raw/`. `bun tools/samples/blender/creek_tripo.ts <folder>` runs it
# and optimizes the files for the scene.
#
# For the statue the script:
#   1. imports the raw file, bakes every transform into the vertices, joins the parts and merges
#      the seams that the file stores as doubled vertices;
#   2. cuts away the generated base and caps the cut, lowers the hair's dome, enlarges the head,
#      widens the body, turns the front to -y, scales the figure to its height in meters and
#      stands it in its slab;
#   3. builds the low oval stone slab it sits on: dark speckled stone, a rough side under a crisp
#      rim, and moss along the rim, painted once over its own texture;
#   4. decimates the figure to its triangle budget, keeping the raw texture layout;
#   5. takes the raw color and normal maps, which the decimated mesh's texture layout shares, and
#      bakes the occlusion, the curvature, the position and the facing of the raw mesh onto that
#      layout with Cycles;
#   6. weathers the raw color: its own light and dark amplified, darker in the folds and paler on
#      the ridges and the faces that look up, a warm bare chest, fine rust and lichen, sparse rain
#      streaks and pale marks on the eyes; and raises the robe's painted pleats into the normals;
#   7. cuts two lower levels of each part and measures each one's surface error;
#   8. writes one binary glTF file, with the levels in the MSFT_lod extension.
#
# It writes into the output folder, and prints each level's triangles:
#   statue.glb  statue and slab, one node each, each with two lower levels
#
# Blender's axes: z is up, and a model's front faces -y, which glTF's export turns into +z.

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# The shared module loads from beside this script, and leaves no bytecode cache in the repository.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    arguments, export, half, image, level_error, link, material, normal_map, orm, smoothstep, stage,
)

SEED = 20261120

# The threads Blender must run on. Its meshes and bakes change with the count, so the same files
# come only from the same count: build.ts passes it, and the script refuses any other.
THREADS = 4

# The statue's raw file inside its folder, and how the script finishes it. `turn` is the turn about
# the vertical axis, in degrees anticlockwise from above, that brings the raw model's front to -y.
# `cut` is the top of the raw model's own base, as a share of its height: the script cuts the base
# away and builds the slab instead, so the slab's size is exact. `height` is the statue's height
# with its slab, in meters.
#
# `dome` lowers and widens the hair's dome: what stands above `start`, a share of the figure's
# height, keeps `squash` of its height there and grows across by `widen`. `neck` is the top of the
# neck, as a share of the figure's height, which parts the head from the body. `head` enlarges the
# head about the top of the neck: `radius` is the head's reach from its axis as a share of the
# figure's height, inside which the head grows by `grow`, and beyond which the shoulders stay as
# they are. `body` reshapes the body below the neck: it grows across by `widen` about the figure's
# axis and its height is scaled by `squash`, so the figure keeps the concept's build, and the head
# rides down with the top of the neck. `eyes` are the middles of the pale marks on the eyes, as
# shares of the raw model's bounds on each axis, which ride through every change of shape with the
# mesh, and `eye` is a mark's half width and half height in meters. `chest` is the middle of the
# bare chest in the same shares, and `chest_size` the half sizes of the warm area round it, across,
# deep and up, in meters.
#
# `slab` is the stone slab, an oval: its height as a share of the figure's, its width as a share of
# the width across the knees, how far its front and back reach past the figure's in meters, the
# depth of the bevel on its rim in meters, the sides of each level, and its texture's side.
#
# `triangles` is the figure's budget at its finest level, `levels` each lower level's share of
# it, and `texture` the side of every map of the figure in texels. Each lower level of the figure
# and the slab may stray at most its share in `limits` of the height, tighter than the other
# models' `LEVEL_ERROR_LIMIT`, so that a hidden surface counted by mistake, such as a cap inside
# the slab, stops the build at both levels.
STATUE = dict(
    folder='statue',
    file='model.glb',
    turn=-90.0,
    cut=0.052,
    height=8.0,
    neck=0.673,
    dome=dict(start=0.915, squash=0.75, widen=1.08),
    head=dict(radius=0.14, grow=1.15),
    body=dict(widen=1.10, squash=0.95),
    eyes=((0.6012, 0.4499, 0.8033), (0.605, 0.5514, 0.8033)),
    eye=(0.14, 0.05),
    chest=(0.55, 0.5, 0.57),
    chest_size=(0.8, 0.5, 0.8),
    slab=dict(height=0.1, width=1.25, front=0.12, bevel=0.04, sides=(112, 56, 24), texture=1024),
    triangles=30000,
    levels=(0.34, 0.1),
    limits=(0.015, 0.02),
    texture=1024,
)

# The garden's other models from Tripo3D, each finished alone into a file of its own, from its raw
# file in its folder. `turn` brings the raw model's front to -y, `height` is its height in meters
# and `sink` how far its foot sits below the ground. `triangles` is its budget at its finest
# level, `levels` each lower level's share of it, and `texture` the side of each of its maps. The
# rest are each kind's finish, which `finish_model` reads.
#
# The lantern's stone keeps `darken` of its lightness and grows in color strength by `stone_vivid`.
# Only texels that are surely moss, between the two shares of `moss_edge`, count as moss, so the
# raw stone shows; the moss takes the `moss` tint, grows in color strength by `vivid` and keeps
# `moss_darken` of its lightness, and the moss on its cap is smoothed `smooth` times. Grey stone
# shows on the cap, which spans the shares `cap` of the height: along its ribs, from `knob`
# meters out, half `ribs[0]` meters wide there and half `ribs[1]` at the corners, each wandering
# up to `wobble` meters from its line, and over the last `eave` meters to its eaves. The moss's
# lightness varies in patches about `moss_darken`, and the cap's last `rim` meters, chipped in the
# raw mesh, are smoothed as its moss is. The gate loses the
# rear frame that Tripo3D added: everything under the roof, which starts at `roof` of its height,
# and behind the front posts' backs, which `cut` places at the foot and at the roof, and behind
# the posts within `eaves` of the middle, everything below the side ties, `tie` above the foot;
# these four are shares of its height. Its front posts stand upright again below the beam, at
# `beam` of its height, losing their lean of `lean` meters per meter, and move in until the roof
# is `spread` times their spacing; above the roof line only the posts' columns move, up to their
# brackets' tops at `brackets` of the height. A copy of the left one, `post` times as wide and
# deep and `rear` of the height behind it, its faces wandering by up to `weather` meters, stands
# behind it. The timber under the roof, above the stone blocks at `blocks` of its height, keeps
# `darken` of its lightness and grows `vivid` times in color strength. The rear post, deeper in
# the roof's shade, then takes the front posts' tone by the two shares of `rear_tone`, for
# lightness and color strength, the tiles keep the first share of `roof_tone` of their lightness,
# their light and dark round the local mean growing by the second, and all the timber takes the
# `timber_tint`, toward a weathered grey-brown. The stone blocks keep `feet[0]` of their
# lightness, and the pale band at each post's foot, `feet[1]` meters tall, takes the posts' own
# lightness, so the feet do not glare white in a bright scene.
#
# The roof dragon keeps its raw glaze colours, but its body's green-grey scales, to the end of its
# tail's curl, keep `darken` of their lightness, with its joints, the texels darker than the tiles
# round them, darkened `joints` times their own share more, while its pale grey tail fan, crest
# blades, teeth and mane keep theirs; its teeth and mane, the pale texels round the head, grow
# `teeth` times lighter; its belly band loses its pink; and its glaze's roughness is `glaze`, so it
# glints. Its base is cut level `base_cut` of its height above its lowest point and closed, so its
# foot sits flat on the gate's ridge, and the wave slab below `base[0]` of its height loses its rear
# `base[1]` of the model's length. Its head faces -y, as every model here faces, and the scene turns
# each copy to face out along the ridge.
#
# A boulder's stone keeps `darken` of its lightness, grows
# `vivid` times in color strength, and its light and dark round their local mean grow `contrast`
# times, so the pits read; its moss keeps `moss_darken` of its lightness, white specks fade
# to pale gray-green, and its foot darkens below `foot` of its height. `flatten` lowers moss that
# Tripo3D built as spikes to that share of its height above its rim, after smoothing it, and
# `wide` keeps the boulder's width within that many times its height.
MODELS = {
    'lantern': dict(file='model.glb', turn=-90.0, height=2.8, sink=0.03, triangles=1500, levels=(0.6, 0.3),
                    texture=512, darken=0.6, stone_vivid=1.5, moss_edge=(0.35, 0.75), moss=(1.02, 1.0, 0.82),
                    vivid=2.0, moss_darken=0.7, smooth=6, cap=(0.68, 0.87), knob=0.25, ribs=(0.03, 0.1), eave=0.1,
                    wobble=0.03, rim=0.08),
    'gate': dict(file='model.glb', turn=-90.0, height=3.9, sink=0.03, triangles=6000, levels=(0.4, 0.15),
                 texture=1024, roof=0.64, cut=(-0.1148, -0.0673), tie=0.6636, eaves=0.5, lean=0.09, post=0.58,
                 rear=0.273, blocks=0.08, beam=0.55, rear_tone=(1.2, 0.8), spread=1.96, brackets=0.69,
                 weather=0.012, roof_tone=(0.82, 1.8), timber_tint=(0.96, 1.0, 0.98),
                 darken=0.65, vivid=1.7, feet=(0.72, 0.45)),
    'dragon': dict(file='model.glb', turn=180.0, height=0.9, sink=0.01, triangles=3000, levels=(0.55, 0.25),
                   texture=512, base_cut=0.02, base=(0.16, 0.16), darken=0.8, joints=1.5, glaze=0.4,
                   teeth=1.25),
    'boulder-1': dict(file='model.glb', turn=0.0, height=4.0, sink=0.12, triangles=1500, levels=(0.6, 0.3),
                      texture=1024, darken=0.85, vivid=1.5, contrast=1.8, moss_darken=1.0, foot=0.08, specks=True),
    'boulder-2': dict(file='model.glb', turn=0.0, height=2.4, sink=0.08, triangles=1500, levels=(0.6, 0.3),
                      texture=1024, darken=0.85, vivid=1.5, contrast=1.8, moss_darken=0.72, foot=0.08, specks=True),
    'boulder-3': dict(file='model.glb', turn=0.0, height=0.9, sink=0.04, triangles=1500, levels=(0.6, 0.4),
                      texture=512, darken=0.85, vivid=1.5, contrast=1.8, moss_darken=0.62, foot=0.08, specks=False,
                      flatten=0.35, wide=(1.6, 2.0)),
}

# The weathered bronze. The raw color is the base: its hue and color strength stay, cyan on the
# face and hair, pale on the collar band, rusty on the knees, and its lightness is set again from
# its own light and dark, amplified by `contrast` about the display value `middle`, darker by up to
# `fold` where the occlusion is deep and the surface curves in, and paler by up to `ridge` on the
# ridges and `top` on the faces that look up, and no texel's color strength passes `strength`, so
# the raw rust stays a muted warmth. Dark specks in the raw color, which read as pits, take the
# lightness round them. A fine speckle of `mottle`, soft-edged `rust` and
# `lichen` specks a few centimeters across, and sparse rain streaks below the head lie over it.
# A streak is one of `streak_width` across, up to `streak_length` long, and moves the lightness by
# up to `streak`. `bumps` is the share of the raw normal map's small bumps that the model keeps,
# since at full strength they read as pits, and `relief` raises the color's fine light and dark,
# the robe's pleats among them, into the normals. `eye` is the color of the pale marks on the eyes,
# and `warm` the tint that turns the bare chest to a warm near-neutral, as sun bleaches it. The
# hairline stands `hairline` meters above the eyes; above it the lift on ridges and tops falls
# away, so the curls stay dark. The lower body and the statue's right arm take the `green` tint,
# from the face's cyan to the concept's gray-green. Lightness above `pale` keeps 40% of its rise,
# so pale patches such as the left knee's stay muted, and warm rust takes the `brown` tint, darker
# and less pink. The bronze on the knees keeps `knee` of its lightness, and their rust all of it.
# Last, on the upper arms and lapels, the raw color's light and dark at the pleats'
# scale is laid back over the finished color `pleats` strong, so the darkening does not squeeze
# them. Then each texel's light and dark against those round it, at the scale of the folds and the
# curls, grows `detail[0]` times on the body and `detail[1]` times on the hair, so the fine texture
# holds at a distance; the hair keeps `hair_tone` of its lightness, and the curls' gaps, deep in
# the baked occlusion, darken by up to `curls`.
PATINA = dict(
    middle=0.18,
    contrast=1.4,
    strength=0.3,
    fold=0.32,
    ridge=0.12,
    top=0.24,
    mottle=0.07,
    rust=(1.18, 0.96, 0.80),
    lichen=(0.60, 0.62, 0.57),
    streak_width=(0.03, 0.08),
    streak_length=1.6,
    streak=0.05,
    bumps=0.55,
    relief=16.0,
    eye=(0.62, 0.64, 0.60),
    warm=(1.07, 1.0, 0.88),
    hairline=0.55,
    green=(1.02, 1.0, 0.9),
    pleats=2.0,
    detail=(1.9, 3.2),
    hair_tone=0.8,
    curls=0.6,
    knee=0.7,
    pale=0.38,
    brown=(0.86, 0.80, 0.72),
)

# The preview's backdrop, the concept picture's cloud gray, in linear values.
SKY = (0.58, 0.58, 0.6)

# The slab's stone, as display colors: the stone's dark warm gray and the pale and dark specks in
# it, which `speck` of its texels carry; the moss's greyed olive from its shade to its light, the
# depth from the rim, in meters, in which its patches are likelier, and the share of the surface
# the patches cover; how far, in meters, the side wanders from its oval, against the rim's own
# wander; and `lobes`, the share by which the outline swells and shrinks round its turn, so it is
# no perfect oval.
SLAB = dict(
    stone=(0.35, 0.33, 0.29),
    pale=(0.56, 0.54, 0.49),
    dark=(0.16, 0.15, 0.13),
    speck=0.12,
    moss_shade=(0.24, 0.23, 0.13),
    moss_light=(0.44, 0.42, 0.24),
    moss_band=0.5,
    moss_cover=0.35,
    rough=0.07,
    rim=0.05,
    lobes=0.05,
)

# The largest surface error each lower level of the garden's other models may have, as a share of
# the model's height; the build stops past it. The coarser level may stray further.
LEVEL_ERROR_LIMIT = (0.05, 0.12)

# How strongly the garden's other models raise their color's light and dark into their normals.
# Each keeps all of the relief that its decimation lost; the statue's patina sets its own.
MODEL_RELIEF = 12.0


def raw_folder():
    """The folder of raw downloads that `--raw` names."""
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--raw' not in args:
        raise SystemExit('Give the raw models: creek_tripo.py -- <folder> --raw <folder of raw models>')
    return os.path.abspath(args[args.index('--raw') + 1])


# ---------------------------------------------------------------------------------------------
# The raw mesh
# ---------------------------------------------------------------------------------------------


def select_only(objects, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def import_raw(path, name):
    """
    The raw model as one mesh object with every transform baked into its vertices, its parts joined
    and its doubled seam vertices merged, and the base color and normal images of its material.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    added = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in added if o.type == 'MESH']
    if not meshes:
        raise SystemExit(f'{path} holds no mesh')
    for o in meshes:
        world = o.matrix_world.copy()
        o.parent = None
        o.data.transform(world)
        o.matrix_world = Matrix.Identity(4)
    for o in added:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    select_only(meshes, meshes[0])
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = f'{name}-raw'
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    return obj, *raw_images(obj.data.materials[0])


def source_image(socket):
    """The image that feeds a shader socket, through any nodes between them."""
    seen = [socket]
    while seen:
        s = seen.pop()
        for link_ in s.links:
            node = link_.from_node
            if node.type == 'TEX_IMAGE':
                return node.image
            seen += [i for i in node.inputs if i.is_linked]
    return None


def raw_images(mat):
    """The base color and normal images of a material that the glTF importer built."""
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    found = source_image(bsdf.inputs['Base Color']), source_image(bsdf.inputs['Normal'])
    if None in found:
        raise SystemExit(f'{mat.name} lacks a base color or a normal texture')
    return found


def vertices_of(obj):
    co = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_vertices(obj, co):
    obj.data.vertices.foreach_set('co', np.ascontiguousarray(co, np.float32).ravel())
    obj.data.update()


def cut_below(obj, share):
    """
    Cuts the mesh at a share of its height, removes all below the cut and closes it with a flat cap,
    so the mesh encloses its inside, as the build's blocker needs. The cap's texture coordinates
    meet in one point, so it takes no texels: it lies hidden in the slab.
    """
    z = vertices_of(obj)[:, 2]
    level = z.min() + share * (z.max() - z.min())
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, level), plane_no=(0, 0, 1), clear_inner=True)
    rim = [e for e in bm.edges if e.is_boundary and all(abs(v.co.z - level) < 1e-5 for v in e.verts)]
    cap = bmesh.ops.holes_fill(bm, edges=rim, sides=0)['faces']
    cap = bmesh.ops.triangulate(bm, faces=cap)['faces']
    uv = bm.loops.layers.uv.active
    for face in cap:
        for loop in face.loops:
            loop[uv].uv = (0.0, 0.0)
    bm.to_mesh(obj.data)
    bm.free()


def fill_pits(obj, depth=0.4, passes=3):
    """
    Lifts the small dents in the raw mesh that read as holes in the metal: a vertex that sinks
    below every one of its neighbors, by more than `depth` of its edges' mean length, moves to its
    neighbors' middle. A fold's valley keeps its shape, since along the valley its neighbors sink as
    deep. Returns the number of vertices moved.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    moved = 0
    for _ in range(passes):
        bm.normal_update()
        lifted = []
        for v in bm.verts:
            ring = [e.other_vert(v) for e in v.link_edges]
            if len(ring) < 3:
                continue
            rise = [(w.co - v.co).dot(v.normal) for w in ring]
            reach = sum((w.co - v.co).length for w in ring) / len(ring)
            if min(rise) > 0 and sum(rise) / len(rise) > depth * reach:
                lifted.append((v, sum((w.co for w in ring), Vector()) / len(ring)))
        for v, middle in lifted:
            v.co = middle
        moved += len(lifted)
        if not lifted:
            break
    bm.to_mesh(obj.data)
    bm.free()
    return moved


def dome_reshape(co, start, squash, widen):
    """
    The map that lowers and widens the hair's dome: all of the mesh whose vertices are `co` above
    a share `start` of its height keeps a share `squash` of its height above that level, and grows
    across by `widen` about the head's axis, the growth fading in over a short band.
    """
    low, high = co[:, 2].min(), co[:, 2].max()
    level = low + start * (high - low)
    band = 0.02 * (high - low)
    axis = co[co[:, 2] > level, :2].mean(axis=0)

    def move(p):
        weight = smoothstep(level - band, level + band, p[:, 2])
        out = p.copy()
        out[:, :2] = axis + (p[:, :2] - axis) * (1 + (widen - 1) * weight)[:, None]
        out[:, 2] = np.where(p[:, 2] > level, level + (p[:, 2] - level) * squash, p[:, 2])
        return out
    return move


def head_growth(co, neck, radius, grow):
    """
    The map that enlarges the head of the mesh whose vertices are `co` about the top of its neck,
    at the height `neck`. The growth fades in over the neck, and out beyond the head's reach from
    its axis, a share `radius` of the mesh's height, so the head stays joined to the body and the
    shoulders keep their size.
    """
    low, high = co[:, 2].min(), co[:, 2].max()
    tall = high - low
    axis = co[co[:, 2] > neck + 0.3 * (high - neck), :2].mean(axis=0)
    pivot = np.array([axis[0], axis[1], neck], np.float32)

    def move(p):
        reach = np.linalg.norm(p[:, :2] - axis, axis=1) / (radius * tall)
        weight = smoothstep(neck - 0.04 * tall, neck + 0.04 * tall, p[:, 2]) * smoothstep(1.3, 1.0, reach)
        return pivot + (p - pivot) * (1 + (grow - 1) * weight)[:, None]
    return move


def body_reshape(co, neck, widen, squash):
    """
    The map that widens the body of the mesh whose vertices are `co` below the neck, at the height
    `neck`, by `widen` about the figure's upright axis, fading out over the neck, and scales its
    height by `squash` from the foot, moving all that stands above the neck down with it.
    """
    low, high = co[:, 2].min(), co[:, 2].max()
    body = co[co[:, 2] < neck, :2]
    axis = (body.min(axis=0) + body.max(axis=0)) / 2

    def move(p):
        weight = smoothstep(neck + 0.04 * (high - low), neck - 0.04 * (high - low), p[:, 2])
        out = p.copy()
        out[:, :2] = axis + (p[:, :2] - axis) * (1 + (widen - 1) * weight)[:, None]
        out[:, 2] = np.where(p[:, 2] < neck, low + (p[:, 2] - low) * squash, p[:, 2] - (neck - low) * (1 - squash))
        return out
    return move


def standing(co, height, turn, foot):
    """
    The map that turns the mesh whose vertices are `co` about the vertical axis by `turn` degrees,
    scales it to a height, centers it over the origin and puts its lowest point at the height `foot`.
    """
    a = math.radians(turn)
    rotation = np.array([[math.cos(a), math.sin(a), 0], [-math.sin(a), math.cos(a), 0], [0, 0, 1]], np.float32)
    turned = co @ rotation
    low, high = turned.min(axis=0), turned.max(axis=0)
    middle = np.array([(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]], np.float32)
    scale = height / (high[2] - low[2])

    def move(p):
        return (p @ rotation - middle) * scale + np.array([0, 0, foot], np.float32)
    return move


def triangles_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimated(obj, triangles, name):
    """A copy of the mesh decimated to about a number of triangles, its texture layout kept."""
    copy = link(bpy.data.objects.new(name, obj.data.copy()))
    copy.data.name = name
    mod = copy.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = min(1.0, triangles / triangles_of(obj))
    mod.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(copy.evaluated_get(depsgraph))
    old = copy.data
    copy.modifiers.clear()
    copy.data = mesh
    bpy.data.meshes.remove(old)
    mesh.name = name
    mesh.shade_smooth()
    return copy


def unwrap(obj):
    """
    Lays the mesh's texture out afresh, at an even density, with no two faces on the same texels.
    A mesh decimated to a few thousand triangles folds the raw layout over itself, and a bake into
    folded texels paints one part's color onto another.
    """
    select_only([obj], obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')


# ---------------------------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------------------------


def target_material(name, img):
    """A material whose only node is the image that a bake writes into."""
    mat = bpy.data.materials.new(name)
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    return mat


def emission_material(name, build):
    """A material that emits what `build(nodes)` returns, a color socket, at strength 1."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1.0
    links.new(build(nodes), emit.inputs['Color'])
    links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def vector_socket(nodes, socket, low, size):
    """A vector socket mapped from a box into 0 to 1, as a color."""
    links = nodes.id_data.links
    sub = nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = low
    links.new(socket, sub.inputs[0])
    div = nodes.new('ShaderNodeVectorMath')
    div.operation = 'DIVIDE'
    div.inputs[1].default_value = size
    links.new(sub.outputs['Vector'], div.inputs[0])
    return div.outputs['Vector']


def image_socket(nodes, img):
    """An image's color as a socket."""
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    return tex.outputs['Color']


def to_display(linear):
    """Linear values as the display values that an sRGB texture stores."""
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


def geometry_socket(nodes, output):
    return nodes.new('ShaderNodeNewGeometry').outputs[output]


def bake(high, low, img, kind, samples, high_material=None):
    """Bakes the raw mesh onto the decimated one's texture layout into an image."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    kept = list(high.data.materials)
    if high_material is not None:
        high.data.materials.clear()
        high.data.materials.append(high_material)
    low.data.materials.clear()
    low.data.materials.append(target_material(f'{img.name}-target', img))
    select_only([high, low], low)
    bpy.ops.object.bake(
        type=kind,
        use_selected_to_active=True,
        cage_extrusion=0.04,
        max_ray_distance=0.12,
        margin=16,
        use_clear=True,
    )
    if high_material is not None:
        high.data.materials.clear()
        for m in kept:
            high.data.materials.append(m)
    return pixels_of(img)


def bake_own(low, img, build):
    """Bakes what `build(nodes)` emits from the decimated mesh's own surface into an image."""
    scene = bpy.context.scene
    scene.cycles.samples = 1
    mat = emission_material(f'{img.name}-own', build)
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    low.data.materials.clear()
    low.data.materials.append(mat)
    select_only([low], low)
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=False, margin=16, use_clear=True)
    return pixels_of(img)


def lost_relief(maps, low_position, low_facing):
    """
    The relief that the decimation lost, as normals in the texture's own directions: the raw
    surface's height above the decimated one along its normal, at each texel, turned into slopes
    by the texel's size on the surface. Every value comes from bakes that repeat exactly.
    """
    height = ((maps['position'] - low_position) * low_facing).sum(axis=2)
    across = np.linalg.norm(np.gradient(low_position, axis=1), axis=2)
    rise = np.linalg.norm(np.gradient(low_position, axis=0), axis=2)
    slope_u = np.clip(np.gradient(height, axis=1) / np.maximum(across, 1e-4), -2, 2)
    slope_v = np.clip(np.gradient(height, axis=0) / np.maximum(rise, 1e-4), -2, 2)
    n = np.dstack([-slope_u, -slope_v, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def pixels_of(img):
    """An image's texels as a float array, rows from the bottom."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def raw_texels(img, side):
    """A raw image's texels at a side, as stored: display values for color, encoded normals."""
    img = img.copy()
    if tuple(img.size) != (side, side):
        img.scale(side, side)
    return pixels_of(img)


def bake_maps(high, low, color, normal, size, bake_color=False):
    """
    Every map that the finished model and its repaint read, at twice the final size and averaged
    down, so edges stay smooth: the occlusion, curvature, position and facing baked from the raw
    mesh onto the decimated mesh's texture layout, and the raw color and normal maps, which that
    layout shares. Cycles' normal bake differs between runs in the last bit of a few texels, which
    would change the file at each build, so the raw normal map serves instead. With `bake_color`
    the color is baked from the raw mesh too: a mesh cut to a few thousand triangles moves its
    texture places far enough to smear fine detail such as roof tiles, so such a mesh is laid out
    afresh and the bake, which repeats exactly, puts each texel's color back where it belongs. The normals then come from the relief
    that the cut lost, which `lost_relief` finds from the bakes, in place of the smeared raw map.
    """
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.render.bake.margin_type = 'EXTEND'
    world = scene.world or bpy.data.worlds.new('bake')
    scene.world = world
    world.light_settings.distance = 1.2

    co = vertices_of(high)
    low_corner, extent = co.min(axis=0) - 0.01, (co.max(axis=0) - co.min(axis=0)) + 0.02

    side = size * 2
    maps = {'color': raw_texels(color, side), 'normal': raw_texels(normal, side)}

    def target(name):
        img = bpy.data.images.new(f'bake-{name}', side, side, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        return img

    emitted = {
        'curvature': lambda n: geometry_socket(n, 'Pointiness'),
        'position': lambda n: vector_socket(n, geometry_socket(n, 'Position'), low_corner, extent),
        'facing': lambda n: vector_socket(n, geometry_socket(n, 'Normal'), (-1, -1, -1), (2, 2, 2)),
    }
    if bake_color:
        emitted['color'] = lambda n: image_socket(n, color)
    for name, build in emitted.items():
        maps[name] = bake(high, low, target(name), 'EMIT', 1, emission_material(f'emit-{name}', build))
    if bake_color:
        # A texel whose rays met no raw surface, where the decimation cut a corner deeper than the
        # bake looks, bakes black, with no position: it takes its neighbors' values.
        missing = (maps['position'][..., :3].sum(axis=2) == 0).astype(np.float32)
        for name in ('color', 'curvature', 'position', 'facing'):
            maps[name] = filled(maps[name][..., :3], missing)
        maps['color'] = to_display(maps['color'])
        maps['own-position'] = bake_own(low, target('own-position'), lambda n: vector_socket(n, geometry_socket(n, 'Position'), low_corner, extent))
        maps['own-facing'] = bake_own(low, target('own-facing'), lambda n: vector_socket(n, geometry_socket(n, 'Normal'), (-1, -1, -1), (2, 2, 2)))
    # Occlusion: the low mesh would shadow the raw one that it nearly covers, so rays pass it by.
    for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_shadow', 'visible_transmission'):
        setattr(low, flag, False)
    maps['occlusion'] = bake(high, low, target('occlusion'), 'AO', 48)
    if bake_color:
        maps['occlusion'] = filled(maps['occlusion'][..., :3], missing)
    for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_shadow', 'visible_transmission'):
        setattr(low, flag, True)
    out = {name: half(texels[..., :3]) for name, texels in maps.items()}
    for name in ('position', 'own-position'):
        if name in out:
            out[name] = out[name] * extent + low_corner
    for name in ('facing', 'own-facing'):
        if name in out:
            out[name] = out[name] * 2 - 1
            out[name] /= np.maximum(np.linalg.norm(out[name], axis=2, keepdims=True), 1e-6)
    if bake_color:
        out['normal'] = lost_relief(out, out.pop('own-position'), out.pop('own-facing'))
    return out


# ---------------------------------------------------------------------------------------------
# The repaint
# ---------------------------------------------------------------------------------------------


def lattice(shape, rng):
    """A random lattice that `sample` interpolates, wrapping round its first axis."""
    return rng.random(shape).astype(np.float32)


def sample(grid, u, v):
    """Smoothly interpolated values of a lattice at fractional cells, wrapping round the first axis."""
    nu, nv = grid.shape
    u0 = np.floor(u).astype(int)
    v0 = np.clip(np.floor(v).astype(int), 0, nv - 2)
    su, sv = u - u0, np.clip(v - v0, 0, 1)
    su, sv = su * su * (3 - 2 * su), sv * sv * (3 - 2 * sv)
    u0, u1 = u0 % nu, (u0 + 1) % nu
    top = grid[u0, v0] * (1 - sv) + grid[u0, v0 + 1] * sv
    bottom = grid[u1, v0] * (1 - sv) + grid[u1, v0 + 1] * sv
    return top * (1 - su) + bottom * su


def noise3(position, cell, rng, octaves=3):
    """
    Smooth value noise in space, from 0 to 1, whose first octave's cells are `cell` meters across
    and each further octave's half as wide. Each octave's lattice repeats every 64 cells and is
    turned to an angle of its own, so a sharp cut through the noise shows no square blocks.
    """
    total, norm, weight = np.zeros(position.shape[:-1], np.float32), 0.0, 1.0
    for octave in range(octaves):
        grid = lattice((64, 64, 64), rng)
        turn, _ = np.linalg.qr(rng.normal(size=(3, 3)))
        p = (position @ turn.astype(np.float32)) / (cell / 2 ** octave)
        i = np.floor(p).astype(int)
        f = p - i
        f = f * f * (3 - 2 * f)
        value = np.zeros_like(total)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = np.abs(1 - dx - f[..., 0]) * np.abs(1 - dy - f[..., 1]) * np.abs(1 - dz - f[..., 2])
                    value += w * grid[(i[..., 0] + dx) % 64, (i[..., 1] + dy) % 64, (i[..., 2] + dz) % 64]
        total += weight * value
        norm += weight
        weight *= 0.5
    return total / norm


def rain_streaks(position, width, rng):
    """
    Long streaks of one `width` that run down the model, from 0 to 1: noise stretched along the
    vertical, laid round the model by the angle about its axis so a streak keeps its width all the
    way round. Each streak fades out toward its foot, as a run of water does.
    """
    x, y, z = position[..., 0], position[..., 1], position[..., 2]
    angle = np.arctan2(y, x) / (2 * math.pi) + 0.5
    columns = int(2 * math.pi * 2.0 / width)
    rows = int(float(z.max()) / PATINA['streak_length']) + 3
    total = np.zeros_like(z)
    for octave, weight in ((1, 0.6), (2, 0.3), (4, 0.1)):
        grid = lattice((columns * octave, rows * octave + 2), rng)
        total += weight * sample(grid, angle * columns * octave, z / PATINA['streak_length'] * octave + 1)
    streak = smoothstep(0.62, 0.9, total)
    run = (z / PATINA['streak_length']) % 1.0
    return streak * (0.4 + 0.6 * run)


def mix(a, b, share):
    """Colors `a` moved toward `b` by a share at each texel."""
    return a + (np.asarray(b, np.float32) - a) * np.clip(share, 0, 1)[..., None]


LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def repaint(maps, height, eyes, eye, chest, rng):
    """
    The finished color, as display values, and the roughness and metalness, from the raw color and
    the baked maps, as `PATINA` says. Each texel's color is the raw color scaled to its new
    lightness, so its hue and color strength stay. The pale marks on the eyes are ellipses round
    the points in `eyes` that `eye` sizes, on the faces that look forward, and `chest` is the
    middle and half sizes of the warm area on the bare chest.
    """
    raw = maps['color']
    occlusion = maps['occlusion'][..., 0]
    curvature = maps['curvature'][..., 0]
    # A small round dip in the occlusion marks a dent that the raw mesh still holds, which would
    # darken into a black pit: there the occlusion, the curvature and the facing take the values
    # round them. A fold's valley runs long, so it stays.
    dent = np.clip(box_blur(smoothstep(0.05, 0.15, dip(occlusion)), 3) * 3, 0, 1)
    occlusion = heal(occlusion, dent)
    curvature = heal(curvature, dent)
    facing = np.dstack([heal(maps['facing'][..., k], dent) for k in range(3)])
    facing /= np.maximum(np.linalg.norm(facing, axis=2, keepdims=True), 1e-6)
    position = maps['position']
    used = occlusion > 0.02

    # Curvature from Cycles' pointiness, centered on the flat surface's value and spread to its
    # range on this mesh, so that hollows read below 0 and ridges above.
    flat = np.median(curvature[used])
    spread = max(float(np.percentile(np.abs(curvature[used] - flat), 95)), 1e-4)
    bend = np.clip((curvature - flat) / spread, -1, 1)
    ridge, hollow = np.clip(bend, 0, 1), np.clip(-bend, 0, 1)
    up = smoothstep(0.2, 0.9, facing[..., 2])
    upright = 1 - np.abs(facing[..., 2])

    # Small specks darker than their surroundings in every direction read as pits in the metal:
    # they take the lightness round them. A painted pleat is dark across but not along itself, so
    # it stays.
    luma = raw @ LUMA
    speck = np.clip(box_blur(smoothstep(0.03, 0.08, dip(luma)), 3) * 3, 0, 1) * used
    luma_filled = heal(luma, speck)
    raw = raw * (luma_filled / np.maximum(luma, 0.02))[..., None]
    luma = luma_filled
    # The relief reads the filled color too, and the raw normals go flat where a speck was, so
    # the specks leave no pits in the normals.
    maps['color'] = raw
    maps['speck'] = speck
    middle = float(np.median(luma[used]))
    shade = (1 - occlusion) + 0.5 * hollow
    # The hair's curls face up and stand out, but the hair stays nearly as dark as the face: above
    # the hairline the lift on ridges and tops falls away.
    hairline = float(np.mean([p[2] for p in eyes])) + PATINA['hairline']
    hair = smoothstep(hairline - 0.1, hairline + 0.1, position[..., 2])
    ridge = ridge * (1 - 0.6 * hair)
    up = up * (1 - 0.7 * hair)
    mottle = noise3(position, 0.04, rng, 3) - 0.5
    tone = (
        PATINA['middle'] + PATINA['contrast'] * (luma - middle) - PATINA['fold'] * (shade - float(np.median(shade[used])))
        + PATINA['ridge'] * ridge + PATINA['top'] * up + PATINA['mottle'] * mottle
    )
    # Streaks: sparse runs of two widths on the faces that stand upright, below the head.
    below = smoothstep(0.7 * height, 0.62 * height, position[..., 2]) * upright
    for k, width in enumerate(PATINA['streak_width']):
        streaks = rain_streaks(position + np.array([0.37 * k, -0.21 * k, 0], np.float32), width, rng)
        tone += PATINA['streak'] * (1 if k == 0 else -1) * streaks * below
    tone = np.where(tone > PATINA['pale'], PATINA['pale'] + 0.4 * (tone - PATINA['pale']), tone)
    tone = np.clip(tone, 0.05, 0.8)
    color = raw * (tone / np.maximum(luma, 0.02))[..., None]
    # Warm rust darkens toward brown, so it reads less pale and less pink.
    rusty = smoothstep(0.0, 0.06, color[..., 0] - color[..., 1])
    color *= 1 + (np.array(PATINA['brown'], np.float32) - 1) * rusty[..., None]
    # Color strength, as the share of the brightest channel that the dullest lacks, held down by
    # moving the channels toward the texel's lightness.
    top_channel = color.max(axis=2)
    strength = (top_channel - color.min(axis=2)) / np.maximum(top_channel, 1e-4)
    keep = np.minimum(1.0, PATINA['strength'] / np.maximum(strength, 1e-4))[..., None]
    gray = (color @ LUMA)[..., None]
    color = gray + (color - gray) * keep

    # Fine rust and lichen, a few centimeters across with soft edges, rust away from the folds.
    rust = smoothstep(0.58, 0.78, noise3(position, 0.06, rng, 3)) * (0.4 + 0.6 * up) * occlusion
    color *= 1 + (np.array(PATINA['rust'], np.float32) - 1) * rust[..., None]
    lichen = smoothstep(0.7, 0.85, noise3(position, 0.03, rng, 2)) * (0.3 + 0.7 * up) * occlusion
    color = mix(color, PATINA['lichen'], 0.55 * lichen)

    # Below the chest and down the statue's right arm the cyan turns gray-green.
    z, x = position[..., 2], position[..., 0]
    waist = float(chest[0][2]) - 1.0
    lower = np.maximum(smoothstep(waist + 0.4, waist - 0.4, z), smoothstep(-1.4, -1.9, x) * smoothstep(waist + 3.0, waist + 2.4, z))
    color *= 1 + (np.array(PATINA['green'], np.float32) - 1) * lower[..., None]
    # The knees' bronze darkens, and their rust keeps its warmth and lightness.
    knee = smoothstep(1.6, 2.4, np.abs(x)) * smoothstep(waist - 0.8, waist - 1.4, z) * (1 - rusty)
    color *= (1 - (1 - PATINA['knee']) * knee)[..., None]

    # The bare chest turns a warm near-neutral, fading out to its edges.
    d = (position - np.array(chest[0], np.float32)) / np.array(chest[1], np.float32)
    warmth = smoothstep(1.0, 0.5, np.sqrt((d * d).sum(axis=2))) * smoothstep(0.0, 0.4, -facing[..., 1])
    color = mix(color, (color @ LUMA)[..., None] * np.array(PATINA['warm'], np.float32), 0.75 * warmth)

    # Matte: weathered bronze keeps a little of its metal on the rubbed ridges, none under crusts.
    roughness = np.clip(0.82 + 0.08 * (rust + lichen) - 0.06 * ridge, 0, 1)
    metal = np.clip(0.06 + 0.06 * ridge - 0.06 * (rust + lichen), 0, 1)

    # The pleats, after every darkening: the raw light and dark at their scale, on the upper arms
    # and the lapels, between the chin and the waist and off the bare chest. Pale specks rise less
    # than the ribs, so they do not glint.
    band = np.clip((box_blur(luma, 2) - box_blur(luma, 10)) / max(middle, 1e-4), -0.3, 0.12)
    chin = float(np.mean([p[2] for p in eyes]))
    robe = smoothstep(chin - 0.4, chin - 0.8, z) * smoothstep(waist - 0.2, waist + 0.3, z) * (1 - warmth)
    color *= (1 + PATINA['pleats'] * band * robe)[..., None]

    # Fine texture that holds at a distance: each texel's light and dark against the texels in use
    # round it, at the scale of the folds and the curls, grows `detail[0]` times on the body and
    # `detail[1]` times on the hair, and the hair keeps `hair_tone` of its lightness.
    final = color @ LUMA
    around = box_blur(final * used, 5) / np.maximum(box_blur(used.astype(np.float32), 5), 1e-3)
    grow = PATINA['detail'][0] + (PATINA['detail'][1] - PATINA['detail'][0]) * hair
    color *= np.clip(1 + (grow - 1) * (final / np.maximum(around, 0.02) - 1), 0.3, 1.8)[..., None]
    color *= (1 - (1 - PATINA['hair_tone']) * hair)[..., None]
    # The curls' gaps, deep in the baked occlusion, darken by up to `curls` on the hair, so the
    # curls read under any light.
    gaps = np.clip(1 - occlusion / max(float(np.median(occlusion[used & (hair > 0.5)])), 1e-3), 0, 1)
    color *= (1 - PATINA['curls'] * hair * np.clip(gaps * 3, 0, 1))[..., None]

    for middle_point in eyes:
        d = (position - np.array(middle_point, np.float32)) / np.array((eye[0], eye[0], eye[1]), np.float32)
        mark = smoothstep(1.0, 0.4, np.sqrt((d * d).sum(axis=2))) * smoothstep(0.2, 0.6, -facing[..., 1])
        color = mix(color, PATINA['eye'], 0.85 * mark)
    return np.clip(color, 0, 1), roughness, metal, occlusion


def heal(values, mask, radius=10):
    """
    A map with each masked texel moved, by its mask's share, to the mean of the unmasked texels
    round it, so a filled spot takes its surroundings' value and none of its own.
    """
    keep = 1 - mask
    mean = box_blur(values * keep, radius) / np.maximum(box_blur(keep, radius), 1e-4)
    return values + mask * (mean - values)


def filled(texels, missing):
    """
    A map whose `missing` texels take the mean of the found texels round them, from the nearest
    outward, so a hole of any size closes with its edges' values.
    """
    found = 1 - missing
    channels = [texels[..., c] for c in range(texels.shape[2])]
    for radius in (4, 16, 64):
        weight = box_blur(found, radius)
        take = (weight > 1e-3) & (found < 0.5)
        for c, values in enumerate(channels):
            mean = box_blur(values * found, radius) / np.maximum(weight, 1e-6)
            channels[c] = np.where(take, mean, values)
        found = np.where(take, 1.0, found)
    return np.dstack(channels)


def dip(luma):
    """
    How much darker each texel is than its neighbors a few texels away on both sides, in the
    direction where it is least dark, across four directions and two distances: high only for a
    small spot that is dark all round.
    """
    deepest = np.zeros_like(luma)
    for reach in (3, 5):
        sides = []
        for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
            ahead = np.roll(luma, (dy * reach, dx * reach), (0, 1))
            behind = np.roll(luma, (-dy * reach, -dx * reach), (0, 1))
            sides.append((ahead + behind) / 2 - luma)
        deepest = np.maximum(deepest, np.minimum.reduce(sides))
    return deepest


def box_blur(texels, radius):
    """A box blur of a 2D array over 2 radius + 1 texels each way, the edges held."""
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (radius + 1, radius)
        total = np.cumsum(np.pad(texels, pad, mode='edge'), axis=axis)
        n = total.shape[axis]
        texels = (np.take(total, range(2 * radius + 1, n), axis) - np.take(total, range(0, n - 2 * radius - 1), axis)) / (2 * radius + 1)
    return texels


def relief(normal, color, speck, bumps, lift):
    """
    A normal map with its small bumps kept at `bumps` of their strength, flattened where `speck`
    filled a dark speck and where it dents inward, and the color's light and dark at the scale of
    the robe's pleats raised into it as relief `lift` strong, pale above dark, so the painted
    pleats stand out. The finest speckle stays flat, so the bronze does not crinkle.
    """
    n = normal * 2 - 1
    # A dent in the normal map tilts inward from every side, so the tilt's spread runs strongly
    # negative there; bumps such as lichen run positive. The dents go flat, with a margin round
    # each.
    spread = np.gradient(n[..., 0], axis=1) + np.gradient(n[..., 1], axis=0)
    dent = np.clip(box_blur(smoothstep(0.08, 0.2, -box_blur(spread, 1)), 2) * 3, 0, 1)
    n[..., :2] *= bumps * ((1 - speck) * (1 - dent))[..., None]
    luma = color @ LUMA
    height = box_blur(luma, 2) - box_blur(luma, 10)
    rise, across = np.gradient(height)
    n[..., 0] -= lift * across
    n[..., 1] -= lift * rise
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    return n * 0.5 + 0.5


def finished_material(name, maps, painted, roughness, metal, occlusion):
    """The model's metal-rough material: the repainted color, the relief normals and the packed ORM."""
    color = image(f'{name}-color', painted)
    normal = image(f'{name}-normal', relief(maps['normal'], maps['color'], maps['speck'], PATINA['bumps'], PATINA['relief']),
                   'Non-Color')
    packed = image(f'{name}-orm', np.dstack([occlusion, roughness, metal]), 'Non-Color')
    return material(name, color, normal, packed, roughness=0.8, tint=False)


# ---------------------------------------------------------------------------------------------
# The slab
# ---------------------------------------------------------------------------------------------


def slab_profile(height, bevel, lean):
    """
    The slab's outline from its foot up its side, over the bevel to the rim on its top, as each
    ring's height and its inset from the foot's oval, the last ring being the top's edge.
    """
    side = [(-0.05, 0.0), (0.2 * height, 0.2 * lean), (0.45 * height, 0.45 * lean), (0.7 * height, 0.7 * lean),
            (height - bevel, lean)]
    return side + [(height, lean + bevel)]


def slab_layout(t, quarter, along, top, rx, ry):
    """
    Where a point of the slab lies in its texture: the top as an oval in the lower half, the side as
    four strips in the upper half, one for each quarter of the way round, from the foot at each
    strip's bottom to the rim at its top. `t` is the share of its quarter's turn, `along` its share
    of the way up the side, and `top` its place on the top.
    """
    if top is not None:
        x, y = top
        return (0.01 + 0.98 * (x + rx) / (2 * rx), 0.01 + 0.48 * (y + ry) / (2 * ry))
    return (0.01 + 0.98 * t, 0.5 + 0.125 * quarter + 0.004 + 0.117 * along)


def stone_slab(name, rx, ry, height, bevel, sides, mat):
    """
    A low stone slab, an uneven oval, from just below the ground to `height`, with semi-axes `rx`
    and `ry`. Its outline swells and shrinks round its turn. Its side leans in a little as it rises
    and wanders a few centimeters, rough as split stone, up to a bevel `bevel` deep round its top,
    whose rim wanders and chips. The same noise in space shapes
    every level of detail. The top shades flat, so the rim between it and the smooth bevel stays a
    sharp line. The texture covers the slab once, as `slab_layout` lays it out.
    """
    lean = 0.03 * min(rx, ry)
    rings = slab_profile(height, bevel, lean)
    lengths = [0.0]
    for (z0, i0), (z1, i1) in zip(rings, rings[1:]):
        lengths.append(lengths[-1] + math.hypot(z1 - z0, i1 - i0))
    # One stream of noise for every level, so the levels keep one shape.
    rng = np.random.default_rng(SEED + 1)
    angles = [2 * math.pi * i / sides for i in range(sides)]
    points = []
    for z, inset in rings:
        ring = np.array([((rx - inset) * math.cos(a), (ry - inset) * math.sin(a), z) for a in angles], np.float32)
        points.append(ring)
    points = np.array(points)
    flat = points.reshape(-1, 3)
    wander = (noise3(flat, 0.3, rng) - 0.5) * 2
    chips = (noise3(flat, 0.12, rng) - 0.5) * 2
    rim = np.repeat([z >= height - bevel - 1e-4 for z, _ in rings], sides)
    amount = np.where(rim, SLAB['rim'] * (0.5 * wander + 0.5 * chips), SLAB['rough'] * wander)
    # The outline swells and shrinks round its turn, the same at every height, so it is no oval.
    lobes = 1 + SLAB['lobes'] * (noise3(flat * np.array([1, 1, 0], np.float32), 2.0, rng, 2) - 0.5) * 2
    flat[:, :2] *= lobes[:, None]
    outward = flat[:, :2] / np.maximum(np.linalg.norm(flat[:, :2], axis=1), 1e-6)[:, None]
    flat[:, :2] += outward * amount[:, None]
    points = flat.reshape(len(rings), sides, 3)

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = [[bm.verts.new(tuple(p)) for p in ring] for ring in points]
    quarter_sides = sides // 4
    for r in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            face = bm.faces.new((grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]))
            face.smooth = True
            quarter = i // quarter_sides
            for loop, (k, row) in zip(face.loops, ((i, r), (i + 1, r), (i + 1, r + 1), (i, r + 1))):
                t = (k - quarter * quarter_sides) / quarter_sides
                loop[uv].uv = slab_layout(t, quarter, lengths[row] / lengths[-1], None, rx, ry)
    # The top: an inner ring, then a fan to the middle, all flat.
    edge = rings[-1][1]
    inner = [bm.verts.new(((rx - edge) * 0.55 * math.cos(a), (ry - edge) * 0.55 * math.sin(a), height)) for a in angles]
    middle = bm.verts.new((0.0, 0.0, height))
    for i in range(sides):
        j = (i + 1) % sides
        for corners in ((grid[-1][i], grid[-1][j], inner[j], inner[i]), (inner[i], inner[j], middle)):
            face = bm.faces.new(corners)
            face.smooth = False
            for loop in face.loops:
                loop[uv].uv = slab_layout(0, 0, 0, (loop.vert.co.x, loop.vert.co.y), rx, ry)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    return link(bpy.data.objects.new(name, mesh))


def slab_material(rx, ry, height, bevel, size, rng):
    """
    The slab's own texture, painted once over its surface as `slab_layout` lays it out: each texel
    takes its place on the slab, then dark speckled stone with pale lichen spots, darker toward the
    foot, and greyed olive moss in patches of uneven size, coarse and fine at once, likelier near
    the rim and creeping over its edge. Its normals and roughness, at half the
    color's size, follow the stone's grain and the moss's tufts.
    """
    lean = 0.03 * min(rx, ry)
    rings = slab_profile(height, bevel, lean)
    lengths = [0.0]
    for (z0, i0), (z1, i1) in zip(rings, rings[1:]):
        lengths.append(lengths[-1] + math.hypot(z1 - z0, i1 - i0))
    profile = np.array(lengths) / lengths[-1]
    v, u = np.mgrid[0:size, 0:size].astype(np.float32)
    u, v = (u + 0.5) / size, (v + 0.5) / size
    position = np.zeros((size, size, 3), np.float32)
    rim_distance = np.zeros((size, size), np.float32)

    # The top: the oval, and how far each point stands in from the rim along its ray.
    top = v < 0.5
    x = ((u - 0.01) / 0.98 * 2 - 1) * rx
    y = ((v - 0.01) / 0.48 * 2 - 1) * ry
    e = np.sqrt((x / rx) ** 2 + (y / ry) ** 2)
    position[top] = np.dstack([x, y, np.full_like(x, height)])[top]
    rim_distance[top] = (np.hypot(x, y) * np.maximum(1 / np.maximum(e, 1e-3) - 1, 0))[top]

    # The side: each strip's quarter, the share of its turn, and the way up the outline.
    quarter = np.clip(((v - 0.5) / 0.125).astype(int), 0, 3)
    along = np.clip((v - 0.5 - 0.125 * quarter - 0.004) / 0.117, 0, 1)
    angle = (quarter + np.clip((u - 0.01) / 0.98, 0, 1)) * (math.pi / 2)
    z = np.interp(along, profile, [r[0] for r in rings])
    inset = np.interp(along, profile, [r[1] for r in rings])
    side = ~top
    position[side] = np.dstack([(rx - inset) * np.cos(angle), (ry - inset) * np.sin(angle), z])[side]
    rim_distance[side] = ((1 - along) * lengths[-1])[side]

    grain = noise3(position, 0.015, rng, 2)
    specks = noise3(position + 3.1, 0.012, rng, 2)
    broad = noise3(position, 1.2, rng, 2)
    lichen = smoothstep(0.72, 0.8, noise3(position, 0.08, rng, 2))
    stone = np.broadcast_to(np.array(SLAB['stone'], np.float32), position.shape) * (0.85 + 0.3 * broad + 0.1 * (grain - 0.5))[..., None]
    pale = smoothstep(1 - SLAB['speck'], 1 - SLAB['speck'] * 0.6, specks)
    dark = smoothstep(SLAB['speck'], SLAB['speck'] * 0.6, specks)
    color = mix(stone, SLAB['pale'], pale)
    color = mix(color, SLAB['dark'], dark)
    color = mix(color, SLAB['pale'], 0.5 * lichen)
    foot = smoothstep(0.0, 0.5 * height, position[..., 2])
    color *= (0.7 + 0.3 * foot)[..., None]
    # The side mottles at a hand's breadth, and the rim wears pale in places.
    color *= (0.82 + 0.36 * noise3(position + 2.2, 0.25, rng, 2))[..., None]
    worn = smoothstep(0.08, 0.0, rim_distance) * smoothstep(0.55, 0.7, noise3(position + 9.1, 0.3, rng, 2))
    color = mix(color, SLAB['pale'], 0.6 * worn)

    # Moss in patches of uneven size, not bands: likelier near the rim, where it creeps over the
    # edge, and sparse on the side and the top, with tufts at two scales.
    near = smoothstep(SLAB['moss_band'], 0.0, rim_distance)
    clumps = np.maximum(noise3(position, 0.6, rng, 2), noise3(position + 5.3, 0.18, rng, 2) - 0.08) + 0.16 * near
    patches = smoothstep(1 - SLAB['moss_cover'] - 0.06, 1 - SLAB['moss_cover'] + 0.06, clumps)
    tufts = noise3(position, 0.02, rng, 2)
    moss = np.clip(patches * smoothstep(0.3, 0.6, tufts + 0.25 * patches), 0, 1)
    moss_color = mix(np.broadcast_to(np.array(SLAB['moss_shade'], np.float32), position.shape).copy(), SLAB['moss_light'], tufts)
    color = mix(color, moss_color, moss)

    height_field = 0.6 * grain - 0.4 * dark + 0.8 * moss * tufts
    rough = 0.86 + 0.1 * moss - 0.05 * pale
    occlusion = 0.75 + 0.25 * foot
    return material(
        'slab',
        image('slab-color', np.clip(color, 0, 1)),
        image('slab-normal', half(normal_map(height_field, 3)), 'Non-Color'),
        image('slab-orm', half(orm(occlusion, rough)), 'Non-Color'),
        roughness=0.9,
        tint=False,
    )


# ---------------------------------------------------------------------------------------------
# The garden's other models
# ---------------------------------------------------------------------------------------------


def vertex_colors_of(obj, img):
    """Each vertex's color in a raw image, as stored: the mean over its corners' texture places."""
    mesh = obj.data
    texels = pixels_of(img)[..., :3]
    h, w = texels.shape[:2]
    uv = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    owner = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', owner)
    picked = texels[np.clip((uv[:, 1] % 1) * h, 0, h - 1).astype(int), np.clip((uv[:, 0] % 1) * w, 0, w - 1).astype(int)]
    total = np.zeros((len(mesh.vertices), 3), np.float32)
    count = np.zeros(len(mesh.vertices), np.float32)
    np.add.at(total, owner, picked)
    np.add.at(count, owner, 1)
    return total / np.maximum(count, 1)[:, None]


def hue_of(color):
    """Each texel's hue, in degrees from 0 to 360."""
    r, g, b = color[..., 0], color[..., 1], color[..., 2]
    top, bottom = color.max(axis=-1), color.min(axis=-1)
    spread = np.maximum(top - bottom, 1e-6)
    hue = np.where(top == r, ((g - b) / spread) % 6, np.where(top == g, (b - r) / spread + 2, (r - g) / spread + 4))
    return hue * 60


def strength_of(color):
    """Each color's strength, as the share of its brightest channel that its dullest lacks."""
    top = color.max(axis=-1)
    return (top - color.min(axis=-1)) / np.maximum(top, 1e-4)


def mossy(color):
    """How surely each color is moss: yellow-olive, its red and green well above its blue."""
    r, g, b = color[..., 0], color[..., 1], color[..., 2]
    return smoothstep(0.25, 0.4, strength_of(color)) * smoothstep(0.02, 0.08, g - b) * smoothstep(-0.05, 0.02, r - b)


def smooth_where(obj, chosen, times, factor=0.5):
    """Smooths the chosen vertices of a mesh toward their neighbors, `times` over."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    verts = [bm.verts[i] for i in np.nonzero(chosen)[0]]
    for _ in range(times):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()


def flatten_moss(obj, color, spec):
    """
    Lowers moss that Tripo3D built as a mat of spikes to a thin cover: the mossy vertices, found by
    the raw color under them, are smoothed hard, then keep `flatten` of their height above the
    moss's rim. The model then keeps a width within `wide` times its height, and its height.
    """
    moss = mossy(vertex_colors_of(obj, color)) > 0.5
    smooth_where(obj, moss, 30)
    co = vertices_of(obj)
    rim = float(np.percentile(co[moss, 2], 10))
    co[moss, 2] = np.where(co[moss, 2] > rim, rim + (co[moss, 2] - rim) * spec['flatten'], co[moss, 2])
    extent = co.max(axis=0) - co.min(axis=0)
    wide = max(extent[0], extent[1]) / extent[2]
    co[:, 2] *= wide / float(np.clip(wide, *spec['wide']))
    set_vertices(obj, standing(co, spec['height'], 0.0, -spec['sink'])(co))
    return int(moss.sum())


def cut_away(bm, faces, point, normal):
    """
    Cuts the faces with the plane through `point` along `normal` and removes what lies on the
    normal's side; returns how many faces went. Each element goes in once, in the mesh's own
    order: a set's order changes from run to run, and the cut makes its new vertices in the order
    it gets them.
    """
    verts = list(dict.fromkeys(v for f in faces for v in f.verts))
    edges = list(dict.fromkeys(e for f in faces for e in f.edges))
    before = len(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=verts + edges + faces, plane_co=point, plane_no=normal, clear_outer=True)
    return before - len(bm.faces)


def close_cuts(bm, uv):
    """
    Drops the vertices that cuts left alone and closes every hole they opened, each new face
    painted from the texture places of the rim round it.
    """
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    known = {}
    for f in bm.faces:
        for corner in f.loops:
            known.setdefault(corner.vert, corner[uv].uv.copy())
    rims = [e for e in bm.edges if e.is_boundary]
    closed = bmesh.ops.holes_fill(bm, edges=rims, sides=0)['faces']
    closed = bmesh.ops.triangulate(bm, faces=closed)['faces']
    for f in closed:
        for corner in f.loops:
            corner[uv].uv = known.get(corner.vert, corner[uv].uv)


def trim_base(obj, spec):
    """
    Cuts away the dragon's base past the body's rear foot: the wave slab, below `base[0]` of the
    height, runs `base[1]` of the model's length further back than the photo's waves, which lie
    under the body's rise only. The plate under the head stays, since the foot stands on it.
    Returns how many faces went.
    """
    co = vertices_of(obj)
    low, high = co[:, 2].min(), co[:, 2].max()
    front, rear = co[:, 1].min(), co[:, 1].max()
    top = low + spec['base'][0] * (high - low)
    edge = rear - spec['base'][1] * (rear - front)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    doomed = cut_away(bm, [f for f in bm.faces if max(v.co.z for v in f.verts) < top and max(v.co.y for v in f.verts) > edge],
                      (0, edge, 0), Vector((0, 1, 0)))
    close_cuts(bm, uv)
    bm.to_mesh(obj.data)
    bm.free()
    return doomed


def gate_surgery(obj, spec, rng):
    """
    Takes away the rear frame that Tripo3D added to the gate from a front view alone. One flat cut
    along the front posts' backs, a centimeter into them, takes everything under the roof behind
    it: the rear posts, their blocks, the rails and the rear beam, so the posts' backs end flat. A
    level cut at the side ties' underside takes the old rear posts' tops that hang below the ties.
    The cuts close, each new face painted from the timber round it. The front posts then stand
    upright and move closer together, and a copy of the left one, narrowed, weathered, stretched
    from the ground into the tie, moved back and cut level at both ends, stands behind it with the
    front post's own upright grain.
    """
    co = vertices_of(obj)
    low, high = co[:, 2].min(), co[:, 2].max()
    roof = low + spec['roof'] * (high - low)
    tie = low + spec['tie'] * (high - low)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active

    # The posts' backs lean: the cut runs from `cut[0]` of the height at the foot to `cut[1]` at the
    # roof line.
    foot, top = (share * (high - low) for share in spec['cut'])
    doomed = cut_away(bm, [f for f in bm.faces if max(v.co.z for v in f.verts) < roof], (0, foot, low),
                      Vector((0, 1, -(top - foot) / (roof - low))).normalized())
    # Behind the front posts and inside the roof's ends, everything below the ties goes.
    doomed += cut_away(bm, [f for f in bm.faces if f.calc_center_median().y > 0 and abs(f.calc_center_median().x) < spec['eaves'] * (high - low)
                            and min(v.co.z for v in f.verts) < tie], (0, 0, tie), Vector((0, 0, -1)))
    close_cuts(bm, uv)

    # The front posts lean forward toward their feet: they stand upright again below the beam.
    beam = low + spec['beam'] * (high - low)
    for v in bm.verts:
        if v.co.z < beam and v.co.y < top:
            v.co.y += spec['lean'] * (beam - v.co.z)

    # The front posts stand closer together, so the roof is `spread` times their spacing: each post
    # with its block, its bracket and the beam's end moves in, and the beam's middle shortens. Below
    # the roof line everything moves; above it, up to the brackets' tops, only the posts' columns,
    # so the roof and the row of small blocks under it stay.
    bottom = low + spec['blocks'] * (high - low) + 0.2
    columns = np.array([abs(v.co.x) for v in bm.verts if v.co.y < 0 and bottom < v.co.z < beam - 0.05])
    inner = float(np.percentile(columns, 5))
    shift = float(np.median(columns)) - max(abs(v.co.x) for v in bm.verts) / spec['spread']
    brackets = low + spec['brackets'] * (high - low)
    for v in bm.verts:
        away = abs(v.co.x)
        up = 1.0 if v.co.z < roof else (smoothstep(brackets + 0.03, brackets - 0.03, v.co.z)
                                        * smoothstep(inner - 0.2, inner - 0.15, away))
        v.co.x -= math.copysign(shift * float(smoothstep(0.3 * inner, inner - 0.15, away) * up), v.co.x)

    # The left front post between its block and the beam, above the pale band at its foot: its x
    # span from the front, then every face wholly inside that span, in front of the gate's middle
    # and between those heights.
    body = [v.co for v in bm.verts if v.co.x < 0 and v.co.y < 0 and bottom < v.co.z < beam]
    xs = np.array([p.x for p in body])
    x0, x1 = np.percentile(xs, 5) - 0.03, np.percentile(xs, 95) + 0.03
    post = [f for f in bm.faces if all(x0 < v.co.x < x1 and v.co.y < 0 and bottom < v.co.z < beam - 0.05 for v in f.verts)]
    copy = bmesh.ops.duplicate(bm, geom=post)['geom']
    made = [e for e in copy if isinstance(e, bmesh.types.BMVert)]
    middle = Vector((float(np.median([v.co.x for v in made])), float(np.median([v.co.y for v in made])), 0))
    # Narrowed, moved back and stretched past the ground and into the tie, so its ragged ends lie
    # beyond the level cuts that then give it clean ends.
    # Weathered, not a clean square stick: it narrows a little toward its top, and its faces wander
    # in and out by up to `weather` meters.
    wander = noise3(np.array([v.co[:] for v in made], np.float32), 0.15, rng, 2)
    for v, bump in zip(made, wander):
        z = low - 0.3 + (v.co.z - bottom) * (tie + 0.6 - low) / (beam - 0.05 - bottom)
        out = Vector((v.co.x - middle.x, v.co.y - middle.y, 0)) * spec['post']
        out *= 1 - 0.06 * min(max((z - low) / (tie - low), 0.0), 1.0)
        out += out.normalized() * spec['weather'] * (2 * float(bump) - 1)
        v.co = Vector((middle.x + out.x, middle.y + spec['rear'] * (high - low) + out.y, z))
    for height, normal in ((low, (0, 0, -1)), (tie + 0.03, (0, 0, 1))):
        faces = [e for e in copy if isinstance(e, bmesh.types.BMFace) and e.is_valid]
        verts = list(dict.fromkeys(v for f in faces for v in f.verts))
        edges = list(dict.fromkeys(e for f in faces for e in f.edges))
        copy = bmesh.ops.bisect_plane(bm, geom=verts + edges + faces, plane_co=(0, 0, height), plane_no=normal,
                                      clear_outer=True)['geom']
    faces = [e for e in copy if isinstance(e, bmesh.types.BMFace) and e.is_valid]
    ends = list(dict.fromkeys(e for f in faces for e in f.edges if e.is_boundary))
    rim = {corner.vert: corner[uv].uv.copy() for f in faces for corner in f.loops}
    capped = bmesh.ops.holes_fill(bm, edges=ends, sides=0)['faces']
    for f in bmesh.ops.triangulate(bm, faces=capped)['faces']:
        for corner in f.loops:
            corner[uv].uv = rim.get(corner.vert, corner[uv].uv)
    bm.to_mesh(obj.data)
    bm.free()
    return doomed


def cap_shape(spec, position):
    """
    The lantern's cap at each point of `position`, an array of points: how surely the point is on
    the cap, which spans the two shares of `cap` of the height; its distance from the lantern's
    axis; its signed angle to the nearest of the cap's six ribs, which run from the knob out to the
    corners; its distance out along the nearest side's normal, which reaches `apothem` at the
    eave; and that apothem. The corners are the cap's farthest points from the axis, sixty degrees
    apart.
    """
    z = position[..., 2]
    low, top = (share * spec['height'] for share in spec['cap'])
    on_cap = smoothstep(low, low + 0.05, z) * smoothstep(top + 0.05, top, z)
    r = np.linalg.norm(position[..., :2], axis=-1)
    theta = np.arctan2(position[..., 1], position[..., 0])
    inside = on_cap > 0.5
    reach = float(r[inside].max())
    far = np.zeros(360)
    np.maximum.at(far, np.floor((theta[inside] + np.pi) / (2 * np.pi) * 360).astype(int) % 360, r[inside])
    corner = (np.argmax(far) + 0.5) / 360 * 2 * np.pi - np.pi
    to_rib = (theta - corner + np.pi / 6) % (np.pi / 3) - np.pi / 6
    out = r * np.cos(np.pi / 6 - np.abs(to_rib))
    return on_cap, r, to_rib, out, reach * np.cos(np.pi / 6)


def cap_stone(spec, position, facing, rng):
    """
    Where grey stone shows through the moss on the lantern's cap: along its six ribs, from the
    knob out to the corners and wider toward them, round its eaves, and on its lip, each with a
    ragged edge. A rib wanders a little from its straight line, swells and thins along its length,
    and here and there the moss crosses it.
    """
    on_cap, r, to_rib, out, apothem = cap_shape(spec, position)
    reach = apothem / np.cos(np.pi / 6)
    ragged = 0.5 + noise3(position, 0.07, rng, 3)
    narrow, wide = spec['ribs']
    width = (narrow + (wide - narrow) * r / reach) * ragged * (0.6 + 0.8 * noise3(position + 3.7, 0.3, rng, 2))
    across = np.abs(r * np.sin(to_rib) + spec['wobble'] * (2 * noise3(position + 1.3, 0.35, rng, 2) - 1))
    rib = (smoothstep(width, 0.5 * width, across) * smoothstep(spec['knob'], spec['knob'] + 0.05, r)
           * smoothstep(0.25, 0.4, noise3(position + 7.1, 0.25, rng, 2)))
    eave = smoothstep(apothem - spec['eave'] * ragged, apothem - 0.5 * spec['eave'] * ragged, out)
    lip = smoothstep(0.4, 0.2, facing[..., 2])
    return np.clip(np.maximum(np.maximum(rib, eave), lip) * on_cap, 0, 1)


def seen_from_front(values, position, back, front, cell=0.02):
    """
    `values` with each texel where `back` holds replaced by the mean of the `front` texels in the
    same `cell`-meter square of x and height, or in the squares round it where that one has none:
    a face on a timber's back then shows the timber's front, its grain and its tone.
    """
    x, z = position[..., 0], position[..., 2]
    i = np.floor((x - x.min()) / cell).astype(int)
    j = np.floor((z - z.min()) / cell).astype(int)
    shape = (i.max() + 1, j.max() + 1)
    sums = np.zeros(shape + values.shape[-1:])
    counts = np.zeros(shape)
    np.add.at(sums, (i[front], j[front]), values[front])
    np.add.at(counts, (i[front], j[front]), 1)
    near = box_blur(counts, 1)
    near_sums = np.dstack([box_blur(sums[..., c], 1) for c in range(sums.shape[-1])])
    mean = np.where((counts > 0)[..., None], sums / np.maximum(counts, 1)[..., None],
                    near_sums / np.maximum(near, 1e-9)[..., None])
    take = back & ((counts > 0) | (near > 0))[i, j]
    out = values.copy()
    out[take] = mean[i[take], j[take]]
    return out


def repaint_model(name, spec, maps, rng):
    """
    A model's finished color, as display values, and its roughness, metalness and occlusion, from
    its raw color and its bakes, as its settings in `MODELS` say.
    """
    raw = maps['color']
    occlusion = maps['occlusion'][..., 0]
    dent = np.clip(box_blur(smoothstep(0.05, 0.15, dip(occlusion)), 3) * 3, 0, 1)
    occlusion = heal(occlusion, dent)
    z = maps['position'][..., 2]
    moss = mossy(raw)
    color = raw.copy()

    def vivid(c, by, where):
        gray = (c @ LUMA)[..., None]
        return c + (gray + (c - gray) * by - c) * where[..., None]

    def darken(c, by, where):
        return c * (1 + (by - 1) * where)[..., None]

    if name == 'lantern':
        bare = cap_stone(spec, maps['position'], maps['facing'], rng)
        raw_moss = moss
        moss = smoothstep(*spec['moss_edge'], moss) * (1 - bare)
        stone = 1 - moss
        color = darken(color, spec['darken'], stone)
        color = vivid(color, spec['stone_vivid'], stone)
        color *= 1 + (np.array(spec['moss'], np.float32) - 1) * moss[..., None]
        color = vivid(color, spec['vivid'], moss)
        # The moss grows in patches of its own lightness, not one even coat.
        patches = spec['moss_darken'] * (0.8 + 0.4 * noise3(maps['position'] + 4.4, 0.12, rng, 2))
        color = darken(color, patches, moss)
        # Where the cap's stone shows through moss in the raw color, it takes the lantern's own
        # stone color, mottled.
        plain = np.median(color[(raw_moss < 0.05) & (maps['position'][..., 2] > spec['cap'][0] * spec['height'])], axis=0)
        mottled = plain * (0.85 + 0.3 * noise3(maps['position'], 0.08, rng, 2))[..., None]
        color = mix(color, mottled, raw_moss * bare)
    elif name == 'gate':
        roof = spec['roof'] * spec['height'] - spec['sink']
        blocks = spec['blocks'] * spec['height'] - spec['sink']
        # The faces that close the cut on the front posts' and blocks' backs lie on the cut, as the
        # posts' straightening moved it, and the rear post, a copy of the left one, carries them
        # on its back half. They take what the front faces show at the same place, grain, tone and
        # occlusion, in place of the raw texture that the closing stretched.
        position, facing, low = maps['position'], maps['facing'], -spec['sink']
        foot, top = (share * spec['height'] for share in spec['cut'])
        beam = low + spec['beam'] * spec['height']
        tie = spec['tie'] * spec['height'] - spec['sink']
        cut = foot + (z - low) * (top - foot) / (roof - low) + spec['lean'] * np.maximum(beam - z, 0)
        back = (np.abs(position[..., 1] - cut) < 0.03) & (z < roof) & (z > low + 0.01)
        post = (position[..., 1] > 0.15) & (z < tie - 0.05) & (z > low + 0.01)
        if post.any():
            back |= post & (position[..., 1] > np.median(position[..., 1][post])) & (np.abs(facing[..., 1]) > 0.7)
        front = (facing[..., 1] < -0.7) & (position[..., 1] < cut - 0.05)
        color = seen_from_front(color, position, back, front)
        occlusion = seen_from_front(occlusion[..., None], position, back, front)[..., 0]
        maps['color'] = color
        # The tiles, grey above the roof line, keep the first share of `roof_tone` of their
        # lightness, and their light and dark round the local mean grow by the second, so the rows
        # show dark gaps and pale tops.
        tiles = smoothstep(roof, roof + 0.1, z) * (1 - smoothstep(0.12, 0.2, strength_of(color)))
        color = darken(color, spec['roof_tone'][0], tiles)
        luma = color @ LUMA
        color *= (1 + (spec['roof_tone'][1] - 1) * tiles * (luma / np.maximum(box_blur(luma, 6), 0.02) - 1))[..., None]
        timber = smoothstep(blocks, blocks + 0.08, z) * smoothstep(roof + 0.05, roof - 0.05, z)
        color = vivid(color, spec['vivid'], timber)
        color = darken(color, spec['darken'], timber)
        # Behind the front posts and below the ties only the rear post stands. It stands deeper in
        # the roof's shade, so it takes the front posts' tone: lighter by the first share of
        # `rear_tone`, its color strength by the second.
        rear = smoothstep(0.15, 0.3, maps['position'][..., 1]) * smoothstep(tie + 0.02, tie - 0.05, z)
        color = darken(color, spec['rear_tone'][0], rear)
        color = vivid(color, spec['rear_tone'][1], rear)
        # Bare weathered timber is grey-brown, not red: all the timber above the blocks takes the
        # `timber_tint`.
        wood = smoothstep(blocks, blocks + 0.08, z) * (1 - tiles)
        color *= 1 + (np.array(spec['timber_tint'], np.float32) - 1) * wood[..., None]
        # The posts' feet are not white: the stone blocks keep `feet[0]` of their lightness, and
        # the pale band at the foot of each post, up to `feet[1]` meters above its block, comes
        # down to the posts' own lightness.
        luma = color @ LUMA
        own = float(np.median(luma[(timber > 0.9) & (z > blocks + 0.7) & (z < roof - 0.3)]))
        band = smoothstep(blocks - 0.02, blocks + 0.02, z) * smoothstep(blocks + spec['feet'][1], blocks + 0.6 * spec['feet'][1], z)
        color *= (1 - band * (1 - np.minimum(own / np.maximum(luma, 0.02), 1)))[..., None]
        color = darken(color, spec['feet'][0], smoothstep(blocks + 0.02, blocks - 0.02, z))
    elif name == 'dragon':
        # Where each texel lies along the dragon, from its head (0) to its tail's end (1), and up.
        position = maps['position']
        lo, hi = position.reshape(-1, 3).min(axis=0), position.reshape(-1, 3).max(axis=0)
        along = (position[..., 1] - lo[1]) / (hi[1] - lo[1])
        up = (position[..., 2] - lo[2]) / (hi[2] - lo[2])
        hue, strength, luma = hue_of(color), strength_of(color), color @ LUMA
        # The pale grey things: the tail fan's tiles, the crest blades, the teeth and the mane.
        pale = smoothstep(0.45, 0.55, luma) * smoothstep(0.25, 0.15, strength)
        # The body's green-grey scales, to the end of the tail's curl, read as one dark mass with
        # fine dark joints: they keep `darken` of their lightness, and a texel darker than the
        # tiles round it, a joint, darkens `joints` times its own share more. The pale things keep
        # their own lightness, so the fan's tiles stay a step paler than the body.
        body = (smoothstep(40, 60, hue) * smoothstep(210, 190, hue) * smoothstep(0.04, 0.1, strength)
                * smoothstep(0.55, 0.42, luma))
        joint = np.clip(1 - luma / np.maximum(box_blur(luma, 3), 0.02), 0, 1)
        color = color * (1 - body * (1 - spec['darken'] * np.clip(1 - spec['joints'] * joint, 0, 1)))[..., None]
        # The teeth and the mane's plates, the palest things on the head, keep their white: the
        # pale texels round the head grow `teeth` times lighter, against the 512 map's blur.
        head = smoothstep(0.42, 0.36, along) * smoothstep(0.55, 0.48, up)
        color = color * (1 + (spec['teeth'] - 1) * head * pale)[..., None]
        # The belly band under the top arch, pale pink-tan, loses its colour to a pale grey.
        pink = ((hue < 35) | (hue > 340)) * smoothstep(0.12, 0.2, strength) * smoothstep(0.55, 0.45, strength)
        pink = pink * smoothstep(0.28, 0.38, luma) * smoothstep(0.42, 0.5, up)
        color = mix(color, (color @ LUMA)[..., None] * np.ones(3, np.float32), pink)
    else:
        stone = 1 - moss
        color = vivid(color, spec['vivid'], stone)
        color = darken(color, spec['darken'], stone)
        luma = color @ LUMA
        color *= (1 + (spec['contrast'] - 1) * stone * (luma / np.maximum(box_blur(luma, 6), 0.02) - 1))[..., None]
        color = darken(color, spec['moss_darken'], moss)
        if spec['specks']:
            white = smoothstep(0.5, 0.65, raw @ LUMA) * (1 - smoothstep(0.1, 0.2, strength_of(raw)))
            color = mix(color, (0.50, 0.53, 0.47), 0.8 * white)
        foot = smoothstep(spec['foot'] * spec['height'], 0.0, z) * stone
        color = darken(color, 0.72, foot)
    roughness = np.clip(0.88 + 0.06 * moss, 0, 1)
    if 'glaze' in spec:
        # Glazed tiles glint: their roughness is the `glaze`.
        roughness = np.full_like(roughness, spec['glaze'])
    return np.clip(color, 0, 1), roughness, np.zeros_like(roughness), occlusion


def finish_model(name, spec, raw, rng):
    """One of the garden's other models, with two lower levels, their errors, and its figures."""
    high, color, normal = import_raw(os.path.join(raw, name, spec['file']), name)
    figures = dict(raw_triangles=triangles_of(high))
    if 'base_cut' in spec:
        cut_below(high, spec['base_cut'])
    co = vertices_of(high)
    set_vertices(high, standing(co, spec['height'], spec['turn'], -spec['sink'])(co))
    if name == 'gate':
        figures['faces_cut'] = gate_surgery(high, spec, rng)
    if 'base' in spec:
        figures['base_trimmed'] = trim_base(high, spec)
    if 'flatten' in spec:
        figures['moss_flattened'] = flatten_moss(high, color, spec)
    if name == 'lantern':
        smooth_where(high, mossy(vertex_colors_of(high, color)) > 0.5, spec['smooth'])
        # The cap's edge, chipped in the raw mesh, is smoothed too: its last `rim` meters.
        on_cap, _, _, out, apothem = cap_shape(spec, vertices_of(high))
        smooth_where(high, (on_cap > 0.5) & (out > apothem - spec['rim']), spec['smooth'])
    figures['pits_filled'] = fill_pits(high)
    model = decimated(high, spec['triangles'], name)
    unwrap(model)
    maps = bake_maps(high, model, color, normal, spec['texture'], bake_color=True)
    painted, roughness, metal, occlusion = repaint_model(name, spec, maps, rng)
    flat = np.zeros(painted.shape[:2], np.float32)
    model.data.materials.clear()
    model.data.materials.append(material(
        name,
        image(f'{name}-color', painted),
        image(f'{name}-normal', relief(maps['normal'], maps['color'], flat, 1.0, MODEL_RELIEF), 'Non-Color'),
        image(f'{name}-orm', np.dstack([occlusion, roughness, metal]), 'Non-Color'),
        roughness=0.9,
        tint=False,
    ))
    levels, errors = levels_of(name, model, lambda k: decimated(
        model, round(spec['triangles'] * spec['levels'][k - 1]), f'{name}-{k}'), spec['height'], LEVEL_ERROR_LIMIT, 0.0)
    bpy.data.objects.remove(high)
    extent = vertices_of(model).max(axis=0) - vertices_of(model).min(axis=0)
    figures['size'] = ' x '.join(f'{v:.2f}' for v in extent)
    return [model, *levels], {name: errors}, figures


# ---------------------------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------------------------


# The concept picture's camera: its turn to the model's left of front and its tilt down, in
# degrees, and its distance in meters. A page on a screen 1,080 pixels high with a 45 degree view
# shows a pixel per this many meters at a meter away, which sets where each level takes over.
CONCEPT_VIEW = (15.0, 27.0, 60.0)
PIXEL_PER_METER = 0.00077


def toward(azimuth, elevation):
    """The unit vector from a model toward a camera turned and tilted by these degrees."""
    a, e = math.radians(azimuth), math.radians(elevation)
    return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


def preview_ground(radius=6.0):
    """
    A stand-in for the terrace the slab sits on, for the previews only: a flat disc of dark mossy
    ground at the slab's foot, until the scene holds the statue.
    """
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=radius)
    mesh = bpy.data.meshes.new('preview-ground')
    bm.to_mesh(mesh)
    bm.free()
    mat = bpy.data.materials.new('preview-ground')
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.045, 0.045, 0.02, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    mesh.materials.append(mat)
    return link(bpy.data.objects.new('preview-ground', mesh))


def overcast(objects, size, samples, extra=()):
    """
    The preview's stage under an overcast sky of even light, with a soft sun from the upper left
    of the concept picture's camera, shown with the standard display curve, so a matte surface
    shows about its own color. The backdrop is the concept picture's pale cloud gray. The `extra`
    objects show too, without changing the frame.
    """
    cam, low, high = stage(objects, (1.0, 1.0, 1.0), size, samples)
    scene = bpy.context.scene
    sun = bpy.data.objects['preview-sun']
    sun.data.energy = 1.2
    sun.data.angle = math.radians(20)
    view = toward(*CONCEPT_VIEW[:2])
    left = Vector((-math.cos(math.radians(CONCEPT_VIEW[0])), -math.sin(math.radians(CONCEPT_VIEW[0])), 0))
    sun.rotation_euler = (left * 0.7 + Vector((0, 0, 0.6)) + Vector((view.x, view.y, 0)) * 0.4).to_track_quat('Z', 'Y').to_euler()
    nodes, links = scene.world.node_tree.nodes, scene.world.node_tree.links
    light = nodes['Background']
    light.inputs['Strength'].default_value = 0.9
    # The camera sees the overcast's gray, while the light stays even white.
    seen = nodes.get('preview-backdrop') or nodes.new('ShaderNodeBackground')
    seen.name = 'preview-backdrop'
    seen.inputs['Color'].default_value = (*SKY, 1)
    path = nodes.get('preview-path') or nodes.new('ShaderNodeLightPath')
    path.name = 'preview-path'
    pick = nodes.get('preview-pick') or nodes.new('ShaderNodeMixShader')
    pick.name = 'preview-pick'
    links.new(path.outputs['Is Camera Ray'], pick.inputs['Fac'])
    links.new(light.outputs['Background'], pick.inputs[1])
    links.new(seen.outputs['Background'], pick.inputs[2])
    links.new(pick.outputs['Shader'], nodes['World Output'].inputs['Surface'])
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = False
    for o in extra:
        o.hide_render = False
    return cam, low, high


def shot(objects, path, location, target, lens, size=(800, 800), samples=48, extra=()):
    """One perspective picture of the objects from a place toward a point, with a lens in mm."""
    cam, _, _ = overcast(objects, size, samples, extra)
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.lens = lens
    cam.data.clip_end = 400
    cam.location = location
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def ortho_views(objects, folder, name, size=800, extra=()):
    """Front, back, both sides and top, with orthographic cameras that frame the model."""
    cam, low, high = overcast(objects, (size, size), 32, extra)
    middle = (low + high) / 2
    extent = high - low
    cam.data.type = 'ORTHO'
    up = math.radians(90)
    views = {
        'front': ((middle.x, low.y - 20, middle.z), (up, 0, 0), max(extent.x, extent.z)),
        'back': ((middle.x, high.y + 20, middle.z), (up, 0, math.radians(180)), max(extent.x, extent.z)),
        'left': ((high.x + 20, middle.y, middle.z), (up, 0, up), max(extent.y, extent.z)),
        'right': ((low.x - 20, middle.y, middle.z), (up, 0, -up), max(extent.y, extent.z)),
        'top': ((middle.x, middle.y, high.z + 20), (0, 0, 0), max(extent.x, extent.y)),
    }
    for view, (location, rotation, span) in views.items():
        cam.location = location
        cam.rotation_euler = rotation
        cam.data.ortho_scale = span * 1.08
        cam.data.clip_end = 100
        bpy.context.scene.render.filepath = os.path.join(folder, f'{name}-{view}.png')
        bpy.ops.render.render(write_still=True)


def concept_view(objects, path, size=800, extra=()):
    """
    The model as the concept picture's camera sees it, the whole model in the frame with room
    round it.
    """
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector([min(p[k] for p in points) for k in range(3)])
    high = Vector([max(p[k] for p in points) for k in range(3)])
    middle, radius = (low + high) / 2, (high - low).length / 2
    distance = CONCEPT_VIEW[2]
    lens = 36 * distance / (2.0 * radius)
    shot(objects, path, middle + toward(*CONCEPT_VIEW[:2]) * distance, middle, lens, (size, size), 64, extra)


def route_views(objects, folder, name, extra=()):
    """
    The model where the route meets it: from the gate, about 17 m away and some 3 m below the
    terrace, looking up the steps; and from the top of the steps, about 7 m from its front, at a
    walker's eye, the whole figure, its face, its hands and its upturned foot.
    """
    shot(objects, os.path.join(folder, f'{name}-from-gate.png'), (0, -17, -2.9), (0, 0, 3.6), 35, extra=extra)
    near = (0, -7.2, 1.6)
    for view, target, lens in (('whole', (0, 0, 4.0), 20), ('face', (0, -0.3, 6.3), 110),
                               ('hands', (0, -1.3, 2.2), 60), ('foot', (2.2, -1.6, 1.7), 80)):
        shot(objects, os.path.join(folder, f'{name}-near-{view}.png'), near, target, lens, extra=extra)


def level_views(groups, errors, folder, name):
    """
    Each lower level beside the finest one, from the concept picture's camera at the distance
    where that level takes over on a page 1,080 pixels high with a 45 degree view, cut to the
    model and drawn at its size on that page.
    """
    scene = bpy.context.scene
    for k, error in enumerate(errors, start=1):
        distance = error / PIXEL_PER_METER
        for shown, label in ((groups[0], 'finest'), (groups[k], f'level-{k}')):
            cam, low, high = overcast(shown, (1920, 1080), 64)
            middle = (low + high) / 2
            cam.data.type = 'PERSP'
            cam.data.sensor_fit = 'VERTICAL'
            cam.data.angle_y = math.radians(45)
            cam.data.clip_end = distance * 2
            cam.location = middle + toward(*CONCEPT_VIEW[:2]) * distance
            cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
            whole = os.path.join(folder, f'{name}-{label}-{distance:.0f}m-whole.png')
            scene.render.filepath = whole
            bpy.ops.render.render(write_still=True)
            shot_img = bpy.data.images.load(whole)
            texels = np.array(shot_img.pixels[:], np.float32).reshape(1080, 1920, 4)
            bpy.data.images.remove(shot_img)
            os.remove(whole)
            backdrop = np.abs(texels[..., :3] - texels[0, 0, :3]).max(axis=2) > 0.02
            rows, cols = np.where(backdrop.any(axis=1))[0], np.where(backdrop.any(axis=0))[0]
            y0, y1 = max(0, rows[0] - 6), min(1080, rows[-1] + 7)
            x0, x1 = max(0, cols[0] - 6), min(1920, cols[-1] + 7)
            part = np.ascontiguousarray(texels[y0:y1, x0:x1])
            img = bpy.data.images.new(label, x1 - x0, y1 - y0, alpha=False)
            img.pixels.foreach_set(part.ravel())
            img.filepath_raw = os.path.join(folder, f'{name}-{label}-at-{distance:.0f}m.png')
            img.file_format = 'PNG'
            img.save()
            bpy.data.images.remove(img)


# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------


def levels_of(name, finest, make, height, limits, floor=-math.inf):
    """
    The lower levels that `make(k)` builds for each k from 1, and each one's surface error above
    the height `floor`: the largest distance between the level and the finest one, since a solid
    model's gaps show in its outline. Each must stay within its share in `limits` of the model's
    `height`, or the build stops.
    """
    levels, errors = [], []
    for k in (1, 2):
        level = make(k)
        level.name = level.data.name = f'{name}-{k}'
        levels.append(level)
        errors.append(level_error(level, finest, share=None, floor=floor, limit=limits[k - 1] * height))
    return levels, errors


def finish_statue(spec, raw, rng):
    """
    The statue and its slab, each with two lower levels, the levels' errors by part, and the
    figures that the build prints.
    """
    high, color, normal = import_raw(os.path.join(raw, spec['folder'], spec['file']), 'statue')
    raw_triangles = triangles_of(high)
    co = vertices_of(high)
    low, high_corner = co.min(axis=0), co.max(axis=0)
    marks = low + np.array([*spec['eyes'], spec['chest']], np.float32) * (high_corner - low)
    if spec['cut'] > 0:
        cut_below(high, spec['cut'])
    pits = fill_pits(high)
    slab_spec = spec['slab']
    figure = spec['height'] / (1 + slab_spec['height'])
    slab_height = figure * slab_spec['height']
    # The eye marks and the chest ride through every change of shape with the mesh. The figure's
    # foot sinks a little into the slab, so its cut edge never shows.
    co = vertices_of(high)
    neck = co[:, 2].min() + spec['neck'] * (co[:, 2].max() - co[:, 2].min())
    for shape in (
        lambda c: dome_reshape(c, **spec['dome']),
        lambda c: head_growth(c, neck, **spec['head']),
        lambda c: body_reshape(c, neck, **spec['body']),
        lambda c: standing(c, figure, spec['turn'], slab_height - 0.02),
    ):
        move = shape(co)
        co, marks = move(co), move(marks)
    set_vertices(high, co)
    size = co.max(axis=0) - co.min(axis=0)
    knees = float(size[0])

    rx = knees * slab_spec['width'] / 2
    ry = float(size[1]) / 2 + slab_spec['front']
    mat = slab_material(rx, ry, slab_height, slab_spec['bevel'], slab_spec['texture'], rng)

    def slab_level(k):
        return stone_slab(f'slab-{k}' if k else 'slab', rx, ry, slab_height, slab_spec['bevel'], slab_spec['sides'][k], mat)

    slab = slab_level(0)
    slab_levels, slab_errors = levels_of('slab', slab, slab_level, spec['height'], spec['limits'])

    statue = decimated(high, spec['triangles'], 'statue')
    maps = bake_maps(high, statue, color, normal, spec['texture'])
    painted, roughness, metal, occlusion = repaint(maps, spec['height'], marks[:-1], spec['eye'], (marks[-1], spec['chest_size']), rng)
    statue.data.materials.clear()
    statue.data.materials.append(finished_material('statue', maps, painted, roughness, metal, occlusion))
    statue_levels, statue_errors = levels_of('statue', statue, lambda k: decimated(
        statue, round(spec['triangles'] * spec['levels'][k - 1]), f'statue-{k}'), spec['height'], spec['limits'], slab_height)
    bpy.data.objects.remove(high)
    figures = dict(raw_triangles=raw_triangles, pits_filled=pits, figure=figure, slab=slab_height, knees=knees, depth=float(size[1]), slab_width=2 * rx, slab_depth=2 * ry)
    parts = [statue, *statue_levels, slab, *slab_levels]
    return parts, {'statue': statue_errors, 'slab': slab_errors}, figures


def chosen_models():
    """The models that `--models <a,b>` after `--` names, or None for every model."""
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return set(args[args.index('--models') + 1].split(',')) if '--models' in args else None


def write(out, name, parts, errors, figures):
    """Writes a model's file and prints its figures, its triangles and its levels' errors."""
    report = export(os.path.join(out, f'{name}.glb'), parts, set(), errors)
    print(f'CREEK {name}: ' + ', '.join(f'{k} {v:.3f}' if isinstance(v, float) else f'{k} {v}' for k, v in figures.items()))
    for part, triangles in report.items():
        print(f'CREEK {part}: {triangles} triangles')
    print(f'CREEK {name} level errors: {errors} m')
    print(f'CREEK {name}.glb: {os.path.getsize(os.path.join(out, f"{name}.glb")) / 1e6:.2f} MB')


def clear():
    """Removes every object, so the next model bakes and draws alone."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)


def main():
    if bpy.context.scene.render.threads != THREADS:
        raise SystemExit(f'creek_tripo.py builds the same files only on {THREADS} threads: run Blender with --threads {THREADS}, as build.ts does')
    out, shots = arguments('creek_tripo.py')
    raw = raw_folder()
    chosen = chosen_models()
    if chosen is None or 'statue' in chosen:
        parts, errors, figures = finish_statue(STATUE, raw, np.random.default_rng(SEED))
        write(out, 'statue', parts, errors, figures)
        if shots:
            finest = [o for o in parts if o.name in ('statue', 'slab')]
            groups = [finest] + [[bpy.data.objects[f'statue-{k}'], bpy.data.objects[f'slab-{k}']] for k in (1, 2)]
            ground = [preview_ground()]
            ortho_views(finest, shots, 'statue', extra=ground)
            concept_view(finest, os.path.join(shots, 'statue-concept-view.png'), extra=ground)
            route_views(finest, shots, 'statue', extra=ground)
            level_views(groups, errors['statue'], shots, 'statue')
    for name, spec in MODELS.items():
        if chosen is not None and name not in chosen:
            continue
        clear()
        parts, errors, figures = finish_model(name, spec, raw, np.random.default_rng(SEED))
        write(out, name, parts, errors, figures)
        if shots:
            ground = [preview_ground(max(6.0, 1.5 * spec['height']))]
            ortho_views(parts[:1], shots, name, extra=ground)
            concept_view(parts[:1], os.path.join(shots, f'{name}-concept-view.png'), extra=ground)

main()
