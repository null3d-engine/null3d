// The blade list that the grass draws and its near shadows read: one dispatch builds the rows of
// a preset's tufts into the draw's instance buffer and writes the count that the engine copies
// into the main view's indirect entry and every drawn shadow view's. The tuft data comes in a
// texture of its own, so the hill's placement stays the CPU's integer hash and both GPU paths
// place the same tufts.
//
// One workgroup builds the whole list, so it can zero the count and add to it without a race, and
// the loop covers a hill of any size.

struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>;
@group(1) @binding(0) var tufts: texture_2d_array<f32>;

/// The invocations of the pass's one workgroup, which the loop strides by.
const WORKGROUP: u32 = 128u;
/// The vectors of one instance's row: its three matrix rows, then its ids.
const ROW_VECTORS: u32 = 4u;

/// The texel of the tuft data's `index`-th texel, with `columns` texels across.
fn tuft_texel(index: u32, columns: u32) -> vec2i {
    return vec2i(i32(index % columns), i32(index / columns));
}

@compute @workgroup_size(128)
fn main(@builtin(local_invocation_index) lane: u32) {
    // The pass's values: the tufts that the preset draws, the draw material's id and the data
    // texture's width in texels.
    let capacity = u32(block.u0.x);
    let material = u32(block.u0.y);
    let columns = u32(block.u0.z);
    if (lane == 0u) {
        atomicStore(&counts, 0u);
    }
    workgroupBarrier();
    for (var k = lane; k < capacity; k += WORKGROUP) {
        // The first texel holds the place rounded to whole meters and the turn; the second holds
        // the rest of the place, which keeps a half float under a millimetre, and the size.
        let coarse = textureLoad(tufts, tuft_texel(k * 2u, columns), 0, 0);
        let fine = textureLoad(tufts, tuft_texel(k * 2u + 1u, columns), 0, 0);
        let x = coarse.x + fine.x;
        let y = coarse.y + fine.y;
        let z = coarse.z + fine.z;
        let turn = coarse.w;
        let size = fine.w;
        let c = cos(turn);
        let s = sin(turn);
        // A slot that only this lane can take, so the list is one row for each drawn tuft.
        let at = atomicAdd(&counts, 1u) * ROW_VECTORS;
        // The engine's instance row: the world matrix's three rows, with the tuft's turn and size,
        // then the ids. The first id is the material that the vertex shader reads.
        instances[at] = vec4f(c * size, 0.0, s * size, x);
        instances[at + 1u] = vec4f(0.0, size, 0.0, y);
        instances[at + 2u] = vec4f(-s * size, 0.0, c * size, z);
        instances[at + 3u] = vec4f(bitcast<f32>(material), 0.0, 0.0, 0.0);
    }
}
