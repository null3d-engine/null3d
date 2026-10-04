enable draw_index;
#define_import_path null3d::mesh
#import null3d::color::{linear_to_srgb, srgb_to_linear}
#import null3d::fog::{apply_fog, fog_factor}
#import null3d::globals::{Frame, Material}
#import null3d::tonemap
#import null3d::vertex::{OUTSIDE_CLIP, Transform, to_clip, transform_direction}
#import null3d::vertex::{transform_normal, transform_point}

// What every template for meshes drawn by instance shares: the frame's bindings, where each
// instance's world matrix and material come from, and positions in clip space. A template's vertex
// entry point takes an `InstanceIn` beside its vertex attributes, and `find_instance` turns it into
// the instance's matrix rows and material.
//
// The frame's bindings include the material table, one row per material. A row holds the texture
// array layer of each of the material's maps. A map whose image is not on the GPU yet has no layer.
// On WebGPU the table is a storage buffer that fragment shaders read. On WebGL2 it is a data
// texture with one row of texels per material, as a uniform block of 1,024 rows would pass the
// 16 KiB that every WebGL2 device allows.
//
// Vertex attributes take the fixed locations of the engine's vertex formats (drawlist.rs, module
// `vertex`): the position at 0, the normal at 1 and the first texture coordinates at 2. Each
// pipeline reads only the attributes that its template's vertex entry point declares, wherever the
// mesh's format puts them.
//
// Positions are relative to the camera: the frame's view-projection matrix puts the camera at the
// origin, and each instance's world matrix is moved by the offset from the camera to its grid cell.
//
// On WebGPU each instance brings three rows of its world matrix and its material id as
// instance-rate vertex attributes, after the vertex attributes' locations, never through a storage
// buffer, so the same vertex stage runs in WebGPU's compatibility mode. The culling shader has
// already moved each matrix by its cell's offset. On WebGL2 (the WEBGL2 builds) the vertex shader
// finds its instance in the frame's index list, directly or through a cluster of rows, reads the
// matrix rows from a data texture, and adds the offset of the cell that the list entry names. It
// takes the material from its draw's record. The DRAW_INDEX builds draw many buckets in one
// multi-draw call and read each draw's record by `gl_DrawID`; the other builds get one record per
// draw.
//
// The SKIN builds skin each vertex in the vertex shader: `skin_of` blends the skinning matrices of
// the vertex's four joints by their weights, from the joint texture, which holds each animated
// instance's matrices, three texels per joint and JOINTS_PER_ROW joints per row. On WebGPU each
// instance brings the first joint of its skin beside its material, and the texture is the bind
// group after the maps' in the builds that sample maps (JOINTS_AFTER_MAPS), and the group after the
// frame's in the others. On WebGL2 the texture follows the data textures in their group, and a
// texture of indices beside it gives each source row its first joint, laid out as the index list is.
//
// The MORPH builds, which only WebGL2 has, add each vertex's morph target deltas times their
// weights before skinning (`morph_vertex`). The vertex's morph attribute names its entries in the
// texture of deltas, which follows the joint texture in the data textures' group, beside the
// texture of weights. The second half of the rows of the texture of indices gives each source row
// the first texel of its morph weights. WebGPU morphs in its skinning pass instead.
//
// The fragment shaders write linear color into the HDR scene color, which the final pass tone maps.
// On the 8-bit path (the TONE_MAP builds) `finish` applies the frame's exposure and tone mapping,
// and encodes sRGB, into a target that resolves straight into the canvas.

@group(0) @binding(0) var<uniform> frame: Frame;

#ifdef WEBGL2
/// World matrices per row of a data texture are 1 << MATRIX_ROW_SHIFT, three texels each.
const MATRIX_ROW_SHIFT: u32 = 9u;
/// Indices per row of the index list and cluster textures are 1 << INDEX_ROW_SHIFT.
const INDEX_ROW_SHIFT: u32 = 11u;
/// A cluster texture entry that names no row: a place past the end of a batch's last cluster.
const NO_ROW: u32 = 0xffffffffu;
/// An index list entry holds its row, or its cluster, in the bits below CELL_SHIFT, and the index
/// of the row's grid cell above them.
const CELL_SHIFT: u32 = 23u;
/// Grid cells in use at most: the length of the table of offsets from the camera to each cell.
const MAX_CELLS: u32 = 512u;
#ifdef DRAW_INDEX
/// Draw records one multi-draw call reads.
const DRAW_RECORDS: u32 = 256u;
#else
const DRAW_RECORDS: u32 = 1u;
#endif

/// One draw each: the start of its slice of the index list, its material, the data texture its
/// instances come from (0 for the resident one, 1 for the streamed one), and its instances per
/// list entry as a shift: 0 when each entry names a row of the data texture, more when each
/// names a cluster of rows, which the cluster texture lists.
struct DrawTable {
    items: array<vec4u, DRAW_RECORDS>,
}

/// The offset from the camera to the center of each grid cell, by cell index.
struct CellOffsets {
    items: array<vec4f, MAX_CELLS>,
}

/// The material table: row `id` holds material `id`, one texel per `vec4f` of its `Material`.
@group(0) @binding(1) var materials: texture_2d<f32>;
@group(0) @binding(2) var<uniform> cell_offsets: CellOffsets;
@group(1) @binding(0) var<uniform> draws: DrawTable;
@group(2) @binding(0) var resident_rows: texture_2d<f32>;
@group(2) @binding(1) var streamed_rows: texture_2d<f32>;
@group(2) @binding(2) var visible: texture_2d<u32>;
@group(2) @binding(3) var cluster_rows: texture_2d<u32>;
#ifdef SKIN
/// The first joint of the instance that skins each source row, then the first texel of the morph
/// weights of each source row.
@group(2) @binding(5) var first_joints: texture_2d<u32>;
#else ifdef MORPH
@group(2) @binding(5) var first_joints: texture_2d<u32>;
#endif
#ifdef MORPH
/// Every morphed mesh's deltas, in half floats.
@group(2) @binding(6) var morph_texels: texture_2d<f32>;
/// Every morphed object's weights.
@group(2) @binding(7) var morph_weights: texture_2d<f32>;
#endif
#else
@group(0) @binding(1) var<storage, read> materials: array<Material>;
/// The materials' custom values: row `id` holds material `id`'s, one texel per `vec4f`. Vertex
/// shaders read them too, and read no storage buffers, so they have a data texture of their own.
@group(0) @binding(2) var custom_values: texture_2d<f32>;
#endif

/// What a vertex shader invocation learns of its instance. On WebGPU: the three rows of the
/// instance's world matrix that give x, y and z, then its ids. On WebGL2: the instance's number in its draw, and with
/// DRAW_INDEX, the draw's number in its multi-draw call.
struct InstanceIn {
#ifdef WEBGL2
    @builtin(instance_index) instance: u32,
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
#else
    @location(9) row_x: vec4f,
    @location(10) row_y: vec4f,
    @location(11) row_z: vec4f,
    @location(12) ids: vec4u,
#endif
}

/// One instance: the rows of its world matrix that give x, y and z, its material, the first joint
/// of its skin in the joint texture, the first texel of its morph weights in the morph texture,
/// and whether it draws at all. (Library modules keep names that
/// end in a digit out of their structs, because the shader composer cannot keep them.)
struct Instance {
    row_x: vec4f,
    row_y: vec4f,
    row_z: vec4f,
    material: u32,
    first_joint: u32,
    morph_weights: u32,
    drawn: bool,
}

/// A material's parameters, by its id in the material table. (A shader that imports it by name
/// cannot also read a field called `material`, since the composer reads that name as this
/// function.)
fn material_of(id: u32) -> Material {
#ifdef WEBGL2
    var m: Material;
    m.color = textureLoad(materials, vec2u(0u, id), 0);
    m.emissive = textureLoad(materials, vec2u(1u, id), 0);
    m.surface = textureLoad(materials, vec2u(2u, id), 0);
    m.strengths = textureLoad(materials, vec2u(3u, id), 0);
    m.uv_u = textureLoad(materials, vec2u(4u, id), 0);
    m.uv_v = textureLoad(materials, vec2u(5u, id), 0);
    m.maps = textureLoad(materials, vec2u(6u, id), 0);
    m.more_maps = textureLoad(materials, vec2u(7u, id), 0);
    return m;
#else
    return materials[id];
#endif
}

/// Value `k` of a material's custom values: the `k`-th `vec4f` of its row of custom values, which
/// holds a custom material's uniforms. Vertex and fragment shaders can both read it. On WebGL2 the
/// material table's data texture holds a row of custom values for each material after every
/// material's row, so it has twice as many rows as materials.
fn custom_value(id: u32, k: u32) -> vec4f {
#ifdef WEBGL2
    return textureLoad(materials, vec2u(k, textureDimensions(materials).y / 2u + id), 0);
#else
    return textureLoad(custom_values, vec2u(k, id), 0);
#endif
}

/// The bit of a material's flags that keeps the scene's fog off its color.
const NO_FOG: u32 = 4u;

/// Linear color `c` of a fragment at `relative`, its position relative to the camera, seen through
/// the scene's fog. A material with fog off keeps its color.
fn fogged(c: vec3f, relative: vec3f, m: Material) -> vec3f {
    let fog_on = (u32(m.strengths.z) & NO_FOG) == 0u;
    return apply_fog(c, frame.fog.color.xyz, select(0.0, fog_factor(frame.fog, relative), fog_on));
}

/// True when a map's layer, as a material's row holds it, draws: its image is on the GPU.
fn map_ready(layer: f32) -> bool {
    return layer >= 0.0;
}

/// The texture array layer to sample for a map's layer as a row holds it: the layer, or 0 for a
/// map that draws nothing, which the caller then ignores.
fn map_layer(layer: f32) -> u32 {
    return u32(max(layer, 0.0));
}

/// The bit of a material's flags that makes its fragments write premultiplied color, for the
/// transparent pass's blending.
const BLEND_FLAG: u32 = 2u;
/// The bit of a material's flags that says its base color map holds premultiplied colors.
const MAP_PREMULTIPLIED_FLAG: u32 = 8u;
/// The bit of a material's flags that says a premultiplied base color map holds linear colors.
const MAP_LINEAR_FLAG: u32 = 16u;

/// A texel of a blended material's base color map with straight colors. A premultiplied sRGB
/// map's image had its colors multiplied by their alpha while encoded, before sampling decoded
/// them, so this divides the encoded colors by the alpha again; a linear map's colors divide as
/// they are. The map then lights, fogs, tone maps and blends as the same image with straight
/// colors does, on both output paths. A material that does not blend shows a premultiplied map's
/// colors as they are, as three.js does. A texel with no alpha stays as it is.
fn straight_texel(m: Material, texel: vec4f) -> vec4f {
    let flags = u32(m.strengths.z);
    let blended_map = MAP_PREMULTIPLIED_FLAG | BLEND_FLAG;
    if (flags & blended_map) != blended_map || texel.a <= 0.0 {
        return texel;
    }
    if (flags & MAP_LINEAR_FLAG) != 0u {
        return vec4f(min(texel.rgb / texel.a, vec3f(1.0)), texel.a);
    }
    let encoded = min(linear_to_srgb(texel.rgb) / texel.a, vec3f(1.0));
    return vec4f(srgb_to_linear(encoded), texel.a);
}

/// What a mesh's fragment writes, from its color in the target's encoding and its alpha. A
/// material that blends writes the color times the alpha, beside the alpha, as premultiplied
/// blending reads them. Other materials write the color with an alpha of 1.
fn fragment_color(m: Material, color: vec3f, alpha: f32) -> vec4f {
    let blended = (u32(m.strengths.z) & BLEND_FLAG) != 0u;
    return select(vec4f(color, 1.0), vec4f(color * alpha, alpha), blended);
}

#ifdef WEBGL2
/// The instance a draw with this record draws as its `instance`-th: the index list gives its
/// source, or the cluster whose rows the cluster texture lists, and its cell. The draw's data
/// texture holds the source's matrix rows, relative to the cell's center, which the cell's offset
/// moves to the camera. The places past the end of a batch's last cluster draw nothing.
fn instance_of(record: vec4u, instance: u32) -> Instance {
    let index_row = (1u << INDEX_ROW_SHIFT) - 1u;
    let shift = record.w;
    let slot = record.x + (instance >> shift);
    let entry = textureLoad(visible, vec2u(slot & index_row, slot >> INDEX_ROW_SHIFT), 0).x;
    var source = entry & ((1u << CELL_SHIFT) - 1u);
    if shift != 0u {
        let place = (source << shift) | (instance & ((1u << shift) - 1u));
        source = textureLoad(cluster_rows, vec2u(place & index_row, place >> INDEX_ROW_SHIFT), 0).x;
    }
    var out: Instance;
    out.drawn = source != NO_ROW;
    let row = select(0u, source, out.drawn);
    let matrix_row = (1u << MATRIX_ROW_SHIFT) - 1u;
    let at = vec2u((row & matrix_row) * 3u, row >> MATRIX_ROW_SHIFT);
    if record.z == 0u {
        out.row_x = textureLoad(resident_rows, at, 0);
        out.row_y = textureLoad(resident_rows, at + vec2u(1u, 0u), 0);
        out.row_z = textureLoad(resident_rows, at + vec2u(2u, 0u), 0);
    } else {
        out.row_x = textureLoad(streamed_rows, at, 0);
        out.row_y = textureLoad(streamed_rows, at + vec2u(1u, 0u), 0);
        out.row_z = textureLoad(streamed_rows, at + vec2u(2u, 0u), 0);
    }
    let offset = cell_offsets.items[entry >> CELL_SHIFT];
    out.row_x.w += offset.x;
    out.row_y.w += offset.y;
    out.row_z.w += offset.z;
    out.material = record.y;
#ifdef SKIN
    out.first_joint = textureLoad(first_joints, vec2u(row & index_row, row >> INDEX_ROW_SHIFT), 0).x;
#else
    out.first_joint = 0u;
#endif
#ifdef MORPH
    let half = textureDimensions(first_joints).y / 2u;
    let weights_at = vec2u(row & index_row, half + (row >> INDEX_ROW_SHIFT));
    out.morph_weights = textureLoad(first_joints, weights_at, 0).x;
#else
    out.morph_weights = 0u;
#endif
    return out;
}
#endif

/// The instance that a vertex shader invocation draws.
fn find_instance(i: InstanceIn) -> Instance {
#ifdef WEBGL2
#ifdef DRAW_INDEX
    return instance_of(draws.items[i.draw], i.instance);
#else
    return instance_of(draws.items[0], i.instance);
#endif
#else
    return Instance(i.row_x, i.row_y, i.row_z, i.ids.x, i.ids.y, 0u, true);
#endif
}

/// The instance's world matrix, relative to the camera.
fn transform_of(found: Instance) -> Transform {
    return Transform(found.row_x, found.row_y, found.row_z);
}

/// A position in clip space: the instance's world matrix, then the camera. An instance that draws
/// nothing lands outside the clip volume on every axis, so the whole triangle is clipped away.
fn clip_position(found: Instance, position: vec3f) -> vec4f {
    return clip_of(found, relative_position(found, position));
}

/// A position relative to the camera in clip space, for the instance that it belongs to, as
/// `clip_position` gives it.
fn clip_of(found: Instance, relative: vec3f) -> vec4f {
    if !found.drawn {
        return OUTSIDE_CLIP;
    }
    return to_clip(frame.view_proj, relative);
}

/// A position from the mesh into the world, relative to the camera.
fn relative_position(found: Instance, position: vec3f) -> vec3f {
    return transform_point(transform_of(found), position);
}

/// A unit normal from the mesh into the world, turned as three.js's normal matrix turns it, so it
/// stays at right angles to its surface under uneven scale.
fn world_normal(found: Instance, normal: vec3f) -> vec3f {
    return transform_normal(transform_of(found), normal);
}

/// The color a fragment writes for linear color `c` at framebuffer position `pixel`: `c` itself for
/// the final pass, or on the 8-bit path, `c` tone mapped and encoded for the canvas.
fn finish(c: vec3f, pixel: vec2f) -> vec4f {
    return null3d::tonemap::finish(c, pixel, frame.output);
}

/// A direction from the mesh into the world: the instance's world matrix without its translation.
fn world_direction(found: Instance, direction: vec3f) -> vec3f {
    return transform_direction(transform_of(found), direction);
}

#ifdef SKIN
/// Joints per row of the joint texture.
const JOINTS_PER_ROW: u32 = 1024u;

#ifdef WEBGL2
@group(2) @binding(4) var joint_matrices: texture_2d<f32>;
#else ifdef JOINTS_AFTER_MAPS
@group(2) @binding(0) var joint_matrices: texture_2d<f32>;
#else
@group(1) @binding(0) var joint_matrices: texture_2d<f32>;
#endif

/// A vertex's skinning matrix: the rows that give x, y and z.
struct Skin {
    row_x: vec4f,
    row_y: vec4f,
    row_z: vec4f,
}

/// Row `row` of joint `joint`'s skinning matrix.
fn joint_row(joint: u32, row: u32) -> vec4f {
    let x = (joint % JOINTS_PER_ROW) * 3u + row;
    return textureLoad(joint_matrices, vec2u(x, joint / JOINTS_PER_ROW), 0);
}

/// The skinning matrix of a vertex of the instance's mesh: its joints' matrices, each times its
/// weight, added up. The weights are used as they are, as three.js uses them. A joint without
/// weight is not read, as the skinning pass skips it, so it may name any joint.
fn skin_of(found: Instance, joints: vec4u, weights: vec4f) -> Skin {
    var s = Skin(vec4f(0.0), vec4f(0.0), vec4f(0.0));
    for (var k = 0u; k < 4u; k++) {
        let w = weights[k];
        if w == 0.0 {
            continue;
        }
        let joint = found.first_joint + joints[k];
        s.row_x += w * joint_row(joint, 0u);
        s.row_y += w * joint_row(joint, 1u);
        s.row_z += w * joint_row(joint, 2u);
    }
    return s;
}

/// A position of the mesh in its skeleton's space, skinned.
fn skinned_point(s: Skin, p: vec3f) -> vec3f {
    let h = vec4f(p, 1.0);
    return vec3f(dot(s.row_x, h), dot(s.row_y, h), dot(s.row_z, h));
}

/// A direction of the mesh, such as a normal or a tangent, turned by the skinning matrix without
/// its translation, as three.js turns it.
fn skinned_direction(s: Skin, d: vec3f) -> vec3f {
    return vec3f(dot(s.row_x.xyz, d), dot(s.row_y.xyz, d), dot(s.row_z.xyz, d));
}
#endif

#ifdef MORPH
/// Texels per row of the morph texture.
const MORPH_TEXELS_PER_ROW: u32 = 2048u;

/// A vertex of the mesh before skinning: its position, normal and tangent direction.
struct Morphed {
    position: vec3f,
    normal: vec3f,
    tangent: vec3f,
}

/// Texel `k` of the texture of deltas.
fn morph_texel(k: u32) -> vec4f {
    return textureLoad(morph_texels, vec2u(k % MORPH_TEXELS_PER_ROW, k / MORPH_TEXELS_PER_ROW), 0);
}

/// Texel `k` of the texture of weights.
fn morph_weight_texel(k: u32) -> vec4f {
    return textureLoad(morph_weights, vec2u(k % MORPH_TEXELS_PER_ROW, k / MORPH_TEXELS_PER_ROW), 0);
}

/// A vertex moved by its morph targets, as three.js moves it: each entry that the vertex's morph
/// attribute `range` names adds its deltas times its target's weight, from the instance's weights.
/// The attribute holds the first entry's texel, then the entry count times four plus 1 when the
/// entries hold a normal's delta and 2 when they hold a tangent's. The skinning pass on WebGPU
/// morphs the same way.
fn morph_vertex(found: Instance, range: vec2f, rest: Morphed) -> Morphed {
    var out = rest;
    let first = u32(range.x);
    let word = u32(range.y);
    let stride = 1u + (word & 1u) + ((word >> 1u) & 1u);
    let count = word >> 2u;
    for (var k = 0u; k < count; k++) {
        let at = first + k * stride;
        let entry = morph_texel(at);
        let t = u32(entry.w);
        let w = morph_weight_texel(found.morph_weights + t / 4u)[t % 4u];
        if w == 0.0 {
            continue;
        }
        out.position += w * entry.xyz;
        var next = at + 1u;
        if (word & 1u) != 0u {
            out.normal += w * morph_texel(next).xyz;
            next += 1u;
        }
        if (word & 2u) != 0u {
            out.tangent += w * morph_texel(next).xyz;
        }
    }
    return out;
}
#endif
