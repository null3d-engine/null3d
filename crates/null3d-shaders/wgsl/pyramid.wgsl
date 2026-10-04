// The depth pyramid of two-phase occlusion culling (see cull.wgsl). Each level holds, for each
// texel, the farthest depth of the 2 x 2 texels under it in the level below: level 0 reads the
// view's occluder depth, and each later level the level before it. A level is half the level below
// it each way, rounded up, so its last row or column reads the edge texel twice where the level
// below is odd. Depth is reversed, so the farthest depth is the smallest value. The pyramid lives
// in one storage buffer, level after level, after a first word that counts the frame's occluders,
// because bind groups bind whole textures and every level reads the one before it. In a frame
// without occluders, every workgroup returns at once, and the occlusion test hides nothing.
//
// One dispatch builds a batch of up to four levels. Each workgroup builds a tile of 8 x 8 texels of
// the batch's first level, one per thread, from the level below in the pyramid or from the depth
// target, and keeps the tile in workgroup memory. It then builds the tile's 4 x 4, 2 x 2 and 1 x 1
// texels of the next three levels from it. The last of those is all that the next batch reads,
// from the pyramid. Batches keep the GPU from waiting on many small dispatches in turn.
// Each dispatch binds its batch's parameters at a dynamic offset of its own.
//
// The batch that starts at level 0 reads the depth target as a float texture, which compatibility
// mode allows where it forbids depth textures in `textureLoad`, multisampled ones too. The
// DEPTH_MULTISAMPLED build reads a multisampled depth target, and keeps the farthest of each
// texel's samples.

/// Levels that one dispatch builds at most.
const LEVELS_PER_BATCH: u32 = 4u;
/// Texels of a tile of the batch's first level, each way: one per thread.
const TILE: u32 = 8u;

/// What a dispatch reads and builds: the level below its first level, as its width and height in
/// texels, where it starts in the pyramid and 1 when it is the depth target, then each level that
/// it builds, as its width and height and where it starts, with a width of 0 past the pyramid's
/// last level.
struct Batch {
    source: vec4u,
    levels: array<vec4u, LEVELS_PER_BATCH>,
}

@group(0) @binding(0) var<uniform> batch: Batch;
@group(0) @binding(1) var<storage, read_write> pyramid: array<f32>;
#ifdef DEPTH_MULTISAMPLED
@group(0) @binding(2) var depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(2) var depth: texture_2d<f32>;
#endif

/// The workgroup's tile of the level it builds, rows of the tile's width.
var<workgroup> tile: array<f32, 64>;
/// The frame's occluders, as the pyramid's first word counts them.
var<workgroup> occluders: u32;

/// Samples of each texel of a multisampled depth target.
const SAMPLES: i32 = 4;

/// The depth target's farthest depth at a texel.
fn depth_at(texel: vec2u) -> f32 {
#ifdef DEPTH_MULTISAMPLED
    var far = textureLoad(depth, texel, 0).x;
    for (var s = 1; s < SAMPLES; s++) {
        far = min(far, textureLoad(depth, texel, s).x);
    }
    return far;
#else
    return textureLoad(depth, texel, 0).x;
#endif
}

/// The value of the level below the batch at a texel: the depth target's, or the pyramid's.
fn source_at(texel: vec2u) -> f32 {
    if batch.source.w != 0u {
        return depth_at(texel);
    }
    return pyramid[batch.source.z + texel.y * batch.source.x + texel.x];
}

/// Writes a texel of a level into the pyramid, unless it lies past the level's edge.
fn store(shape: vec4u, texel: vec2u, far: f32) {
    if texel.x < shape.x && texel.y < shape.y {
        pyramid[shape.z + texel.y * shape.x + texel.x] = far;
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
    if all(local.xy == vec2u(0u)) {
        occluders = bitcast<u32>(pyramid[0]);
    }
    if workgroupUniformLoad(&occluders) == 0u {
        return;
    }
    // The batch's first level: each thread builds one texel of the tile.
    let first = batch.levels[0];
    let source_last = batch.source.xy - vec2u(1u);
    let texel = group.xy * TILE + local.xy;
    let t0 = min(texel * 2u, source_last);
    let t1 = min(t0 + vec2u(1u), source_last);
    let far = min(
        min(source_at(t0), source_at(vec2u(t1.x, t0.y))),
        min(source_at(vec2u(t0.x, t1.y)), source_at(t1)),
    );
    tile[local.y * TILE + local.x] = far;
    store(first, texel, far);
    // Each later level of the batch, from the tile of the level below it.
    var size = TILE;
    for (var level = 1u; level < LEVELS_PER_BATCH; level++) {
        let below = size;
        size = size / 2u;
        let shape = batch.levels[level];
        let below_last = batch.levels[level - 1u].xy - vec2u(1u);
        let builds = local.x < size && local.y < size;
        let texel = group.xy * size + local.xy;
        var far = 0.0;
        workgroupBarrier();
        if builds && shape.x != 0u {
            // The level below's texels, clamped to its edge, then placed in the tile.
            let origin = group.xy * below;
            let t0 = min(texel * 2u, below_last) - origin;
            let t1 = min(texel * 2u + vec2u(1u), below_last) - origin;
            far = min(
                min(tile[t0.y * below + t0.x], tile[t0.y * below + t1.x]),
                min(tile[t1.y * below + t0.x], tile[t1.y * below + t1.x]),
            );
        }
        workgroupBarrier();
        if builds && shape.x != 0u {
            tile[local.y * size + local.x] = far;
            store(shape, texel, far);
        }
    }
}
