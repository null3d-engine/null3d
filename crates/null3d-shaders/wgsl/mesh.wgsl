enable draw_index;

// Meshes drawn by instance. The lit pipeline shades like three.js's MeshLambertMaterial, and the
// unlit pipeline like its MeshBasicMaterial. The texcoords pipeline shows each vertex's first
// texture coordinates as red and green, for the engine's own tests of vertex formats.
//
// Vertex attributes take the fixed locations of the engine's vertex formats (drawlist.rs, module
// `vertex`): the position at 0, the normal at 1 and the first texture coordinates at 2. Each
// pipeline reads only the attributes its entry point declares, wherever the mesh's format puts
// them.
//
// On WebGPU each instance brings three rows of its world matrix and its material id as
// instance-rate vertex attributes, after the vertex attributes' locations, never through a storage
// buffer, so the same vertex stage runs in WebGPU's compatibility mode. On WebGL2 (the WEBGL2
// variants) the vertex shader finds its instance in the frame's index list, directly or through a
// cluster of rows, reads the matrix rows from a data texture, and takes the material from its
// draw's record. The DRAW_INDEX variant draws many buckets in one multi-draw call and reads each
// draw's record by `gl_DrawID`; the other variant gets one record per draw.
#import null3d::color
#import null3d::globals::{Frame, Material}
#import null3d::lighting

@group(0) @binding(0) var<uniform> frame: Frame;

#ifdef WEBGL2
/// Materials in the material table, as the core sizes it.
const MAX_MATERIALS: u32 = 1024u;
/// World matrices per row of a data texture are 1 << MATRIX_ROW_SHIFT, three texels each.
const MATRIX_ROW_SHIFT: u32 = 9u;
/// Indices per row of the index list and cluster textures are 1 << INDEX_ROW_SHIFT.
const INDEX_ROW_SHIFT: u32 = 11u;
/// A cluster texture entry that names no row: a place past the end of a batch's last cluster.
const NO_ROW: u32 = 0xffffffffu;
#ifdef DRAW_INDEX
/// Draw records one multi-draw call reads.
const DRAW_RECORDS: u32 = 256u;
#else
const DRAW_RECORDS: u32 = 1u;
#endif

struct MaterialTable {
    items: array<Material, MAX_MATERIALS>,
}

/// One draw each: the start of its slice of the index list, its material, the data texture its
/// instances come from (0 for the resident one, 1 for the streamed one), and its instances per
/// list entry as a shift: 0 when each entry names a row of the data texture, more when each
/// names a cluster of rows, which the cluster texture lists.
struct DrawTable {
    items: array<vec4u, DRAW_RECORDS>,
}

@group(0) @binding(1) var<uniform> materials: MaterialTable;
@group(1) @binding(0) var<uniform> draws: DrawTable;
@group(2) @binding(0) var resident_rows: texture_2d<f32>;
@group(2) @binding(1) var streamed_rows: texture_2d<f32>;
@group(2) @binding(2) var visible: texture_2d<u32>;
@group(2) @binding(3) var cluster_rows: texture_2d<u32>;
#else
@group(0) @binding(1) var<storage, read> materials: array<Material>;

/// The instance's attributes: three rows of its world matrix, then its ids.
struct InstanceIn {
    @location(8) row0: vec4f,
    @location(9) row1: vec4f,
    @location(10) row2: vec4f,
    @location(11) ids: vec4u,
}
#endif

/// The vertex attributes of the lit and unlit pipelines.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) @interpolate(flat, either) material: u32,
}

/// The vertex attributes of the texcoords pipeline.
struct TexCoordsIn {
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
}

struct TexCoordsOut {
    @builtin(position) clip: vec4f,
    @location(0) uv0: vec2f,
}

/// One instance: the rows of its world matrix, its material, and whether it draws at all.
struct Instance {
    row0: vec4f,
    row1: vec4f,
    row2: vec4f,
    material: u32,
    drawn: bool,
}

fn material(id: u32) -> Material {
#ifdef WEBGL2
    return materials.items[id];
#else
    return materials[id];
#endif
}

#ifdef WEBGL2
/// The instance a draw with this record draws as its `instance`-th: the index list gives its
/// source, or the cluster whose rows the cluster texture lists, and the draw's data texture holds
/// the source's matrix rows. The places past the end of a batch's last cluster draw nothing.
fn instance_of(record: vec4u, instance: u32) -> Instance {
    let index_row = (1u << INDEX_ROW_SHIFT) - 1u;
    let shift = record.w;
    let slot = record.x + (instance >> shift);
    var source = textureLoad(visible, vec2u(slot & index_row, slot >> INDEX_ROW_SHIFT), 0).x;
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
        out.row0 = textureLoad(resident_rows, at, 0);
        out.row1 = textureLoad(resident_rows, at + vec2u(1u, 0u), 0);
        out.row2 = textureLoad(resident_rows, at + vec2u(2u, 0u), 0);
    } else {
        out.row0 = textureLoad(streamed_rows, at, 0);
        out.row1 = textureLoad(streamed_rows, at + vec2u(1u, 0u), 0);
        out.row2 = textureLoad(streamed_rows, at + vec2u(2u, 0u), 0);
    }
    out.material = record.y;
    return out;
}
#endif

/// The instance that a vertex shader invocation draws.
fn find_instance(
#ifdef WEBGL2
    instance: u32,
#ifdef DRAW_INDEX
    draw: u32,
#endif
#else
    i: InstanceIn,
#endif
) -> Instance {
#ifdef WEBGL2
#ifdef DRAW_INDEX
    return instance_of(draws.items[draw], instance);
#else
    return instance_of(draws.items[0], instance);
#endif
#else
    return Instance(i.row0, i.row1, i.row2, i.ids.x, true);
#endif
}

/// A position in clip space: the instance's world matrix, then the camera. An instance that draws
/// nothing lands outside the clip volume on every axis, so the whole triangle is clipped away.
fn clip_position(found: Instance, position: vec3f) -> vec4f {
    let p = vec4f(position, 1.0);
    if !found.drawn {
        return vec4f(2.0, 2.0, 2.0, 1.0);
    }
    return frame.view_proj
        * vec4f(dot(found.row0, p), dot(found.row1, p), dot(found.row2, p), 1.0);
}

@vertex
fn vs(
    v: VertexIn,
#ifdef WEBGL2
    @builtin(instance_index) instance: u32,
#else
    i: InstanceIn,
#endif
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
) -> VertexOut {
#ifdef WEBGL2
#ifdef DRAW_INDEX
    let found = find_instance(instance, draw);
#else
    let found = find_instance(instance);
#endif
#else
    let found = find_instance(i);
#endif
    let n = vec4f(v.normal, 0.0);
    var out: VertexOut;
    out.clip = clip_position(found, v.position);
    out.normal = vec3f(dot(found.row0, n), dot(found.row1, n), dot(found.row2, n));
    out.material = found.material;
    return out;
}

@vertex
fn vs_texcoords(
    v: TexCoordsIn,
#ifdef WEBGL2
    @builtin(instance_index) instance: u32,
#else
    i: InstanceIn,
#endif
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
) -> TexCoordsOut {
#ifdef WEBGL2
#ifdef DRAW_INDEX
    let found = find_instance(instance, draw);
#else
    let found = find_instance(instance);
#endif
#else
    let found = find_instance(i);
#endif
    var out: TexCoordsOut;
    out.clip = clip_position(found, v.position);
    out.uv0 = v.uv0;
    return out;
}

@fragment
fn fs_lit(in: VertexOut) -> @location(0) vec4f {
    let albedo = material(in.material).color.rgb;
    let shaded = null3d::lighting::lambert(
        albedo,
        normalize(in.normal),
        -frame.sun_direction.xyz,
        frame.sun_color.rgb,
        frame.ambient.rgb,
    );
    return vec4f(null3d::color::linear_to_srgb(shaded), 1.0);
}

@fragment
fn fs_unlit(in: VertexOut) -> @location(0) vec4f {
    return vec4f(null3d::color::linear_to_srgb(material(in.material).color.rgb), 1.0);
}

/// The first texture coordinates as they are, red for u and green for v, with no color encoding,
/// so a coordinate of 0.5 reads back as 128.
@fragment
fn fs_texcoords(in: TexCoordsOut) -> @location(0) vec4f {
    return vec4f(in.uv0, 0.0, 1.0);
}
