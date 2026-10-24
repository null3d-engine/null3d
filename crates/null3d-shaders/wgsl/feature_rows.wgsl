// The rows of a feature-instance draw, as the page or an add-on's compute wrote them, made
// relative to the camera. Every instance buffer that the engine's vertex shaders read holds rows
// in that space: the culling adds the offset from the camera to an object's world matrix. A page
// writes world matrices, so the frame converts them here, once for each draw, after every compute
// pass that writes rows and before every pass that reads them.
//
// Group 0 binds the values this pass reads: the camera's world position, the draw's count word and
// its rows. The bindings are the ones an add-on's compute pass binds to fill the same two buffers,
// so the frame can make one group for both passes.

struct Values {
    /// The camera's position in the world, absolute: the first three floats.
    camera: vec4f,
}

@group(0) @binding(0) var<uniform> values: Values;
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> rows: array<vec4f>;

/// One invocation for each instance that the draw holds: three world-matrix rows, then its ids.
const ROW_WORDS: u32 = 4u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    // The dispatch covers the draw's capacity, and only the rows the GPU counts are live.
    let live = atomicLoad(&counts);
    if (id.x >= live) {
        return;
    }
    let camera = values.camera.xyz;
    let at = id.x * ROW_WORDS;
    rows[at].w -= camera.x;
    rows[at + 1u].w -= camera.y;
    rows[at + 2u].w -= camera.z;
}
