// The camera-relative rows of a feature-instance draw (D-229). A page writes each instance's
// world matrix, and the engine's vertex shaders read an instance matrix relative to the view's
// camera, as the culling shader's compacted rows are. One dispatch converts the rows that the
// count word includes: each of an instance's three matrix rows loses the camera's world position
// from its `w`, which holds the translation on that axis. The ids of the row are copied as they
// are.
//
// Rows at or above the count keep whatever they hold, because the draw reads none of them. The
// dispatch covers the draw's whole capacity, so a count that the add-on's compute wrote late in
// the frame still bounds the work.

/// What the engine writes for a dispatch: the camera's absolute world position in its `xyz`.
struct Block {
    camera: vec4f,
}

/// Vectors of one instance's row: its three matrix rows, then its ids.
const ROW_VECTORS: u32 = 4u;

@group(0) @binding(0) var<uniform> block: Block;
@group(0) @binding(1) var<storage, read> counts: array<u32>;
@group(0) @binding(2) var<storage, read> world_rows: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> relative_rows: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let at = id.x;
    if at >= counts[0] {
        return;
    }
    let base = at * ROW_VECTORS;
    // A matrix row turns a point into the instance's world place, with the translation in `w`.
    for (var k = 0u; k < 3u; k++) {
        let row = world_rows[base + k];
        relative_rows[base + k] = vec4f(row.xyz, row.w - block.camera[k]);
    }
    relative_rows[base + 3u] = world_rows[base + 3u];
}
