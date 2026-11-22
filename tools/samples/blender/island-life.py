# Finishes the island's people and vehicles from the raw Tripo3D models in the sample-assets
# repository. The raw files are the downloaded Tripo3D outputs; every change here is made again from
# them, so a rebuild gives the same files:
#
#   blender --background --factory-startup --python tools/samples/blender/island-life.py -- \
#     <output folder> --raw <folder of the four raw files> [--preview <folder>]
#
# `bun tools/samples/blender/island-life.ts <folder> --raw <folder>` runs it and optimizes the file.
#
# It writes one binary glTF file, `life.glb`, holding:
#   villager      the rigged villager with its walk clip, split into body, hair, shirt, trousers
#                 and shoes, each a skinned mesh that shares the skeleton and the clip
#   woman         the woman in her dress, rigged and split the same way
#   youngman      the young man in his T-shirt and shorts, rigged and split the same way
#   *-far         each person's standing parts, with two lower levels of detail, for the copies that
#                 a scene draws too far off to walk; all but the villager's come from the rest pose
#                 that the rig was fitted to
#   hatchback     the car, split into hull, glass, trim and its four wheels, each with two lower
#                 levels of detail
#   minibus       the bus, split into hull, band, glass, trim and its four wheels, each with two
#                 lower levels. A wheel's origin stands on its axle, so a scene turns it by the
#                 distance travelled over its radius; the script prints each radius.
#
# Every part keeps the raw model's texture, except the clothing and the vehicle bodies: those carry
# a plain white base, so a scene multiplies each copy's own colour into them exactly and one
# material draws a blue shirt and a cream one. Skin, hair, glass, wheels and trim keep the texture.
# The villager is about 1.75 m tall, the woman 1.70 m and the young man 1.80 m; the hatchback is
# about 3.7 m long and the minibus about 4.9 m. Origins stand at the feet or the tyres' base, and
# every model faces the engine's forward axis: Blender's -y, which the glTF export turns into +z.
# Tripo3D's raw models face +x, so each is turned -90 degrees about the vertical axis.
#
# The parts are cut by the colour that each face samples from its own texture atlas, checked against
# the face's height. The raw meshes are too fragmented for their loose parts to stand for a part of
# the body or the vehicle: the villager alone is 59 islands.
#
# A skinned mesh cannot take MSFT_lod levels: the engine refuses levels on a mesh with joints. So
# each walking person has one level, and the standing parts are the lower-detail proxy that a scene
# draws far away. The engine builds one skeleton and one clip set for a whole file and refuses two
# clips of one name, so each person's rig and clip carry the person's name.

import hashlib
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import close_up, export, preview  # noqa: E402

# The parts, the colour rules that cut them, and the sizes the finished models stand at.
VILLAGER_HEIGHT = 1.75
HATCHBACK_LENGTH = 3.7
MINIBUS_LENGTH = 4.9
# Each lower level keeps this share of its part's triangles.
LOD_SHARES = (0.4, 0.12)
# The parts, in the order that the raw models' texels name them. A vehicle's tyres are cut into
# its four wheels, each a part of its own.
VILLAGER_PARTS = ('body', 'hair', 'shirt', 'trousers', 'shoes')
WHEEL_NAMES = ('wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br')
HATCHBACK_PARTS = ('hull', 'glass', 'trim') + WHEEL_NAMES
MINIBUS_PARTS = ('hull', 'band', 'glass', 'trim') + WHEEL_NAMES
# The raw files, as the sample-assets manifest records them, so a swapped input fails the build.
RAW_SHA256 = {
    'villager/model.glb': '66477dc89da1baecc482d895d45384c4f190daadc91f7723d59271e9fd4eb7a8',
    'villager-walk/model.glb': 'eab971a7831ce759d49ea1fd2737bb5ac8744a54f11e803b2009788e82ae6591',
    'woman/model.glb': 'e5e9f97708d0a3cca3b7ba9925f75962378b41dbc9607a9274557fa3d1762b64',
    'youngman/model.glb': 'e3f13ec5da8954150eadce086c17403341fce6eb3f76b0dab0485f3c8b7ffc56',
    'hatchback/model.glb': '2968bff94ffd3820166903fd8ee5fe4af4ab446b7fe46f86bfd66c5e0f937ec4',
    'minibus/model.glb': '81df03e556ec33fbea737e9b5464642b1dcfaf8eb41395306e9b70389c5463be',
}


def check_raw(raw):
    """Refuses a raw folder whose files are not the ones the sample-assets manifest records."""
    for name, expected in RAW_SHA256.items():
        path = os.path.join(raw, name)
        with open(path, 'rb') as f:
            found = hashlib.sha256(f.read()).hexdigest()
        if found != expected:
            raise SystemExit(f'{path}: SHA-256 {found}, not {expected}')
        print(f'LIFE raw {name}: {found}')

def clear():
    bpy.ops.object.select_all(action='DESELECT')
    for object in list(bpy.data.objects):
        bpy.data.objects.remove(object, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for arm in list(bpy.data.armatures):
        bpy.data.armatures.remove(arm)


def import_glb(path):
    """Imports a binary glTF file into the empty scene, and returns its mesh objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def remove_helpers(objects):
    """Deletes the loose helper meshes that carry no material, such as the rig's bounding sphere."""
    kept, removed = [], []
    for object in objects:
        if object.type == 'MESH' and not object.data.materials:
            removed.append(object.name)
            bpy.data.objects.remove(object, do_unlink=True)
        else:
            kept.append(object)
    return kept, removed


def image_of(mesh_object):
    for slot in mesh_object.data.materials:
        if slot and slot.use_nodes:
            for node in slot.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    return node.image
    raise SystemExit(f'{mesh_object.name} has no texture')


def pixels(img):
    return np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)


def face_colours(me, texels):
    """Each face's colour: the median of samples spread across its two triangles' texture space."""
    uv = me.uv_layers[0].data
    out = np.zeros((len(me.polygons), 3), np.float32)
    weights = (
        (1 / 3, 1 / 3, 1 / 3), (0.6, 0.2, 0.2), (0.2, 0.6, 0.2), (0.2, 0.2, 0.6),
        (0.5, 0.5, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5),
    )
    height, width = texels.shape[:2]
    for index, face in enumerate(me.polygons):
        loops = [uv[i].uv.copy() for i in face.loop_indices]
        triangles = [(0, 1, 2)]
        if len(loops) == 4:
            triangles.append((0, 2, 3))
        found = []
        for a, b, c in triangles:
            for wa, wb, wc in weights:
                p = loops[a] * wa + loops[b] * wb + loops[c] * wc
                x = int((p.x % 1.0) * (width - 1))
                y = int((p.y % 1.0) * (height - 1))
                found.append(texels[y, x, :3])
        out[index] = np.median(np.array(found), axis=0)
    return out


def luminance(rgb):
    return float(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])


def blue(rgb):
    return rgb[2] - rgb[0] > 0.02


def warm(rgb):
    return rgb[0] - rgb[2] > 0.02


def neutral(rgb):
    return max(rgb) - min(rgb) < 0.09


def villager_part(rgb, z, height):
    """A villager face's part, from its texture colour and its height above the feet."""
    h = z / height if height else 0.0
    if h < 0.07 and warm(rgb):
        return 'shoes'
    if h > 0.80 and neutral(rgb) and luminance(rgb) < 0.62:
        return 'hair'
    if blue(rgb):
        if h > 0.59:
            return 'shirt'
        if h < 0.52:
            return 'trousers'
        return 'shirt' if luminance(rgb) > 0.30 else 'trousers'
    return 'body'


def woman_part(rgb, z, height):
    """A woman face's part: her terracotta dress holds red where her skin holds green.

    Her dress is red through its highlights and its shadowed folds, where its green stays far below
    its red; her skin keeps green well above half its red. The dress runs from her shoulders to
    below her knees, so it fills both clothing parts: its upper share is the shirt, its lower share
    the trousers.
    """
    h = z / height if height else 0.0
    light = luminance(rgb)
    red = rgb[0] - rgb[1]
    green = rgb[1] / max(rgb[0], 1e-4)
    if h < 0.08:
        return 'shoes'
    if red > 0.30 or (rgb[0] > 0.10 and green < 0.40) or (red > 0.19 and rgb[1] - rgb[2] < 0.085):
        return 'shirt' if h > 0.53 else 'trousers'
    if h > 0.78 and light < 0.32 and red < 0.15:
        return 'hair'
    return 'body'


def youngman_part(rgb, z, height):
    """A young man face's part: a white T-shirt, khaki shorts, white trainers and dark hair."""
    h = z / height if height else 0.0
    light = luminance(rgb)
    spread = max(rgb) - min(rgb)
    if h < 0.09:
        return 'shoes'
    if h > 0.78 and light < 0.32:
        return 'hair'
    if h > 0.40 and light > 0.62 and spread < 0.14:
        return 'shirt'
    if 0.28 < h < 0.62 and rgb[0] - rgb[1] < 0.14 and rgb[0] - rgb[2] > 0.10 and light > 0.34:
        return 'trousers'
    return 'body'


def hatchback_part(rgb, h):
    """A car face's part, from its colour and its height above the tyres' base, in metres."""
    light = luminance(rgb)
    if h < 0.42 and light < 0.24:
        return 'tyres'
    if h > 0.42 and rgb[1] - rgb[0] > 0.015 and rgb[1] - rgb[2] > -0.02 and light < 0.5:
        return 'glass'
    if light > 0.42:
        return 'hull'
    return 'trim'


def minibus_part(rgb, h):
    """A bus face's part, from its colour and its height above the tyres' base, in metres."""
    light = luminance(rgb)
    if h < 0.55 and light < 0.24:
        return 'tyres'
    if rgb[2] - rgb[0] > 0.18 and light > 0.18:
        return 'band'
    if h > 0.55 and rgb[1] - rgb[0] > 0.01 and light < 0.42:
        return 'glass'
    if light > 0.42:
        return 'hull'
    return 'trim'


def part_material(name, texture, roughness=0.8, metallic=0.0, base=(1.0, 1.0, 1.0)):
    """A metal-rough material for the part's own region of the model's texture.

    A part with no texture is plain, at `base`: a light colour that a scene multiplies by each
    copy's own colour, so one material draws a blue shirt and a cream one.
    """
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    if texture is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = texture
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat.use_backface_culling = True
    return mat


# The look of each part: the raw texture keeps the model's colour, and the finish sets its surfaces.
ROUGHNESS = {
    'body': 0.72, 'hair': 0.62, 'shirt': 0.86, 'trousers': 0.88, 'shoes': 0.7,
    'hull': 0.42, 'band': 0.45, 'glass': 0.12, 'trim': 0.62,
}
METALLIC = {'glass': 0.1, 'hull': 0.15, 'band': 0.1, 'trim': 0.1}
# The parts that a scene tints: clothing on a person, and a vehicle's body. Each keeps a plain white
# base, which the copy's own colour multiplies exactly. Skin, hair, glass, tyres and trim keep the
# texture.
CLOTHING = ('shirt', 'trousers', 'shoes')
BODY = ('hull', 'band')
PLAIN_BASE = (1.0, 1.0, 1.0)
# A vehicle's four wheels, as parts of their own: a scene turns each about the axle through its
# origin by the distance travelled over its radius. Their treads keep the texture, so they never
# join the tintable parts.
# The plan reach that holds one wheel's tyre faces, and the outer share of the width that holds a
# tyre alone rather than the inboard underbody.
WHEEL_CROP = 0.30
WHEEL_BAND = 0.26
WHEEL_MARGIN = 0.01


def median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def face_centres(me, world):
    """Each face's world centre."""
    out = []
    for face in me.polygons:
        verts = face.vertices
        count = len(verts)
        out.append(Vector((
            sum(world[v].x for v in verts) / count,
            sum(world[v].y for v in verts) / count,
            sum(world[v].z for v in verts) / count,
        )))
    return out


def fit_wheels(me, labels, world, centres):
    """The four wheels, from the tyre-coloured faces: each axle's centre, radius and width.

    A wheel's tyre faces form a dense cluster at its corner of the vehicle, while the bumper and
    underbody faces that share their dark colour lie away from it. A median within a crop around
    each quadrant's centre settles on the wheel, and the outer band of its width then measures the
    tyre alone. The axle stands a radius above the ground, where the tyre's lowest face touches it.
    """
    tyres = [i for i, label in enumerate(labels) if label == 'tyres']
    if len(tyres) < 4:
        raise SystemExit(f'{len(tyres)} tyre faces cannot make four wheels')
    mid_x = median([centres[i].x for i in tyres])
    mid_y = median([centres[i].y for i in tyres])
    seeds = []
    for sx in (1, -1):
        for sy in (1, -1):
            pick = [i for i in tyres if (1 if centres[i].x >= mid_x else -1) == sx
                    and (1 if centres[i].y >= mid_y else -1) == sy]
            if not pick:
                raise SystemExit('a vehicle corner has no tyre faces')
            seeds.append([sum(centres[i].x for i in pick) / len(pick),
                          sum(centres[i].y for i in pick) / len(pick)])
    for _ in range(10):
        for k, (cx, cy) in enumerate(seeds):
            crop = [i for i in tyres
                    if math.hypot(centres[i].x - cx, centres[i].y - cy) < WHEEL_CROP]
            if crop:
                seeds[k] = [median([centres[i].x for i in crop]),
                            median([centres[i].y for i in crop])]
    wheels = []
    for cx, cy in seeds:
        crop = [i for i in tyres if math.hypot(centres[i].x - cx, centres[i].y - cy) < WHEEL_CROP]
        verts = {v for i in crop for v in me.polygons[i].vertices}
        points = [world[v] for v in verts]
        outer = max(p.x for p in points) if cx > 0 else min(p.x for p in points)
        band = [p for p in points
                if (p.x >= outer - WHEEL_BAND if cx > 0 else p.x <= outer + WHEEL_BAND)]
        if not band:
            raise SystemExit('a wheel has no tyre faces at its outer side')
        x0, x1 = min(p.x for p in band), max(p.x for p in band)
        y0, y1 = min(p.y for p in band), max(p.y for p in band)
        axle_y = (y0 + y1) / 2
        axle_z = min(p.z for p in band) + (y1 - y0) / 2
        radii = sorted(math.hypot(p.y - axle_y, p.z - axle_z) for p in band)
        wheels.append(dict(
            cx=(x0 + x1) / 2, cy=axle_y, cz=axle_z, x0=x0, x1=x1,
            radius=radii[min(len(radii) - 1, int(0.99 * len(radii)))],
        ))
    mid_x = (min(w['cx'] for w in wheels) + max(w['cx'] for w in wheels)) / 2
    mid_y = (min(w['cy'] for w in wheels) + max(w['cy'] for w in wheels)) / 2
    for wheel in wheels:
        front = wheel['cy'] < mid_y
        left = wheel['cx'] > mid_x
        wheel['name'] = 'wheel-' + ('f' if front else 'b') + ('l' if left else 'r')
    return wheels


def resolve_wheels(labels, centres, wheels):
    """Gives each face inside a wheel's cylinder its wheel, and the other tyre faces to the trim.

    The cylinder holds the tyre, its rim and its hub, so they turn together; a body panel outside
    the tyre's radius, such as the arch's lip, stays with the body.
    """
    for index, centre in enumerate(centres):
        for wheel in wheels:
            inside_x = wheel['x0'] - WHEEL_MARGIN <= centre.x <= wheel['x1'] + WHEEL_MARGIN
            inside_tyre = math.hypot(centre.y - wheel['cy'], centre.z - wheel['cz']) <= (
                wheel['radius'] + WHEEL_MARGIN
            )
            if inside_x and inside_tyre:
                labels[index] = wheel['name']
                break
        else:
            if labels[index] == 'tyres':
                labels[index] = 'trim'
    return labels


def smooth_labels(me, labels, rounds=2):
    """Gives a face the part that most of its neighbours have, where a strict majority agrees.

    A cloth's shadowed fold can sample darker than skin and so take the skin's part; its neighbours
    are cloth, and two rounds fold the stray face back into the garment it lies on.
    """
    shared = {}
    for face in me.polygons:
        for key in face.edge_keys:
            shared.setdefault(key, []).append(face.index)
    neighbours = [[] for _ in me.polygons]
    for pair in shared.values():
        if len(pair) == 2:
            neighbours[pair[0]].append(pair[1])
            neighbours[pair[1]].append(pair[0])
    for _ in range(rounds):
        changed = 0
        moved = list(labels)
        for index, near in enumerate(neighbours):
            if not near:
                continue
            votes = {}
            for other in near:
                votes[labels[other]] = votes.get(labels[other], 0) + 1
            best = max(votes, key=votes.get)
            if labels[index] != best and votes[best] * 2 > len(near):
                moved[index] = best
                changed += 1
        labels = moved
        if not changed:
            break
    return labels


def raw_labels(object, classify, smooth=False):
    """Each face's part from its texture colour and height, and the faces' world centres."""
    me = object.data
    texture = image_of(object)
    colours = face_colours(me, pixels(texture))
    matrix = object.matrix_world
    world = [matrix @ v.co for v in me.vertices]
    low = min(p.z for p in world)
    high = max(p.z for p in world)
    height = high - low
    labels = []
    for index, face in enumerate(me.polygons):
        centre = sum((world[v].z for v in face.vertices), 0.0) / len(face.vertices)
        labels.append(classify(colours[index], centre, height))
    if smooth:
        labels = smooth_labels(me, labels)
    return labels, world


def assign_parts(object, parts, labels, plain=()):
    """Adds one material a part to the object and gives each face the part in `labels`."""
    me = object.data
    texture = image_of(object)
    me.materials.clear()
    slots = {}
    for name in parts:
        made = part_material(
            f'life-{parts.prefix}-{name}',
            None if name in plain else texture,
            0.92 if name.startswith('wheel-') else ROUGHNESS.get(name, 0.8),
            0.0 if name.startswith('wheel-') else METALLIC.get(name, 0.0),
            PLAIN_BASE,
        )
        slots[name] = len(me.materials)
        me.materials.append(made)
    counts = {name: 0 for name in parts}
    for index, face in enumerate(me.polygons):
        name = labels[index]
        face.material_index = slots[name]
        counts[name] += 1
    return counts


class NamedParts(tuple):
    """The part names with the model's prefix, which materials and objects share."""

    def __new__(cls, prefix, names):
        made = super().__new__(cls, names)
        made.prefix = prefix
        return made


def split(object, parts):
    """Splits the object into one object a part, by the material of each face, and names them."""
    before = set(bpy.data.objects)
    bpy.context.view_layer.objects.active = object
    bpy.ops.object.select_all(action='DESELECT')
    object.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    made = [object] + [o for o in bpy.data.objects if o not in before]
    named = {}
    for piece in made:
        if not piece.data.materials or not piece.data.polygons:
            continue
        used = {face.material_index for face in piece.data.polygons}
        if len(used) != 1:
            raise SystemExit(f'{piece.name} kept {len(used)} materials after the split')
        chosen = piece.data.materials[used.pop()]
        prefix = f'life-{parts.prefix}-'
        part = chosen.name[len(prefix):] if chosen.name.startswith(prefix) else chosen.name
        if part not in parts:
            continue
        piece.data.materials.clear()
        piece.data.materials.append(bpy.data.materials[chosen.name])
        for face in piece.data.polygons:
            face.material_index = 0
        piece.name = f'{parts.prefix}-{part}'
        named[part] = piece
    missing = [name for name in parts if name not in named]
    if missing:
        raise SystemExit(f'{parts.prefix}: no faces for {missing}')
    return named


def measure_surface(source, lower):
    """The lower mesh's surface error: the farthest of its vertices from the source's surface."""
    me = source.data
    tree = BVHTree.FromPolygons([tuple(v.co) for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    worst = 0.0
    for vertex in lower.data.vertices:
        _, _, _, distance = tree.find_nearest(vertex.co, 10.0)
        if distance is not None:
            worst = max(worst, distance)
    return worst


def lower_level(object, share, name, source):
    """A copy of the object cut to `share` of its triangles, and its measured surface error."""
    lower = object.copy()
    lower.data = object.data.copy()
    lower.name = name
    lower.data.name = name
    bpy.context.scene.collection.objects.link(lower)
    decimate = lower.modifiers.new('decimate', 'DECIMATE')
    decimate.ratio = share
    decimate.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = lower
    bpy.ops.object.select_all(action='DESELECT')
    lower.select_set(True)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    return lower, measure_surface(source, lower)


def triangles(object):
    return sum(len(p.vertices) - 2 for p in object.data.polygons)


def bounds(objects):
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def bake(object, turn, scale, ground):
    """Bakes the object's place into its mesh, turns and scales it, and stands it on `ground`."""
    me = object.data
    me.transform(object.matrix_world)
    object.matrix_world = Matrix.Identity(4)
    matrix = Matrix.Scale(scale, 4) @ Matrix.Rotation(turn, 4, 'Z')
    me.transform(matrix)
    low = min(v.co.z for v in me.vertices)
    me.transform(Matrix.Translation((0.0, 0.0, ground - low)))


def report_model(model, parts, levels=()):
    entries = []
    for name, object in parts.items():
        low, high = bounds([object])
        entries.append(
            dict(
                name=object.name,
                part=name,
                triangles=triangles(object),
                size=tuple(round(float(v), 3) for v in (high - low)),
            )
        )
    # The rest pose, which a skinned part's evaluated box does not show.
    zs = [(o.matrix_world @ v.co).z for o in parts.values() for v in o.data.vertices]
    xs = [(o.matrix_world @ v.co).x for o in parts.values() for v in o.data.vertices]
    ys = [(o.matrix_world @ v.co).y for o in parts.values() for v in o.data.vertices]
    rest = dict(
        height=round(max(zs) - min(zs), 3),
        width=round(max(xs) - min(xs), 3),
        depth=round(max(ys) - min(ys), 3),
        foot=round(min(zs), 3),
    )
    return dict(model=model, parts=entries, levels=list(levels), rest=rest)


def parts_view(objects, path, colours, view=(1.6, -3.6, 1.3)):
    """Renders the objects with one flat colour a part, so the split can be judged."""
    scene = bpy.context.scene
    saved = [(o, o.color[:]) for o in objects]
    for object in objects:
        colour = next((value for key, value in colours.items() if object.name.endswith(f'-{key}')),
                      (0.8, 0.8, 0.8))
        object.color = (*colour, 1.0)
    for object in scene.objects:
        if object.type == 'MESH':
            object.hide_render = object not in objects
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = (720, 540)
    scene.render.film_transparent = False
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    middle = (low + high) / 2
    reach = (high - low).length
    cam = bpy.data.objects.get('parts-camera') or bpy.data.objects.new(
        'parts-camera', bpy.data.cameras.new('parts-camera'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'PERSP'
    cam.data.lens = 50
    direction = Vector(view).normalized()
    cam.location = middle + direction * reach * 2.0
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for object, colour in saved:
        object.color = colour


def static_proxy(source, name):
    """A standing copy of a skinned mesh in its rest pose, detached from its rig.

    The rest pose is the pose that the rig was fitted to, which is the standing shape that the
    model was generated in, so it serves for the copies that a scene draws too far off to walk.
    """
    proxy = source.copy()
    proxy.data = source.data.copy()
    proxy.name = name
    proxy.data.name = name
    bpy.context.scene.collection.objects.link(proxy)
    for modifier in list(proxy.modifiers):
        proxy.modifiers.remove(modifier)
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    if proxy.parent is not None:
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.context.view_layer.update()
    bake(proxy, 0.0, 1.0, 0.0)
    return proxy


def build_person(prefix, walk, classify, height=None, far_static=None, far_texture=None):
    """One person's walking parts and the standing parts that a scene draws far off.

    `height` scales the model to that height, or leaves its own when it is None. `far_static` names
    a standing raw model for the far parts; without one they come from the walk model's rest pose.
    The clothing parts are plain, so a scene multiplies each copy's own colour into them.
    """
    imported = import_glb(walk)
    imported, removed = remove_helpers(imported)
    meshes = [o for o in imported if o.type == 'MESH']
    if len(meshes) != 1:
        raise SystemExit(f'{walk} has {len(meshes)} meshes, not one')
    body = meshes[0]
    arm = next(o for o in imported if o.type == 'ARMATURE')
    # The engine builds one skeleton and one set of clips for a whole file, and refuses two clips
    # of one name, so each person's rig and clip carry the person's name.
    arm.name = f'{prefix}-rig'
    arm.data.name = f'{prefix}-rig'
    if arm.animation_data and arm.animation_data.action:
        arm.animation_data.action.name = f'walk-{prefix}'
    low = min(v.co.z for v in body.data.vertices)
    high = max(v.co.z for v in body.data.vertices)
    scale = 1.0 if height is None else height / (high - low)
    # The rig turns as one: the armature node carries the turn and the scale, so the clip's own keys
    # stay in the rig's frame.
    arm.matrix_world = Matrix.Scale(scale, 4) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ arm.matrix_world
    bpy.context.view_layer.update()
    actual = round((high - low) * scale, 3)
    rest = None if far_static else static_proxy(body, f'{prefix}-rest')

    parts = NamedParts(prefix, VILLAGER_PARTS)
    labels, _ = raw_labels(body, classify, smooth=True)
    counts = assign_parts(body, parts, labels, CLOTHING)
    pieces = split(body, parts)

    if far_static:
        imported = import_glb(far_static)
        imported, _ = remove_helpers(imported)
        proxy = next(o for o in imported if o.type == 'MESH')
        if far_texture:
            image_of(proxy).scale(far_texture, far_texture)
        low = min((proxy.matrix_world @ v.co).z for v in proxy.data.vertices)
        high = max((proxy.matrix_world @ v.co).z for v in proxy.data.vertices)
        bake(proxy, -math.pi / 2, (height or high - low) / (high - low), 0.0)
    else:
        proxy = rest

    far_parts = NamedParts(f'{prefix}-far', VILLAGER_PARTS)
    far_labels, _ = raw_labels(proxy, classify, smooth=True)
    far_counts = assign_parts(proxy, far_parts, far_labels, CLOTHING)
    far_pieces = split(proxy, far_parts)
    far_objects, errors = [], [0.0, 0.0]
    for piece in far_pieces.values():
        far_objects.append(piece)
        for k, share in enumerate(LOD_SHARES, start=1):
            lower, error = lower_level(piece, share, f'{piece.name}-{k}', piece)
            far_objects.append(lower)
            errors[k - 1] = max(errors[k - 1], error)
    return dict(
        prefix=prefix, pieces=pieces, far=far_pieces, far_objects=far_objects,
        counts=counts, far_counts=far_counts, errors=errors, height=actual, removed=removed,
    )


def tint_view(objects, path, palette, view=(1.6, -3.6, 1.3)):
    """Renders the objects with a sample colour in every plain part, as a scene's tint makes them."""
    plain = []
    for object in objects:
        for material in object.data.materials:
            if not material or not material.use_nodes:
                continue
            nodes = material.node_tree.nodes
            if any(node.type == 'TEX_IMAGE' for node in nodes):
                continue
            part = material.name.rsplit('-', 1)[-1]
            colour = palette.get(part)
            if colour is None:
                continue
            bsdf = nodes.get('Principled BSDF')
            plain.append((bsdf, tuple(bsdf.inputs['Base Color'].default_value)))
            bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    preview(objects, path, view, samples=20)
    for bsdf, colour in plain:
        bsdf.inputs['Base Color'].default_value = colour


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not args:
        raise SystemExit('island-life.py: give the output folder and --raw <folder>')
    out = os.path.abspath(args[0])
    raw = os.path.abspath(args[args.index('--raw') + 1]) if '--raw' in args else None
    shots = os.path.abspath(args[args.index('--preview') + 1]) if '--preview' in args else None
    if not raw:
        raise SystemExit('island-life.py: --raw names the folder of the four raw Tripo3D files')
    check_raw(raw)
    os.makedirs(out, exist_ok=True)
    if shots:
        os.makedirs(shots, exist_ok=True)

    everything, near, reports = [], {}, []
    clear()

    # The three people: the villager, the woman and the young man. Each walks with its own clip and
    # has standing parts for the copies that a scene draws far off.
    for prefix, walk, classify, height, far_static, far_texture in (
        ('villager', os.path.join(raw, 'villager-walk', 'model.glb'), villager_part, VILLAGER_HEIGHT,
         os.path.join(raw, 'villager', 'model.glb'), 512),
        ('woman', os.path.join(raw, 'woman', 'model.glb'), woman_part, None, None, None),
        ('youngman', os.path.join(raw, 'youngman', 'model.glb'), youngman_part, None, None, None),
    ):
        made = build_person(prefix, walk, classify, height, far_static, far_texture)
        near[prefix] = made['pieces']
        near[f'{prefix}-far'] = made['far']
        everything += list(made['pieces'].values()) + made['far_objects']
        reports.append(report_model(prefix, made['pieces']))
        reports.append(report_model(f'{prefix}-far', made['far'], made['errors']))
        print(f'LIFE {prefix}: {made["height"]} m tall, faces per part {made["counts"]}, '
              f'removed helpers {made["removed"]}; far faces {made["far_counts"]}, '
              f'level errors {[round(e, 4) for e in made["errors"]]}')

    # The vehicles: three levels each, cut by colour and height above the tyres' base.
    for model, parts, classify, length in (
        ('hatchback', HATCHBACK_PARTS, hatchback_part, HATCHBACK_LENGTH),
        ('minibus', MINIBUS_PARTS, minibus_part, MINIBUS_LENGTH),
    ):
        imported = import_glb(os.path.join(raw, model, 'model.glb'))
        imported, _ = remove_helpers(imported)
        mesh_objects = [o for o in imported if o.type == 'MESH']
        if len(mesh_objects) != 1:
            raise SystemExit(f'{model}.glb has {len(mesh_objects)} meshes, not one')
        body = mesh_objects[0]
        me = body.data
        co = np.array([tuple(body.matrix_world @ v.co) for v in me.vertices], np.float32)
        low, high = co.min(axis=0), co.max(axis=0)
        scale = length / (high[0] - low[0])
        bake(body, -math.pi / 2, scale, 0.0)
        named = NamedParts(model, parts)
        labels, world = raw_labels(body, lambda rgb, z, height: classify(rgb, z))
        centres = face_centres(me, world)
        wheels = fit_wheels(me, labels, world, centres)
        labels = resolve_wheels(labels, centres, wheels)
        counts = assign_parts(body, named, labels, BODY)
        pieces = split(body, named)
        # Each wheel's origin stands on its axle, so a scene turns it about itself.
        for wheel in wheels:
            piece = pieces[wheel['name']]
            centre = Vector((wheel['cx'], wheel['cy'], wheel['cz']))
            piece.data.transform(Matrix.Translation(-centre))
            piece.location = centre
        bpy.context.view_layer.update()
        models = []
        errors = [0.0, 0.0]
        for name, piece in pieces.items():
            models.append(piece)
            for k, share in enumerate(LOD_SHARES, start=1):
                lower, error = lower_level(piece, share, f'{piece.name}-{k}', piece)
                models.append(lower)
                errors[k - 1] = max(errors[k - 1], error)
        near[model] = pieces
        everything += models
        reports.append(report_model(model, pieces, errors))
        print(f'LIFE {model}: scale {scale:.4f}, faces per part {counts}, measured level errors '
              f'{[round(e, 4) for e in errors]}')
        for wheel in sorted(wheels, key=lambda w: w['name']):
            print(f'LIFE {model} {wheel["name"]}: radius {wheel["radius"]:.3f} m, '
                  f'axle ({wheel["cx"]:.3f}, {wheel["cy"]:.3f}, {wheel["cz"]:.3f})')

    # One error list serves every node with lower levels: the worst measurement across the file.
    levels = [max(r['levels'][k] for r in reports if r['levels']) for k in range(len(LOD_SHARES))]
    path = os.path.join(out, 'life.glb')
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    found = export(path, everything + rigs, set(), levels, animations=True)
    for name, count in sorted(found.items()):
        print(f'LIFE {name}: {count} triangles')
    size = os.path.getsize(path)
    print(f'LIFE life.glb: {size / 1e6:.2f} MB')
    for r in reports:
        print(f'LIFE {r["model"]}: rest height {r["rest"]["height"]} m, width {r["rest"]["width"]} m, '
              f'depth {r["rest"]["depth"]} m, foot {r["rest"]["foot"]} m')
        for p in r['parts']:
            print(f'LIFE {r["model"]} {p["part"]}: {p["triangles"]} triangles, '
                  f'size {p["size"]} m')
    print(f'LIFE level errors: {[round(e, 4) for e in levels]}')

    if shots:
        colours = {
            'body': (0.85, 0.7, 0.55), 'hair': (0.2, 0.2, 0.22), 'shirt': (0.25, 0.5, 0.95),
            'trousers': (0.1, 0.12, 0.35), 'shoes': (0.55, 0.3, 0.15),
            'hull': (0.92, 0.92, 0.92), 'band': (0.15, 0.4, 0.85), 'glass': (0.1, 0.5, 0.55),
            'trim': (0.55, 0.55, 0.55), 'wheel-fl': (0.9, 0.15, 0.15),
            'wheel-fr': (0.15, 0.45, 0.9), 'wheel-bl': (0.9, 0.6, 0.15),
            'wheel-br': (0.2, 0.8, 0.3),
        }
        # A sample colour for each plain part, linear, as a scene's own colours multiply them.
        tints = {
            'villager': {'shirt': (0.16, 0.28, 0.45), 'trousers': (0.10, 0.12, 0.20),
                         'shoes': (0.28, 0.18, 0.12)},
            'woman': {'shirt': (0.55, 0.22, 0.14), 'trousers': (0.55, 0.22, 0.14),
                      'shoes': (0.15, 0.12, 0.10)},
            'youngman': {'shirt': (0.75, 0.78, 0.72), 'trousers': (0.45, 0.40, 0.26),
                         'shoes': (0.85, 0.85, 0.83)},
            'hatchback': {'hull': (0.45, 0.50, 0.40)},
            'minibus': {'hull': (0.82, 0.82, 0.78), 'band': (0.55, 0.12, 0.10)},
        }
        for model, pieces in near.items():
            objects = list(pieces.values())
            preview(objects, os.path.join(shots, f'{model}.png'), (1.6, -3.6, 1.3), samples=20)
            close_up(objects, os.path.join(shots, f'{model}-close.png'), (1.4, -3.2, 1.0))
            parts_view(objects, os.path.join(shots, f'{model}-parts.png'), colours)
            base = model[:-4] if model.endswith('-far') else model
            if base in tints:
                tint_view(objects, os.path.join(shots, f'{model}-tinted.png'), tints[base])


main()
