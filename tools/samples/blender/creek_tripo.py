# Finishes the Creek garden's models that start as Tripo3D meshes: the bronze statue of the seated
# Buddha. Each raw model is a download kept unchanged in the sample-assets repository, with the
# command and the task record that made it, so the build never calls the network and gives the same
# files from the same download.
#
#   blender --background --factory-startup \
#     --python tools/samples/blender/creek_tripo.py -- <output folder> --raw <folder> [--preview <folder>]
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
from mathutils.bvhtree import BVHTree

# The shared module loads from beside this script, and leaves no bytecode cache in the repository.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    arguments, export, half, image, link, material, normal_map, orm, smoothstep, stage,
)

SEED = 20261120

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
# it, and `texture` the side of every map of the figure in texels.
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
    slab=dict(height=0.1, width=1.25, front=0.25, bevel=0.04, sides=(96, 48, 24), texture=1024),
    triangles=30000,
    levels=(0.34, 0.1),
    texture=1024,
)

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
# and less pink.
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
    bumps=0.4,
    relief=12.0,
    eye=(0.62, 0.64, 0.60),
    warm=(1.07, 1.0, 0.88),
    hairline=0.55,
    green=(1.02, 1.0, 0.9),
    pale=0.38,
    brown=(0.74, 0.72, 0.62),
)

# The preview's backdrop, the concept picture's cloud gray, in linear values.
SKY = (0.58, 0.58, 0.6)

# The slab's stone, as display colors: the stone's dark warm gray and the pale and dark specks in
# it, which `speck` of its texels carry; the moss's colors from its shade to its light, the depth
# of the band along the rim that it grows in, in meters, the share of that band it covers, and the
# height of the band at the foot where it grows in patches too; and
# how far, in meters, the side wanders from its oval, against the rim's own wander.
SLAB = dict(
    stone=(0.35, 0.33, 0.29),
    pale=(0.56, 0.54, 0.49),
    dark=(0.16, 0.15, 0.13),
    speck=0.12,
    moss_shade=(0.27, 0.25, 0.09),
    moss_light=(0.53, 0.47, 0.17),
    moss_band=0.4,
    moss_cover=0.62,
    moss_foot=0.12,
    rough=0.07,
    rim=0.015,
)

# The largest surface error a lower level may have, as a share of the model's height. A larger one
# means that the measure counted a hidden surface, such as the cap in the slab, or that the
# decimation broke the shape; the engine would then keep the finest level far too long, so the
# build stops.
LEVEL_ERROR_LIMIT = 0.015


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


def surface_error(level, full, floor=-math.inf):
    """
    The largest distance between two meshes' surfaces, in meters, from each one's vertices above
    the height `floor` to the other's nearest point, as the engine reads a level's error. What lies
    below the floor, hidden in the slab, does not count.
    """
    def tree(obj):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        found = BVHTree.FromBMesh(bm)
        bm.free()
        return found

    def farthest(points, onto):
        shown = points[points[:, 2] > floor]
        return max((onto.find_nearest(Vector(p))[3] or 0.0) for p in shown)

    return max(farthest(vertices_of(level), tree(full)), farthest(vertices_of(full), tree(level)))


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


def bake_maps(high, low, color, normal, size):
    """
    Every map that the finished model and its repaint read, at twice the final size and averaged
    down, so edges stay smooth: the raw color and normal maps, which the decimated mesh's texture
    layout shares, and the occlusion, curvature, position and facing baked from the raw mesh onto
    that layout. Cycles' normal bake differs between runs in the last bit of a few texels, which
    would change the file at each build, so the raw normal map serves instead.
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
    for name, build in emitted.items():
        maps[name] = bake(high, low, target(name), 'EMIT', 1, emission_material(f'emit-{name}', build))
    # Occlusion: the low mesh would shadow the raw one that it nearly covers, so rays pass it by.
    for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_shadow', 'visible_transmission'):
        setattr(low, flag, False)
    maps['occlusion'] = bake(high, low, target('occlusion'), 'AO', 48)
    for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_shadow', 'visible_transmission'):
        setattr(low, flag, True)
    out = {name: half(texels[..., :3]) for name, texels in maps.items()}
    out['position'] = out['position'] * extent + low_corner
    out['facing'] = out['facing'] * 2 - 1
    out['facing'] /= np.maximum(np.linalg.norm(out['facing'], axis=2, keepdims=True), 1e-6)
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

    # The bare chest turns a warm near-neutral, fading out to its edges.
    d = (position - np.array(chest[0], np.float32)) / np.array(chest[1], np.float32)
    warmth = smoothstep(1.0, 0.5, np.sqrt((d * d).sum(axis=2))) * smoothstep(0.0, 0.4, -facing[..., 1])
    color = mix(color, (color @ LUMA)[..., None] * np.array(PATINA['warm'], np.float32), 0.75 * warmth)

    # Matte: weathered bronze keeps a little of its metal on the rubbed ridges, none under crusts.
    roughness = np.clip(0.82 + 0.08 * (rust + lichen) - 0.06 * ridge, 0, 1)
    metal = np.clip(0.06 + 0.06 * ridge - 0.06 * (rust + lichen), 0, 1)

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


def relief(normal, color, speck):
    """
    The raw normal map with its small bumps softened, flattened where `speck` filled a dark speck
    and where it dents inward, and the color's light and dark at the scale of the robe's pleats raised into it as
    relief, pale above dark, so the painted pleats stand out. The finest speckle stays flat, so the
    bronze does not crinkle.
    """
    n = normal * 2 - 1
    # A dent in the normal map tilts inward from every side, so the tilt's spread runs strongly
    # negative there; bumps such as lichen run positive. The dents go flat, with a margin round
    # each.
    spread = np.gradient(n[..., 0], axis=1) + np.gradient(n[..., 1], axis=0)
    dent = np.clip(box_blur(smoothstep(0.08, 0.2, -box_blur(spread, 1)), 2) * 3, 0, 1)
    n[..., :2] *= PATINA['bumps'] * ((1 - speck) * (1 - dent))[..., None]
    luma = color @ LUMA
    height = box_blur(luma, 2) - box_blur(luma, 10)
    rise, across = np.gradient(height)
    n[..., 0] -= PATINA['relief'] * across
    n[..., 1] -= PATINA['relief'] * rise
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    return n * 0.5 + 0.5


def finished_material(name, maps, painted, roughness, metal, occlusion):
    """The model's metal-rough material: the repainted color, the relief normals and the packed ORM."""
    color = image(f'{name}-color', painted)
    normal = image(f'{name}-normal', relief(maps['normal'], maps['color'], maps['speck']), 'Non-Color')
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
    A low oval stone slab from just below the ground to `height`, with semi-axes `rx` and `ry`. Its
    side leans in a little as it rises and wanders a few centimeters, rough as split stone, up to a
    crisp bevel `bevel` deep round its top, whose rim wanders far less. The same noise in space
    shapes every level of detail. The faces of the bevel and the top shade flat, so the rim stays
    sharp; the side shades smooth. The texture covers the slab once, as `slab_layout` lays it out.
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
    rim = np.repeat([z >= height - bevel - 1e-4 for z, _ in rings], sides)
    amount = np.where(rim, SLAB['rim'], SLAB['rough'])
    outward = flat[:, :2] / np.maximum(np.linalg.norm(flat[:, :2], axis=1), 1e-6)[:, None]
    flat[:, :2] += outward * (wander * amount)[:, None]
    points = flat.reshape(len(rings), sides, 3)

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = [[bm.verts.new(tuple(p)) for p in ring] for ring in points]
    quarter_sides = sides // 4
    for r in range(len(rings) - 1):
        crisp = rings[r][0] >= height - bevel - 1e-4
        for i in range(sides):
            j = (i + 1) % sides
            face = bm.faces.new((grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]))
            face.smooth = not crisp
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
    foot, and moss in a broken band along the rim, coarse and fine at once, down the side's top and
    in over the top's edge, and in patches along the foot. Its normals and roughness, at half the
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

    # Moss: a band along the rim that thins in, broken into patches, with tufts at two scales.
    band = smoothstep(SLAB['moss_band'], 0.4 * SLAB['moss_band'], rim_distance)
    band = np.maximum(band, side * smoothstep(SLAB['moss_foot'], 0.3 * SLAB['moss_foot'], position[..., 2]) * 0.8)
    patches = smoothstep(1 - SLAB['moss_cover'] - 0.08, 1 - SLAB['moss_cover'] + 0.08, noise3(position, 0.5, rng, 3))
    tufts = noise3(position, 0.02, rng, 2)
    moss = np.clip(band * patches * smoothstep(0.3, 0.6, tufts + 0.25 * patches), 0, 1)
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


def levels_of(name, finest, make, height, floor=-math.inf):
    """
    The lower levels that `make(k)` builds for each k from 1, and each one's surface error above
    the height `floor`, which must stay within `LEVEL_ERROR_LIMIT` of the model's `height`.
    """
    levels, errors = [], []
    for k in (1, 2):
        level = make(k)
        level.name = level.data.name = f'{name}-{k}'
        levels.append(level)
        error = round(surface_error(level, finest, floor), 4)
        if error > LEVEL_ERROR_LIMIT * height:
            raise SystemExit(f'{name}-{k}: its surface error is {error} m, over the limit of {LEVEL_ERROR_LIMIT * height:.3f} m')
        errors.append(error)
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
    slab_levels, slab_errors = levels_of('slab', slab, slab_level, spec['height'])

    statue = decimated(high, spec['triangles'], 'statue')
    maps = bake_maps(high, statue, color, normal, spec['texture'])
    painted, roughness, metal, occlusion = repaint(maps, spec['height'], marks[:-1], spec['eye'], (marks[-1], spec['chest_size']), rng)
    statue.data.materials.clear()
    statue.data.materials.append(finished_material('statue', maps, painted, roughness, metal, occlusion))
    statue_levels, statue_errors = levels_of('statue', statue, lambda k: decimated(
        statue, round(spec['triangles'] * spec['levels'][k - 1]), f'statue-{k}'), spec['height'], slab_height)
    bpy.data.objects.remove(high)
    figures = dict(raw_triangles=raw_triangles, pits_filled=pits, figure=figure, slab=slab_height, knees=knees, depth=float(size[1]), slab_width=2 * rx, slab_depth=2 * ry)
    parts = [statue, *statue_levels, slab, *slab_levels]
    return parts, {'statue': statue_errors, 'slab': slab_errors}, figures


def main():
    out, shots = arguments('creek_tripo.py')
    raw = raw_folder()
    rng = np.random.default_rng(SEED)
    parts, errors, figures = finish_statue(STATUE, raw, rng)
    report = export(os.path.join(out, 'statue.glb'), parts, set(), errors)
    print('CREEK statue: ' + ', '.join(f'{k} {v:.3f}' if isinstance(v, float) else f'{k} {v}' for k, v in figures.items()))
    for part, triangles in report.items():
        print(f'CREEK {part}: {triangles} triangles')
    print(f'CREEK level errors: {errors} m')
    print(f'CREEK statue.glb: {os.path.getsize(os.path.join(out, "statue.glb")) / 1e6:.2f} MB')
    if shots:
        finest = [o for o in parts if o.name in ('statue', 'slab')]
        groups = [finest] + [[bpy.data.objects[f'statue-{k}'], bpy.data.objects[f'slab-{k}']] for k in (1, 2)]
        ground = [preview_ground()]
        ortho_views(finest, shots, 'statue', extra=ground)
        concept_view(finest, os.path.join(shots, 'statue-concept-view.png'), extra=ground)
        route_views(finest, shots, 'statue', extra=ground)
        level_views(groups, errors['statue'], shots, 'statue')

main()
