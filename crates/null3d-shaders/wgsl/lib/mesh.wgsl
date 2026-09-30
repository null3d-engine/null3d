enable draw_index;
#define_import_path null3d::mesh
#import null3d::globals::{Frame, Material}
#import null3d::tonemap
#import null3d::vertex::{OUTSIDE_CLIP, Transform, to_clip, transform_direction, transform_point}

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
#else
@group(0) @binding(1) var<storage, read> materials: array<Material>;
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
    @location(8) row_x: vec4f,
    @location(9) row_y: vec4f,
    @location(10) row_z: vec4f,
    @location(11) ids: vec4u,
#endif
}

/// One instance: the rows of its world matrix that give x, y and z, its material, and whether it
/// draws at all. (Library modules keep names that end in a digit out of their structs, because the
/// shader composer cannot keep them.)
struct Instance {
    row_x: vec4f,
    row_y: vec4f,
    row_z: vec4f,
    material: u32,
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

/// True when a map's layer, as a material's row holds it, draws: its image is on the GPU.
fn map_ready(layer: f32) -> bool {
    return layer >= 0.0;
}

/// The texture array layer to sample for a map's layer as a row holds it: the layer, or 0 for a
/// map that draws nothing, which the caller then ignores.
fn map_layer(layer: f32) -> u32 {
    return u32(max(layer, 0.0));
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
    return Instance(i.row_x, i.row_y, i.row_z, i.ids.x, true);
#endif
}

/// The instance's world matrix, relative to the camera.
fn transform_of(found: Instance) -> Transform {
    return Transform(found.row_x, found.row_y, found.row_z);
}

/// A position in clip space: the instance's world matrix, then the camera. An instance that draws
/// nothing lands outside the clip volume on every axis, so the whole triangle is clipped away.
fn clip_position(found: Instance, position: vec3f) -> vec4f {
    if !found.drawn {
        return OUTSIDE_CLIP;
    }
    return to_clip(frame.view_proj, transform_point(transform_of(found), position));
}

/// A direction from the mesh into the world: the instance's world matrix without its translation.
fn world_direction(found: Instance, direction: vec3f) -> vec3f {
    return transform_direction(transform_of(found), direction);
}

/// The color a fragment writes for linear color `c` at framebuffer position `pixel`: `c` itself for
/// the final pass, or on the 8-bit path, `c` tone mapped and encoded for the canvas.
fn finish(c: vec3f, pixel: vec2f) -> vec4f {
    return null3d::tonemap::finish(c, pixel, frame.output);
}
