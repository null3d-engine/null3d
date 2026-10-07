// GPU culling. One thread per instance tests the instance's bounding sphere against the six
// frustum planes and appends each survivor to its bucket's slice of the compacted instance buffer,
// raising the instance count of the bucket's indirect draws with atomic adds. A bucket has one
// draw per part of its mesh, and each part's draw reads the same slice, so every draw of the
// bucket counts each survivor. The sphere comes from the bucket's local sphere and the world
// matrix: the matrix moves the local center, which is the origin for most buckets, and the radius
// is the local radius times the largest axis scale.
//
// World matrices are relative to the centers of their grid cells, and the planes to the camera. An
// instance's entry in the bucket table holds its cell index above its bucket, and the thread moves
// the instance by its cell's offset from the camera before it tests it. The compacted instance
// buffer then holds matrices relative to the camera, which the vertex shader draws as they are.
//
// The offsets come from a data texture, one row per view and one texel per cell, which each thread
// reads at its own cell. A table in the uniform parameters, read at each thread's own index, gave
// every thread of a group the same thread's entry on the Galaxy S25 (Adreno 830). A texture keeps
// the culling group within the eight storage buffers that every device allows a shader stage.
//
// Each instance also has a layer mask, and the view one of its own. The thread skips an instance
// whose mask shares no bit with the view's.
//
// When the CPU culls whole grid cells first, the parameters list runs of the cell order: the
// instances of the cells in view, and the instances that move. The dispatch covers only those
// runs. Each workgroup finds its run, and each thread reads its instance from the cell order.
// With no runs listed, thread i culls instance i.

/// An entry holds its bucket in the bits below CELL_SHIFT, and the instance's cell index above.
const CELL_SHIFT: u32 = 23u;
/// Runs of the cell order that one dispatch covers at most.
const MAX_RANGES: u32 = 257u;
/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 128u;

struct CullParams {
    planes: array<vec4f, 6>,
    instance_count: u32,
    /// The view's layer mask.
    layers: u32,
    /// The runs of the cell order to cull, or 0 to cull every instance in place.
    range_count: u32,
    /// The view's row of the cell offsets texture.
    offsets_row: u32,
    /// Each run: its first position in the cell order, its end, and its first workgroup.
    ranges: array<vec4u, MAX_RANGES>,
}

/// A bucket: one pipeline, mesh and material, with its slice of the compacted instance buffer and
/// its indirect draws, one per part of the mesh, from `first_draw` on. Its instances are culled
/// with the local sphere of `radius` around `center_x`, `center_y` and `center_z`. A skinned
/// object's bucket names the first joint of its skin, which the vertex shaders that skin read
/// beside the material.
struct Bucket {
    base: u32,
    material: u32,
    radius: f32,
    first_draw: u32,
    draws: u32,
    center_x: f32,
    center_y: f32,
    center_z: f32,
    first_joint: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read> instance_buckets: array<u32>;
@group(0) @binding(3) var<storage, read> buckets: array<Bucket>;
@group(0) @binding(4) var<storage, read_write> visible: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> indirect: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> instance_layers: array<u32>;
/// The instances in cell order: each cell's still instances, then the ones that move.
@group(0) @binding(7) var<storage, read> order: array<u32>;
/// The offset from each view's camera to the center of each grid cell: texel x of row y holds
/// cell x's offset for the view whose row is y.
@group(0) @binding(8) var cell_offsets: texture_2d<f32>;

/// The bucket of an instance that draws nowhere.
const HIDDEN: u32 = 0xffffffffu;
/// 32-bit words of one indexed indirect draw: index count, instance count, first index, base
/// vertex, first instance.
const INDIRECT_WORDS: u32 = 5u;
/// The thread of an instance past every run.
const NONE: u32 = 0xffffffffu;

/// The instance that a thread culls: its place in the cell order's run, or its own index when
/// the parameters list no runs. `NONE` past the end.
fn instance_of(group: u32, lane: u32) -> u32 {
    if params.range_count == 0u {
        let i = group * WORKGROUP_SIZE + lane;
        return select(NONE, i, i < params.instance_count);
    }
    // The last run whose first workgroup is at most this one.
    var low = 0u;
    var high = params.range_count;
    while high - low > 1u {
        let middle = (low + high) / 2u;
        if params.ranges[middle].z <= group {
            low = middle;
        } else {
            high = middle;
        }
    }
    let range = params.ranges[low];
    let position = range.x + (group - range.z) * WORKGROUP_SIZE + lane;
    if position >= range.y {
        return NONE;
    }
    return order[position];
}

@compute @workgroup_size(128)
fn main(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    if i == NONE {
        return;
    }
    let entry = instance_buckets[i];
    if entry == HIDDEN || (instance_layers[i] & params.layers) == 0u {
        return;
    }
    let b = entry & ((1u << CELL_SHIFT) - 1u);
    let offset = textureLoad(cell_offsets, vec2u(entry >> CELL_SHIFT, params.offsets_row), 0);
    let r0 = matrices[i * 3u] + vec4f(0.0, 0.0, 0.0, offset.x);
    let r1 = matrices[i * 3u + 1u] + vec4f(0.0, 0.0, 0.0, offset.y);
    let r2 = matrices[i * 3u + 2u] + vec4f(0.0, 0.0, 0.0, offset.z);
    let bucket = buckets[b];
    let local_center = vec4f(bucket.center_x, bucket.center_y, bucket.center_z, 1.0);
    let center = vec3f(dot(r0, local_center), dot(r1, local_center), dot(r2, local_center));
    let scale = max(
        length(vec3f(r0.x, r1.x, r2.x)),
        max(length(vec3f(r0.y, r1.y, r2.y)), length(vec3f(r0.z, r1.z, r2.z))),
    );
    let radius = bucket.radius * scale;
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if dot(plane.xyz, center) + plane.w < -radius {
            return;
        }
    }
    let slot = atomicAdd(&indirect[bucket.first_draw * INDIRECT_WORDS + 1u], 1u);
    for (var d = 1u; d < bucket.draws; d++) {
        atomicAdd(&indirect[(bucket.first_draw + d) * INDIRECT_WORDS + 1u], 1u);
    }
    let dst = (bucket.base + slot) * 4u;
    visible[dst] = r0;
    visible[dst + 1u] = r1;
    visible[dst + 2u] = r2;
    visible[dst + 3u] = bitcast<vec4f>(vec4u(bucket.material, bucket.first_joint, 0u, 0u));
}
