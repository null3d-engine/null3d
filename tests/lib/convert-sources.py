# Makes the FBX and OBJ test files of `assets convert` with Blender, in the folder given after
# `--`: a column of 5 rings with a textured side and a red metal top. In the FBX file, two bones
# skin it, a clip bends its upper half by 45 degrees over one second, and a shape key widens its
# middle ring as the same clip runs. Run it with
# /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tests/lib/convert-sources.py -- <folder>
import math
import os
import sys

import bpy

folder = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
os.makedirs(folder, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 25

# A checker of two colors, 32 x 32 pixels in squares of 8.
size = 32
image = bpy.data.images.new("checker", size, size, alpha=False)
pixels = []
for y in range(size):
    for x in range(size):
        a = ((x // 8) + (y // 8)) % 2 == 0
        pixels += [0.9, 0.45, 0.1, 1.0] if a else [0.1, 0.6, 0.65, 1.0]
image.pixels = pixels
image.filepath_raw = os.path.join(folder, "checker.png")
image.file_format = "PNG"
image.save()

# Five square rings from z = 0 to z = 2, half a unit apart, joined by quads, and a top cap.
corners = [(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)]
verts = [(x, y, 0.5 * ring) for ring in range(5) for (x, y) in corners]
faces = []
for ring in range(4):
    for side in range(4):
        a = ring * 4 + side
        b = ring * 4 + (side + 1) % 4
        faces.append((a, b, b + 4, a + 4))
faces.append((16, 17, 18, 19))
mesh = bpy.data.meshes.new("Column")
mesh.from_pydata(verts, [], faces)
mesh.update()

uv = mesh.uv_layers.new(name="UVMap")
for poly in mesh.polygons:
    for k, loop in enumerate(poly.loop_indices):
        vertex = mesh.vertices[mesh.loops[loop].vertex_index].co
        if poly.index < 16:
            side = poly.index % 4
            u = (side + (1 if k in (1, 2) else 0)) / 4
            uv.data[loop].uv = (u, vertex.z / 2)
        else:
            uv.data[loop].uv = (vertex.x + 0.5, vertex.y + 0.5)

body = bpy.data.materials.new("Body")
body.use_nodes = True
bsdf = body.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.8
texture = body.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = image
body.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])

cap = bpy.data.materials.new("Cap")
cap.use_nodes = True
bsdf = cap.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.8, 0.05, 0.05, 1.0)
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.3

mesh.materials.append(body)
mesh.materials.append(cap)
mesh.polygons[16].material_index = 1

column = bpy.data.objects.new("Column", mesh)
scene.collection.objects.link(column)

bpy.ops.object.select_all(action="DESELECT")
column.select_set(True)
bpy.context.view_layer.objects.active = column
bpy.ops.wm.obj_export(
    filepath=os.path.join(folder, "column.obj"),
    export_selected_objects=True,
    export_materials=True,
    path_mode="STRIP",
    export_animation=False,
)

# The skeleton: a lower bone from z = 0 to 1 and an upper one from 1 to 2.
armature_data = bpy.data.armatures.new("Skeleton")
armature = bpy.data.objects.new("Skeleton", armature_data)
scene.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode="EDIT")
lower = armature_data.edit_bones.new("Lower")
lower.head, lower.tail = (0, 0, 0), (0, 0, 1)
upper = armature_data.edit_bones.new("Upper")
upper.head, upper.tail = (0, 0, 1), (0, 0, 2)
upper.parent = lower
bpy.ops.object.mode_set(mode="OBJECT")

column.parent = armature
modifier = column.modifiers.new("Skeleton", "ARMATURE")
modifier.object = armature
groups = {name: column.vertex_groups.new(name=name) for name in ("Lower", "Upper")}
for vertex in mesh.vertices:
    weight = min(1.0, max(0.0, 1.0 - (vertex.co.z - 0.5)))
    if weight > 0:
        groups["Lower"].add([vertex.index], weight, "REPLACE")
    if weight < 1:
        groups["Upper"].add([vertex.index], 1.0 - weight, "REPLACE")

# The shape key pushes the middle ring out by half.
column.shape_key_add(name="Basis")
bulge = column.shape_key_add(name="Bulge")
for vertex in mesh.vertices:
    if abs(vertex.co.z - 1.0) < 1e-6:
        bulge.data[vertex.index].co = (vertex.co.x * 1.5, vertex.co.y * 1.5, vertex.co.z)
bulge.value = 0.0
bulge.keyframe_insert("value", frame=1)
bulge.value = 1.0
bulge.keyframe_insert("value", frame=25)

pose = armature.pose.bones["Upper"]
pose.rotation_mode = "QUATERNION"
pose.rotation_quaternion = (1, 0, 0, 0)
pose.keyframe_insert("rotation_quaternion", frame=1)
pose.rotation_quaternion = (math.cos(math.pi / 8), math.sin(math.pi / 8), 0, 0)
pose.keyframe_insert("rotation_quaternion", frame=25)
armature.animation_data.action.name = "Bend"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(
    filepath=os.path.join(folder, "column.fbx"),
    use_selection=False,
    path_mode="COPY",
    embed_textures=True,
    add_leaf_bones=False,
    bake_anim=True,
    bake_anim_use_all_actions=False,
    bake_anim_use_nla_strips=False,
    bake_anim_simplify_factor=0.0,
)
