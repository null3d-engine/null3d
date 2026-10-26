// The depth reduction behind the light clusters' fitted slices: a clear and a dispatch per camera
// view, after its opaque pass. Each thread samples one texel of the view's depth for each block of
// Block x Block texels, and its workgroup keeps the largest and the smallest positive value it
// saw. One thread of each workgroup then raises the largest and lowers the smallest into the
// reduction, which the next frame's fit reads. Reversed depth is 1 at the near plane and 0 at the
// far plane, so the largest value is the nearest surface. A background texel is 0 and stays out of
// the smallest, which is then the farthest surface.
//
// The depth binds as a float texture: one sample per pixel, or a multisampled target of which this
// reads sample 0. Compatibility mode reads no depth texture type with `textureLoad`, so the binding
// is a plain float texture on every path.
//
// Its group binds the reduction that the light clusters' fit reads, two words: the nearest depth
// and the farthest, as float bits. The clear dispatch zeroes them before the reduction fills them.

/// Threads per workgroup, each one block.
const WORKGROUP_SIZE: u32 = 64u;
/// The texels each way that one thread's block holds.
const BLOCK: u32 = 4u;

struct FitParams {
    /// The depth's blocks across and up in texels, then zero.
    blocks: vec4u,
}

@group(0) @binding(0) var<uniform> params: FitParams;
/// The reduction that this frame fills: the nearest depth in word 0 and the farthest in word 1, as
/// float bits.
@group(0) @binding(1) var<storage, read_write> reduction: array<atomic<u32>>;
#ifdef MULTISAMPLED
@group(0) @binding(2) var depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(2) var depth: texture_2d<f32>;
#endif

/// The workgroup's largest and smallest positive depth, as float bits.
var<workgroup> nearest: atomic<u32>;
var<workgroup> farthest: atomic<u32>;

/// The reversed depth of `texel`, from the first sample of a multisampled target.
fn depth_at(texel: vec2u) -> f32 {
    return textureLoad(depth, texel, 0).x;
}

/// Clears the reduction before this frame fills it. One workgroup of one thread, first in the pass.
/// The frame's fit has already read the value the last frame left.
@compute @workgroup_size(1)
fn clear_reduction() {
    atomicStore(&reduction[0], 0u);
    atomicStore(&reduction[1], 0xffffffffu);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn reduce_depth(
    @builtin(global_invocation_id) id: vec3u,
    @builtin(local_invocation_index) local: u32,
) {
    if local == 0u {
        atomicStore(&nearest, 0u);
        atomicStore(&farthest, 0xffffffffu);
    }
    workgroupBarrier();
    let block = id.xy;
    if all(block < params.blocks.xy) {
        let value = depth_at(block * BLOCK);
        // Reversed depth: 0 is the background, and a positive value orders as its bits do.
        if value > 0.0 {
            let bits = bitcast<u32>(value);
            atomicMax(&nearest, bits);
            atomicMin(&farthest, bits);
        }
    }
    workgroupBarrier();
    if local == 0u {
        let found_nearest = atomicLoad(&nearest);
        if found_nearest > 0u {
            atomicMax(&reduction[0], found_nearest);
        }
        let found_farthest = atomicLoad(&farthest);
        if found_farthest != 0xffffffffu {
            atomicMin(&reduction[1], found_farthest);
        }
    }
}
