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
#   villager-far  the standing villager, split the same way, with two lower levels of detail, for
#                 people drawn far enough that a walk cycle cannot show
#   hatchback     the car, split into hull, glass, tyres and trim, each with two lower levels
#   minibus       the bus, split into hull, band, glass, tyres and trim, each with two lower levels
#
# Every part keeps the raw model's texture, so a scene can tint a part by multiplying its own
# material colour, and the whole model still reads as the photograph it was made from. The villager
# is about 1.75 m tall, the hatchback about 3.7 m long and the minibus about 4.9 m long. Origins
# stand at the feet or the tyres' base, and every model faces the engine's forward axis: Blender's
# -y, which the glTF export turns into +z. Tripo3D's raw models face +x, so each is turned -90
# degrees about the vertical axis.
#
# The parts are cut by the colour that each face samples from its own texture atlas, checked against
# the face's height. The raw meshes are too fragmented for their loose parts to stand for a part of
# the body or the vehicle: the villager alone is 59 islands.
#
# A skinned mesh cannot take MSFT_lod levels: the engine refuses levels on a mesh with joints. So
# the walking villager has one level, and the standing villager is the lower-detail proxy that a
# scene draws far away.

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
# The parts, in the order that the raw models' texels name them.
VILLAGER_PARTS = ('body', 'hair', 'shirt', 'trousers', 'shoes')
HATCHBACK_PARTS = ('hull', 'glass', 'tyres', 'trim')
MINIBUS_PARTS = ('hull', 'band', 'glass', 'tyres', 'trim')
# The raw files, as the sample-assets manifest records them, so a swapped input fails the build.
RAW_SHA256 = {
    'villager/model.glb': '66477dc89da1baecc482d895d45384c4f190daadc91f7723d59271e9fd4eb7a8',
    'villager-walk/model.glb': 'eab971a7831ce759d49ea1fd2737bb5ac8744a54f11e803b2009788e82ae6591',
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


def part_material(name, texture, roughness=0.8, metallic=0.0):
    """A metal-rough material that draws the part's own region of the model's texture."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = texture
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat.use_backface_culling = True
    return mat


# The look of each part: the raw texture keeps the model's colour, and the finish sets its surfaces.
ROUGHNESS = {
    'body': 0.72, 'hair': 0.62, 'shirt': 0.86, 'trousers': 0.88, 'shoes': 0.7,
    'hull': 0.42, 'band': 0.45, 'glass': 0.12, 'tyres': 0.92, 'trim': 0.62,
}
METALLIC = {'glass': 0.1, 'tyres': 0.0, 'hull': 0.15, 'band': 0.1, 'trim': 0.1}


def assign_parts(object, parts, classify):
    """Adds one material a part to the object and gives each face the one its colour names."""
    me = object.data
    texture = image_of(object)
    colours = face_colours(me, pixels(texture))
    matrix = object.matrix_world
    world = [matrix @ v.co for v in me.vertices]
    low = min(p.z for p in world)
    high = max(p.z for p in world)
    height = high - low
    me.materials.clear()
    slots = {}
    for name in parts:
        made = part_material(
            f'life-{parts.prefix}-{name}', texture, ROUGHNESS.get(name, 0.8), METALLIC.get(name, 0.0))
        slots[name] = len(me.materials)
        me.materials.append(made)
    counts = {name: 0 for name in parts}
    for index, face in enumerate(me.polygons):
        centre = sum((world[v].z for v in face.vertices), 0.0) / len(face.vertices)
        name = classify(colours[index], centre, height)
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
        part = chosen.name.rsplit('-', 1)[-1]
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
        part = object.name.rsplit('-', 1)[-1]
        object.color = (*colours.get(part, (0.8, 0.8, 0.8)), 1.0)
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

    # The walking villager: one skeleton, one clip, a skinned mesh for each part.
    imported = import_glb(os.path.join(raw, 'villager-walk', 'model.glb'))
    imported, removed = remove_helpers(imported)
    mesh_objects = [o for o in imported if o.type == 'MESH']
    if len(mesh_objects) != 1:
        raise SystemExit(f'villager-walk.glb has {len(mesh_objects)} meshes, not one')
    body = mesh_objects[0]
    arm = next(o for o in imported if o.type == 'ARMATURE')
    me = body.data
    low = min(v.co.z for v in me.vertices)
    high = max(v.co.z for v in me.vertices)
    scale = VILLAGER_HEIGHT / (high - low)
    # The rig turns as one: the armature node carries the turn and the scale, so the clip's own
    # keys stay in the rig's frame.
    arm.matrix_world = (
        Matrix.Scale(scale, 4)
        @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
        @ arm.matrix_world
    )
    bpy.context.view_layer.update()
    parts = NamedParts('villager', VILLAGER_PARTS)
    counts = assign_parts(body, parts, lambda rgb, z, height: villager_part(rgb, z, height))
    pieces = split(body, parts)
    near['villager'] = pieces
    everything += list(pieces.values())
    reports.append(report_model('villager', pieces))
    print(f'LIFE villager: height target {VILLAGER_HEIGHT} m, scale {scale:.4f}, '
          f'removed helpers {removed}; faces per part {counts}')

    # The standing villager, for the people drawn far off. Its texture is the same picture, so it
    # shrinks to a quarter of the size, where a distant copy cannot show the difference.
    imported = import_glb(os.path.join(raw, 'villager', 'model.glb'))
    imported, _ = remove_helpers(imported)
    mesh_objects = [o for o in imported if o.type == 'MESH']
    body = mesh_objects[0]
    texture = image_of(body)
    texture.scale(512, 512)
    low = min((body.matrix_world @ v.co).z for v in body.data.vertices)
    high = max((body.matrix_world @ v.co).z for v in body.data.vertices)
    bake(body, -math.pi / 2, VILLAGER_HEIGHT / (high - low), 0.0)
    parts = NamedParts('villager-far', VILLAGER_PARTS)
    counts = assign_parts(body, parts, lambda rgb, z, height: villager_part(rgb, z, height))
    pieces = split(body, parts)
    far_objects = []
    errors = [0.0, 0.0]
    for name, piece in pieces.items():
        far_objects.append(piece)
        for k, share in enumerate(LOD_SHARES, start=1):
            lower, error = lower_level(piece, share, f'{piece.name}-{k}', piece)
            far_objects.append(lower)
            errors[k - 1] = max(errors[k - 1], error)
    near['villager-far'] = pieces
    everything += far_objects
    reports.append(report_model('villager-far', pieces, errors))
    print(f'LIFE villager-far: faces per part {counts}, measured level errors '
          f'{[round(e, 4) for e in errors]}')

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
        counts = assign_parts(body, named, lambda rgb, z, height, classify=classify: classify(rgb, z))
        pieces = split(body, named)
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

    # One error list serves every node with lower levels: the worst measurement across the file.
    levels = [max(r['levels'][k] for r in reports if r['levels']) for k in range(len(LOD_SHARES))]
    path = os.path.join(out, 'life.glb')
    found = export(path, everything + [arm], set(), levels, animations=True)
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
            'tyres': (0.05, 0.05, 0.05), 'trim': (0.55, 0.55, 0.55),
        }
        for model, pieces in near.items():
            objects = list(pieces.values())
            preview(objects, os.path.join(shots, f'{model}.png'), (1.6, -3.6, 1.3), samples=20)
            close_up(objects, os.path.join(shots, f'{model}-close.png'), (1.4, -3.2, 1.0))
            parts_view(objects, os.path.join(shots, f'{model}-parts.png'), colours)


main()
