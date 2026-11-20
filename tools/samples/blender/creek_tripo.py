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
#   2. cuts away the generated base, enlarges the head, widens the body, turns the front to -y,
#      scales the figure to its height in meters and stands it in its slab;
#   3. builds the low round stone slab it sits on, with moss along its edge;
#   4. decimates the figure to its triangle budget, keeping the raw texture layout;
#   5. bakes the raw mesh onto the decimated one with Cycles: the color of the raw surface, and the
#      occlusion, the curvature, the position and the facing that the repaint reads, and takes the
#      raw normal map, which the decimated mesh's texture layout shares;
#   6. repaints the bronze: a dark slate green-gray, paler on the ridges and darker and greener in
#      the folds, with stains, lichen, rain streaks and pale marks on the eyes;
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
    arguments, at_distance, export, half, image, link, material, normal_map, occlusion_of, orm, rock_texture,
    smoothstep, stage,
)

SEED = 20261120

# The statue's raw file inside its folder, and how the script finishes it. `turn` is the turn about
# the vertical axis, in degrees anticlockwise from above, that brings the raw model's front to -y.
# `cut` is the top of the raw model's own base, as a share of its height: the script cuts the base
# away and builds the slab instead, so the slab's size is exact. `height` is the statue's height
# with its slab, in meters.
#
# `neck` is the top of the neck, as a share of the figure's height, which parts the head from the
# body. `head` enlarges the head about the top of the neck: `radius` is the head's reach from its
# axis as a share of the figure's height, inside which the head grows by `grow`, and beyond which
# the shoulders stay as they are. `body` reshapes the body below the neck: it grows across by
# `widen` about the figure's axis and its height is scaled by `squash`, so the figure keeps the
# concept's build, and the head rides down with the top of the neck. `eyes` are the middles of the
# pale marks on the eyes, as shares of the raw model's bounds on each axis, which ride through every
# change of shape with the mesh, and `eye` is a mark's half width and half height in meters.
#
# `slab` is the stone slab: its height as a share of the figure's, its width as a share of the
# width across the knees, the slope of its top edge in meters, and the sides of each level.
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
    head=dict(radius=0.14, grow=1.15),
    body=dict(widen=1.10, squash=0.95),
    eyes=((0.6012, 0.4499, 0.8033), (0.605, 0.5514, 0.8033)),
    eye=(0.14, 0.05),
    slab=dict(height=0.1, width=1.25, slope=0.12, sides=(96, 48, 24)),
    triangles=30000,
    levels=(0.34, 0.1),
    texture=1024,
)

# The weathered bronze, as display colors. Old bronze in the open is matte and of low color
# strength: a dark slate green-gray that runs from `shade` in the hollows through `mid` to a teal
# `light` on the tops of folds, the hair and the knees. The folds hold a greener shade, where the
# verdigris that rain leaves stays wet longest. Warm `stain` and `rust` patches lie where the raw
# color is warm, as the reference pictures put them on the knees, forearms and chest; pale `lichen`
# specks and rain streaks that run down from the shoulders lie over it all. `raw` is the share of
# the raw color's own light and dark that the repaint keeps, so the cast's detail and mottling show
# through, and `mottle` the strength of a fine speckle in the tone. A streak is `streak_width` across
# and up to `streak_length` long, in meters.
PATINA = dict(
    shade=(0.100, 0.120, 0.128),
    fold=(0.100, 0.140, 0.125),
    mid=(0.255, 0.290, 0.288),
    light=(0.430, 0.475, 0.460),
    stain=(0.520, 0.460, 0.390),
    rust=(0.450, 0.330, 0.240),
    lichen=(0.620, 0.640, 0.590),
    raw=0.8,
    mottle=0.25,
    streak_width=0.05,
    streak_length=1.6,
    eye=(0.600, 0.620, 0.580),
)

# The slab's stone: the shared rock texture, lightened to the slab's gray, and the shares of it
# that the vertex colors keep on bare stone and on moss, which glTF multiplies into the texture.
# The preview's backdrop, the concept picture's cloud gray, in linear values.
SKY = (0.58, 0.58, 0.6)

SLAB = dict(lighten=1.0, stone=(0.55, 0.55, 0.5), moss=(1.0, 0.88, 0.12), tile=2.5)


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


def surface_error(level, full):
    """
    The largest distance between two meshes' surfaces, in meters, from each one's vertices to the
    other's nearest point, as the engine reads a level's error.
    """
    def tree(obj):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        found = BVHTree.FromBMesh(bm)
        bm.free()
        return found

    def farthest(points, onto):
        return max((onto.find_nearest(Vector(p))[3] or 0.0) for p in points)

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


def image_socket(nodes, img):
    """An image's color as a socket."""
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    return tex.outputs['Color']


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


def bake_maps(high, low, color, normal, size):
    """
    Every map that the finished model and its repaint read, at twice the final size and averaged
    down, so edges stay smooth: the raw normal map, and the rest baked from the raw mesh onto the
    decimated mesh's texture layout.
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
    maps = {}

    def target(name):
        img = bpy.data.images.new(f'bake-{name}', side, side, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        return img

    emitted = {
        'color': lambda n: image_socket(n, color),
        'curvature': lambda n: geometry_socket(n, 'Pointiness'),
        'position': lambda n: vector_socket(n, geometry_socket(n, 'Position'), low_corner, extent),
        'facing': lambda n: vector_socket(n, geometry_socket(n, 'Normal'), (-1, -1, -1), (2, 2, 2)),
    }
    for name, build in emitted.items():
        maps[name] = bake(high, low, target(name), 'EMIT', 1, emission_material(f'emit-{name}', build))
    # The normals come from the raw normal map itself, which the decimated mesh's texture layout
    # shares: Cycles' normal bake differs between runs in the last bit of a few texels, which would
    # change the file at each build, and draws no visible difference.
    normal = normal.copy()
    if tuple(normal.size) != (side, side):
        normal.scale(side, side)
    maps['normal'] = pixels_of(normal)
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


def to_srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


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
    and each further octave's half as wide. Each octave's lattice repeats every 64 cells.
    """
    total, norm, weight = np.zeros(position.shape[:-1], np.float32), 0.0, 1.0
    for octave in range(octaves):
        grid = lattice((64, 64, 64), rng)
        p = position / (cell / 2 ** octave)
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


def rain_streaks(position, height, rng):
    """
    Long thin streaks that run down the model, from 0 to 1: noise stretched along the vertical, laid
    round the model by the angle about its axis so the streaks keep one width all the way round.
    Each streak fades out toward its foot, as a run of water does.
    """
    x, y, z = position[..., 0], position[..., 1], position[..., 2]
    angle = np.arctan2(y, x) / (2 * math.pi) + 0.5
    reach = 2.0
    columns = int(2 * math.pi * reach / PATINA['streak_width'])
    rows = int(height / PATINA['streak_length']) + 3
    total = np.zeros_like(z)
    for octave, weight in ((1, 0.6), (2, 0.3), (4, 0.1)):
        grid = lattice((columns * octave, rows * octave + 2), rng)
        total += weight * sample(grid, angle * columns * octave, z / PATINA['streak_length'] * octave + 1)
    streak = smoothstep(0.55, 0.85, total)
    # A streak is strongest under the ledge it ran from, so it fades with its distance down.
    run = (z / PATINA['streak_length']) % 1.0
    return streak * (0.4 + 0.6 * run)


def mix(a, b, share):
    """Colors `a` moved toward `b` by a share at each texel."""
    return a + (np.asarray(b, np.float32) - a) * np.clip(share, 0, 1)[..., None]


def bronze(tone):
    """The bronze's display color at a tone from 0, its shade, through 0.5, its mid, to 1, its light."""
    shade, mid, light = (np.array(PATINA[k], np.float32) for k in ('shade', 'mid', 'light'))
    t = np.clip(tone, 0, 1)[..., None]
    return np.where(t < 0.5, shade + (mid - shade) * t * 2, mid + (light - mid) * (t * 2 - 1))


def repaint(maps, height, eyes, eye, rng):
    """
    The finished color, as display values, and the roughness and metalness, from the baked maps.
    The tone of each texel comes from the raw color's light and dark, raised on ridges and on faces
    that look up, and lowered in the hollows and where the occlusion is deep. The folds turn a
    greener shade, then stains, lichen and rain streaks lie over the bronze, and a pale mark on each
    eye, an ellipse round each of the points in `eyes` that `eye` sizes, on the faces that look
    forward.
    """
    raw = to_srgb(maps['color'])
    occlusion = maps['occlusion'][..., 0]
    curvature = maps['curvature'][..., 0]
    facing, position = maps['facing'], maps['position']

    # Curvature from Cycles' pointiness, centered on the flat surface's value and spread to its
    # range on this mesh, so that hollows read below 0 and ridges above.
    flat = np.median(curvature)
    spread = max(float(np.percentile(np.abs(curvature - flat), 95)), 1e-4)
    bend = np.clip((curvature - flat) / spread, -1, 1)
    ridge, hollow = np.clip(bend, 0, 1), np.clip(-bend, 0, 1)
    up = smoothstep(0.2, 0.9, facing[..., 2])
    upright = 1 - np.abs(facing[..., 2])

    luma = raw @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    detail = np.clip(luma / max(float(np.median(luma)), 1e-4) - 1, -0.6, 0.6)
    mottle = noise3(position, 0.15, rng, 2) - 0.5
    tone = 0.42 + PATINA['raw'] * 0.5 * detail + 0.3 * ridge + 0.18 * up - 0.55 * (1 - occlusion) - 0.15 * hollow + PATINA['mottle'] * mottle
    color = bronze(tone)
    fold = np.clip(smoothstep(0.8, 0.35, occlusion) + 0.5 * hollow, 0, 1)
    color = mix(color, np.array(PATINA['fold'], np.float32) * (0.8 + 0.5 * np.clip(tone, 0, 1))[..., None], 0.6 * fold)

    # Warm stains where the raw color runs warmest against its own blue-green cast, its red nearest
    # its green, broken up by noise so each patch runs from ochre to rust.
    red = raw[..., 0] - raw[..., 1]
    warmth = smoothstep(*np.percentile(red, (70, 95)), red) * (1 - 0.6 * fold)
    stains = warmth * smoothstep(0.3, 0.6, noise3(position, 0.5, rng, 2))
    warm = mix(np.broadcast_to(np.array(PATINA['stain'], np.float32), color.shape).copy(), PATINA['rust'], noise3(position, 0.25, rng, 2))
    color = mix(color, warm * (0.7 + 0.4 * np.clip(tone, 0, 1))[..., None], 0.8 * stains)
    lichen = smoothstep(0.74, 0.84, noise3(position, 0.08, rng, 2)) * (0.35 + 0.65 * up) * occlusion
    color = mix(color, PATINA['lichen'], 0.7 * lichen)
    pale = rain_streaks(position, height, rng) * upright
    dark = rain_streaks(position + np.array([0.37, -0.21, 0.0], np.float32), height, rng) * upright
    color = mix(color, PATINA['light'], 0.3 * pale)
    color = mix(color, PATINA['shade'], 0.35 * dark)

    # Matte: weathered bronze keeps a little of its metal on the rubbed ridges, none under crusts.
    roughness = np.clip(0.8 + 0.1 * (stains + lichen) - 0.1 * ridge, 0, 1)
    metal = np.clip(0.12 * (1 - fold) * (1 - lichen) * (1 - stains) + 0.08 * ridge, 0, 1)

    for middle in eyes:
        d = (position - np.array(middle, np.float32)) / np.array((eye[0], eye[0], eye[1]), np.float32)
        mark = smoothstep(1.0, 0.6, np.sqrt((d * d).sum(axis=2))) * smoothstep(0.2, 0.6, -facing[..., 1])
        color = mix(color, PATINA['eye'], mark)
    return np.clip(color, 0, 1), roughness, metal, occlusion


def finished_material(name, maps, painted, roughness, metal, occlusion):
    """The model's metal-rough material: the repainted color, the baked normals and the packed ORM."""
    color = image(f'{name}-color', painted)
    normal = image(f'{name}-normal', maps['normal'], 'Non-Color')
    packed = image(f'{name}-orm', np.dstack([occlusion, roughness, metal]), 'Non-Color')
    return material(name, color, normal, packed, roughness=0.8, tint=False)


# ---------------------------------------------------------------------------------------------
# The slab
# ---------------------------------------------------------------------------------------------


def slab_material(rng):
    """The slab's stone: the shared rock texture, lightened, with its normals and its ORM."""
    color, height, rough = rock_texture(512, rng)
    return material(
        'slab',
        image('slab-color', np.clip(color * SLAB['lighten'], 0, 1)),
        image('slab-normal', half(normal_map(height, 6)), 'Non-Color'),
        image('slab-orm', half(orm(occlusion_of(height, 24), rough)), 'Non-Color'),
        roughness=0.9,
    )


def stone_slab(name, radius, height, slope, sides, mat, phases):
    """
    A low round stone slab from just below the ground to `height`, its top edge rounded in by
    `slope` meters. Its rim wanders a little round its circle, as worked stone does, by waves whose
    `phases` every level of detail shares. The texture tiles round its side and over its top. Its
    vertex colors carry moss in patches along the rounded edge and the top's rim.
    """
    def wander(a):
        return 1 + sum(0.012 / (k + 1) * math.sin((k + 2) * a + phases[k]) for k in range(6))

    # The side's rings from the foot to the rounded edge, then a ring on the flat top that keeps the
    # moss on the rim, as each ring's height and its inset from the rim.
    rings = [(-0.05, 0.0), (height - slope, 0.0), (height - 0.35 * slope, 0.55 * slope), (height, slope), (height, slope + 0.12 * radius)]
    tile = SLAB['tile']
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    for z, inset in rings:
        grid.append([bm.verts.new((
            (radius * wander(a) - inset) * math.cos(a), (radius * wander(a) - inset) * math.sin(a), z,
        )) for a in (2 * math.pi * i / sides for i in range(sides))])
    middle = bm.verts.new((0.0, 0.0, height))
    lengths = [0.0]
    for (z0, i0), (z1, i1) in zip(rings, rings[1:]):
        lengths.append(lengths[-1] + math.hypot(z1 - z0, i1 - i0))
    for r in range(len(rings) - 1):
        top = rings[r][0] == rings[r + 1][0] == height
        for i in range(sides):
            j = (i + 1) % sides
            face = bm.faces.new((grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]))
            for loop, (k, row) in zip(face.loops, ((i, r), (i + 1, r), (i + 1, r + 1), (i, r + 1))):
                if top:
                    loop[uv].uv = (loop.vert.co.x / tile, loop.vert.co.y / tile)
                else:
                    loop[uv].uv = (2 * math.pi * radius * k / sides / tile, lengths[row] / tile)
    for i in range(sides):
        face = bm.faces.new((grid[-1][i], grid[-1][(i + 1) % sides], middle))
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / tile, loop.vert.co.y / tile)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))

    co = vertices_of(obj)
    a = np.arctan2(co[:, 1], co[:, 0])
    patches = sum(np.sin(k * a + phases[k % 6] * (k + 1)) / k for k in range(1, 9)) * 0.5 + 0.5
    edge = smoothstep(height - slope * 1.5, height - slope * 0.3, co[:, 2]) * smoothstep(radius * 0.85, radius * 0.95, np.hypot(co[:, 0], co[:, 1]))
    moss = np.clip(edge * smoothstep(0.35, 0.65, patches), 0, 1)[:, None]
    foot = smoothstep(-0.05, height * 0.6, co[:, 2])[:, None]
    colors = np.ones((len(co), 4), np.float32)
    colors[:, :3] = (np.array(SLAB['stone']) * (1 - moss) + np.array(SLAB['moss']) * moss) * (0.75 + 0.25 * foot)
    attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.ravel())
    mesh.color_attributes.active_color = attr
    mesh.shade_smooth()
    mesh.materials.append(mat)
    return obj


# ---------------------------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------------------------


def overcast(objects, size, samples):
    """
    The preview's stage under an overcast sky of even light with a faint sun, shown with the
    standard display curve, so a matte surface shows about its own color, darkened where it is
    occluded. The backdrop is the concept picture's pale cloud gray.
    """
    cam, low, high = stage(objects, (1.0, 1.0, 1.0), size, samples)
    scene = bpy.context.scene
    bpy.data.objects['preview-sun'].data.energy = 0.6
    nodes, links = scene.world.node_tree.nodes, scene.world.node_tree.links
    light = nodes['Background']
    light.inputs['Strength'].default_value = 1.0
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
    return cam, low, high


def ortho_views(objects, folder, name, size=800):
    """Front, side and top views with orthographic cameras that frame the model."""
    cam, low, high = overcast(objects, (size, size), 32)
    middle = (low + high) / 2
    extent = high - low
    cam.data.type = 'ORTHO'
    views = {
        'front': ((middle.x, low.y - 20, middle.z), (math.radians(90), 0, 0), max(extent.x, extent.z)),
        'side': ((high.x + 20, middle.y, middle.z), (math.radians(90), 0, math.radians(90)), max(extent.y, extent.z)),
        'top': ((middle.x, middle.y, high.z + 20), (0, 0, 0), max(extent.x, extent.y)),
    }
    for view, (location, rotation, span) in views.items():
        cam.location = location
        cam.rotation_euler = rotation
        cam.data.ortho_scale = span * 1.08
        cam.data.clip_end = 100
        bpy.context.scene.render.filepath = os.path.join(folder, f'{name}-{view}.png')
        bpy.ops.render.render(write_still=True)


def concept_view(objects, path, size=800, distance=60.0):
    """
    The model as the concept picture's camera sees it: from high in front and a little to its left,
    looking down about 27 degrees, from about `distance` meters away with a lens that fills the
    picture with the model, under an overcast sky.
    """
    cam, low, high = overcast(objects, (size, size), 64)
    azimuth, elevation = math.radians(15), math.radians(27)
    view = Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
    middle, radius = (low + high) / 2, (high - low).length / 2
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.lens = cam.data.sensor_width * distance / (1.5 * radius)
    cam.data.clip_end = distance * 2
    cam.location = middle + view * distance
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------


def levels_of(name, finest, make):
    """The lower levels that `make(k)` builds for each k from 1, and each one's surface error."""
    levels, errors = [], []
    for k in (1, 2):
        level = make(k)
        level.name = level.data.name = f'{name}-{k}'
        levels.append(level)
        errors.append(round(surface_error(level, finest), 4))
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
    eyes = low + np.array(spec['eyes'], np.float32) * (high_corner - low)
    if spec['cut'] > 0:
        cut_below(high, spec['cut'])
    slab_spec = spec['slab']
    figure = spec['height'] / (1 + slab_spec['height'])
    slab_height = figure * slab_spec['height']
    # The eye marks ride through every change of shape with the mesh. The figure's foot sinks a
    # little into the slab, so its cut edge never shows.
    co = vertices_of(high)
    neck = co[:, 2].min() + spec['neck'] * (co[:, 2].max() - co[:, 2].min())
    for shape in (
        lambda c: head_growth(c, neck, **spec['head']),
        lambda c: body_reshape(c, neck, **spec['body']),
        lambda c: standing(c, figure, spec['turn'], slab_height - 0.02),
    ):
        move = shape(co)
        co, eyes = move(co), move(eyes)
    set_vertices(high, co)
    size = co.max(axis=0) - co.min(axis=0)
    knees = float(size[0])

    mat = slab_material(rng)
    radius = knees * slab_spec['width'] / 2
    phases = rng.random(6) * 2 * math.pi

    def slab_level(k):
        return stone_slab(f'slab-{k}' if k else 'slab', radius, slab_height, slab_spec['slope'], slab_spec['sides'][k], mat, phases)

    slab = slab_level(0)
    slab_levels, slab_errors = levels_of('slab', slab, slab_level)

    statue = decimated(high, spec['triangles'], 'statue')
    maps = bake_maps(high, statue, color, normal, spec['texture'])
    painted, roughness, metal, occlusion = repaint(maps, spec['height'], eyes, spec['eye'], rng)
    statue.data.materials.clear()
    statue.data.materials.append(finished_material('statue', maps, painted, roughness, metal, occlusion))
    statue_levels, statue_errors = levels_of('statue', statue, lambda k: decimated(
        statue, round(spec['triangles'] * spec['levels'][k - 1]), f'statue-{k}'))
    bpy.data.objects.remove(high)
    figures = dict(raw_triangles=raw_triangles, figure=figure, slab=slab_height, knees=knees, depth=float(size[1]), slab_width=2 * radius)
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
        for o in parts:
            o.hide_render = o not in finest
        ortho_views(finest, shots, 'statue')
        concept_view(finest, os.path.join(shots, 'statue-concept-view.png'))
        # The finest statue beside its two lower levels, as a page's camera sees them where each
        # level takes over.
        levels = [finest] + [[bpy.data.objects[f'statue-{k}'], bpy.data.objects[f'slab-{k}']] for k in (1, 2)]
        for distance in (40, 80):
            at_distance(levels, os.path.join(shots, f'statue-levels-{distance}m.png'), distance)


main()
