// GPU culling. One thread per instance tests the instance's bounding sphere against the six
// frustum planes and appends each survivor to its bucket's slice of the compacted instance buffer,
// raising the instance count of the bucket's indirect draws. A bucket has one draw per part of its
// mesh, and each part's draw reads the same slice, so every draw of the bucket counts each
// survivor. The sphere comes from the bucket's local sphere and the world matrix: the matrix moves
// the local center, which is the origin for most buckets, and the radius is the local radius times
// the largest axis scale.
//
// A workgroup counts its survivors per bucket in workgroup memory first. One thread per bucket then
// adds the workgroup's count to each of the bucket's draws with one atomic add each, and the add on
// the first draw gives the workgroup its place in the slice. So the threads of a large bucket do
// not all add to the same words of the indirect draws in turn (decision record D-100). The table
// has one slot per thread. A bucket takes the slot at its index modulo the table's size, or the
// next free one after it, so the table holds every bucket that the workgroup's threads can name.
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
// A bucket whose vertex shaders read their instances by index (the INSTANCE_INDEX builds, which a
// test switch asks for) takes no copy: its slice gets each survivor's index, and the vertex shader
// reads the matrix, the material and the cell's offset itself (decision record D-23). Those slices
// follow the copies in the same buffer, so culling binds no storage buffer more. Each index fills a
// whole 16-byte entry. WGSL may write one part of a vector in storage as a read and a write of the
// whole vector, so two threads that write parts of one entry make a data race, which can lose a
// write on any GPU. The buffer is an array of `vec4u`, and the copies' floats go into it bit for
// bit.
//
// Each instance also has a layer mask, and the view one of its own. The thread skips an instance
// whose mask shares no bit with the view's.
//
// When the CPU culls whole grid cells first, the parameters list runs of the cell order: the
// instances of the cells in view, and the instances that move. The dispatch covers only those
// runs. Each workgroup finds its run, and each thread reads its instance from the cell order.
// With no runs listed, thread i culls instance i.
//
// Two-phase occlusion culling splits a camera view's culling in two, with the view's history: one
// word per instance after the view's indirect draws, 1 when the instance drew in the view's last
// frame. It shares their buffer, which frames reset only up to the draws, so that the culling
// group stays within the eight storage buffers that every device allows a shader stage. `early`
// keeps the instances in view that the sketch marks as occluders, whose history is 1, and that
// cover at least the occluders' span of the screen, in the first set of indirect draws, and the view's occluders' pass draws their
// depth. It counts them in the pyramid's first word. In a frame without occluders, the pyramid
// skips its work and `late` tests nothing against it, so an open scene of small objects pays for
// little more than a second culling dispatch. The GPU then builds the depth pyramid from that depth
// (pyramid.wgsl): each level holds the farthest depth of each square of the level below it. `late`
// tests every instance in view against the pyramid, writes its history, and keeps the visible
// ones in the second set of indirect draws, after the first, which the view's opaque pass draws.
// It writes over the bucket slices that the occluders' pass has finished reading.
//
// An instance hides when its bounding sphere lies behind the farthest depth of the pyramid's
// texels under it. The sphere's bounds on the screen and its nearest depth come from interval
// arithmetic on the view-projection matrix's rows, which holds for perspective and orthographic
// lenses alike and can only make the bounds larger. The level is the first whose texels are at
// least as wide as the bounds, so at most two texels each way cover them. Depth is reversed: 1 at
// the near plane and 0 at the far plane, so the pyramid keeps the smallest value.
//
// The OCCLUSION build holds the two phases, `early` and `late`, and the build without it holds
// `main` alone, so a page that never culls against a pyramid downloads none of the phases.

/// An entry holds its bucket in the bits below OCCLUDER, the occluder mark at OCCLUDER, and the
/// instance's cell index from CELL_SHIFT up.
const CELL_SHIFT: u32 = 23u;
const OCCLUDER: u32 = 1u << 22u;
/// Runs of the cell order that one dispatch covers at most.
const MAX_RANGES: u32 = 257u;
/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 128u;
/// Levels of the depth pyramid at most.
const MAX_LEVELS: u32 = 16u;

/// What the occlusion phases read: the view-projection matrix for positions relative to the
/// camera, the render size, and the depth pyramid's levels. The levels' shapes follow from the
/// render size (see `level_shape`), so no thread reads a table of this uniform block at an index of
/// its own: the Galaxy S25's driver can give every thread one thread's entry of such a table.
struct Occlusion {
    view_proj: mat4x4f,
    /// The render size in pixels, wide and high, and two spares.
    size: vec4f,
    /// The pyramid's levels, the indirect draws of the first set, which come before the second
    /// set's, the word where the history starts in the indirect draws' buffer, and the pixels that
    /// an occluder's bounds span at least, wide or high.
    info: vec4u,
}

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
    /// What the occlusion phases read. Other views leave it unset.
    occlusion: Occlusion,
}

/// A bucket: one pipeline, mesh and material, with its slice of the compacted instance buffer and
/// its indirect draws, one per part of the mesh, from `first_draw` on. Its instances are culled
/// with the local sphere of `radius` around `center_x`, `center_y` and `center_z`. A skinned
/// object's bucket names the first joint of its skin, which the vertex shaders that skin read
/// beside the material. A bucket with `indices` 1 writes each survivor's index instead, one entry
/// each, from entry `base` on.
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
    indices: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
// `main` reads none of the pyramid, which views that cull in one phase bind a placeholder for.
@group(0) @binding(1) var<storage, read> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read> instance_buckets: array<u32>;
@group(0) @binding(3) var<storage, read> buckets: array<Bucket>;
@group(0) @binding(4) var<storage, read_write> visible: array<vec4u>;
@group(0) @binding(5) var<storage, read_write> indirect: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> instance_layers: array<u32>;
/// The instances in cell order: each cell's still instances, then the ones that move.
@group(0) @binding(7) var<storage, read> order: array<u32>;
/// The view's depth pyramid, which only the occlusion phases bind: the count of the frame's
/// occluders, then the levels' depths as the bits of 32-bit floats.
@group(0) @binding(8) var<storage, read_write> pyramid: array<atomic<u32>>;
/// The offset from each view's camera to the center of each grid cell: texel x of row y holds
/// cell x's offset for the view whose row is y.
@group(0) @binding(9) var cell_offsets: texture_2d<f32>;

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

/// An instance in the view: its bucket and its own index, whether the sketch marks it as an
/// occluder, its matrix moved by its cell's offset, and its bounding sphere relative to the camera.
/// The bucket is `HIDDEN` for an instance that draws nowhere in the view: hidden, on none of the
/// view's layers, or outside the frustum.
struct Survivor {
    bucket: u32,
    index: u32,
    occluder: bool,
    r0: vec4f,
    r1: vec4f,
    r2: vec4f,
    center: vec3f,
    radius: f32,
}

/// Instance `i` where it draws nowhere in the view, which is also what a thread past every run
/// appends.
fn hidden(i: u32) -> Survivor {
    var out: Survivor;
    out.bucket = HIDDEN;
    out.index = i;
    return out;
}

/// Instance `i`, tested against the view's layers and frustum.
fn survivor(i: u32) -> Survivor {
    var out = hidden(i);
    let entry = instance_buckets[i];
    if entry == HIDDEN || (instance_layers[i] & params.layers) == 0u {
        return out;
    }
    let b = entry & (OCCLUDER - 1u);
    let offset = textureLoad(cell_offsets, vec2u(entry >> CELL_SHIFT, params.offsets_row), 0);
    out.occluder = (entry & OCCLUDER) != 0u;
    out.r0 = matrices[i * 3u] + vec4f(0.0, 0.0, 0.0, offset.x);
    out.r1 = matrices[i * 3u + 1u] + vec4f(0.0, 0.0, 0.0, offset.y);
    out.r2 = matrices[i * 3u + 2u] + vec4f(0.0, 0.0, 0.0, offset.z);
    let bucket = buckets[b];
    let local_center = vec4f(bucket.center_x, bucket.center_y, bucket.center_z, 1.0);
    out.center = vec3f(dot(out.r0, local_center), dot(out.r1, local_center), dot(out.r2, local_center));
    let scale = max(
        length(vec3f(out.r0.x, out.r1.x, out.r2.x)),
        max(length(vec3f(out.r0.y, out.r1.y, out.r2.y)), length(vec3f(out.r0.z, out.r1.z, out.r2.z))),
    );
    out.radius = bucket.radius * scale;
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if dot(plane.xyz, out.center) + plane.w < -out.radius {
            return out;
        }
    }
    out.bucket = b;
    return out;
}

/// Each workgroup's table of buckets: a slot's bucket, or `HIDDEN` when the slot is free, the
/// survivors of the bucket that the workgroup counts, and where they start in the bucket's slice.
var<workgroup> slot_buckets: array<atomic<u32>, WORKGROUP_SIZE>;
var<workgroup> slot_counts: array<atomic<u32>, WORKGROUP_SIZE>;
var<workgroup> slot_starts: array<u32, WORKGROUP_SIZE>;

/// Appends the workgroup's instances in the view to their buckets' slices, and counts them in
/// each of their buckets' draws, which start `draws_before` draws into the indirect draws. Every
/// thread of the workgroup calls it, with a bucket of `HIDDEN` for a thread whose instance does
/// not draw.
fn append(s: Survivor, lane: u32, draws_before: u32) {
    // Workgroup memory starts unset on some GPUs, so each thread clears its own slot.
    atomicStore(&slot_buckets[lane], HIDDEN);
    atomicStore(&slot_counts[lane], 0u);
    workgroupBarrier();
    var slot = s.bucket % WORKGROUP_SIZE;
    var rank = 0u;
    var owner = false;
    if s.bucket != HIDDEN {
        // A weak exchange can fail on a free slot, which the next turn tries again.
        loop {
            let claim = atomicCompareExchangeWeak(&slot_buckets[slot], HIDDEN, s.bucket);
            if claim.exchanged {
                owner = true;
                break;
            }
            if claim.old_value == s.bucket {
                break;
            }
            if claim.old_value != HIDDEN {
                slot = (slot + 1u) % WORKGROUP_SIZE;
            }
        }
        rank = atomicAdd(&slot_counts[slot], 1u);
    }
    workgroupBarrier();
    if owner {
        let bucket = buckets[s.bucket];
        let count = atomicLoad(&slot_counts[slot]);
        let first = (draws_before + bucket.first_draw) * INDIRECT_WORDS + 1u;
        slot_starts[slot] = atomicAdd(&indirect[first], count);
        for (var d = 1u; d < bucket.draws; d++) {
            atomicAdd(&indirect[first + d * INDIRECT_WORDS], count);
        }
    }
    workgroupBarrier();
    if s.bucket == HIDDEN {
        return;
    }
    let bucket = buckets[s.bucket];
    let entry = slot_starts[slot] + rank;
    if bucket.indices != 0u {
        visible[bucket.base + entry] = vec4u(s.index, 0u, 0u, 0u);
        return;
    }
    let dst = (bucket.base + entry) * 4u;
    visible[dst] = bitcast<vec4u>(s.r0);
    visible[dst + 1u] = bitcast<vec4u>(s.r1);
    visible[dst + 2u] = bitcast<vec4u>(s.r2);
    visible[dst + 3u] = vec4u(bucket.material, bucket.first_joint, 0u, 0u);
}

#ifndef OCCLUSION
/// Culls once, against the frustum alone, into the first set of indirect draws, or for a camera
/// view that culls in two phases, in a frame without marked occluders, into its second set.
@compute @workgroup_size(128)
fn main(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    var s = hidden(i);
    if i != NONE {
        s = survivor(i);
    }
    append(s, lane, params.occlusion.info.y);
}

#else
/// The first occlusion phase: the occluders, the instances in view that the sketch marks as
/// occluders, that drew in the view's last frame, and that look large enough on the screen.
@compute @workgroup_size(128)
fn early(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    var s = hidden(i);
    if i != NONE && atomicLoad(&indirect[params.occlusion.info.z + i]) != 0u {
        s = survivor(i);
    }
    if s.bucket != HIDDEN && s.occluder && large_enough(s.center, s.radius) {
        atomicAdd(&pyramid[0], 1u);
    } else {
        s.bucket = HIDDEN;
    }
    append(s, lane, 0u);
}

/// True when the sphere around `center`, relative to the camera, of `radius` spans at least the
/// occluders' span of the screen. A sphere that reaches the camera's plane covers much of the
/// screen.
fn large_enough(center: vec3f, radius: f32) -> bool {
    let bounds = screen_bounds(center, radius);
    let span = max(bounds.high.x - bounds.low.x, bounds.high.y - bounds.low.y);
    return !bounds.valid || span >= f32(params.occlusion.info.w);
}

/// The second occlusion phase: tests every instance in view against the depth pyramid, keeps
/// whether it is visible as its history, and appends the visible ones to the second set of draws.
@compute @workgroup_size(128)
fn late(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    var s = hidden(i);
    if i != NONE {
        s = survivor(i);
        let seen = s.bucket != HIDDEN && !occluded(s.center, s.radius);
        atomicStore(&indirect[params.occlusion.info.z + i], select(0u, 1u, seen));
        if !seen {
            s.bucket = HIDDEN;
        }
    }
    append(s, lane, params.occlusion.info.y);
}

/// The lowest and highest values of `a / b` for `a` from `a0` to `a1` and `b` from `b0` to `b1`,
/// where `b0` is above 0.
fn quotient_bounds(a0: f32, a1: f32, b0: f32, b1: f32) -> vec2f {
    let q = vec4f(a0 / b0, a0 / b1, a1 / b0, a1 / b1);
    return vec2f(min(min(q.x, q.y), min(q.z, q.w)), max(max(q.x, q.y), max(q.z, q.w)));
}

/// The width and height in texels of the pyramid's `level`, and where it starts in the pyramid.
/// Level 0 halves the render size each way, rounding up, and each later level halves the one
/// before it, so level L is the render size over 2^(L + 1), rounded up. The levels follow the
/// word that counts the occluders. The loop runs the same passes in every thread.
fn level_shape(level: u32) -> vec3u {
    let size = vec2u(params.occlusion.size.xy);
    var start = 1u;
    for (var l = 0u; l < MAX_LEVELS; l++) {
        if l < level {
            let below = (size + vec2u((2u << l) - 1u)) >> vec2u(l + 1u);
            start += below.x * below.y;
        }
    }
    return vec3u((size + vec2u((2u << level) - 1u)) >> vec2u(level + 1u), start);
}

/// The farthest depth that the level of `shape` holds over texels `t0` to `t1`, which lie at most
/// one texel apart each way.
fn farthest(shape: vec3u, t0: vec2u, t1: vec2u) -> f32 {
    let row0 = shape.z + t0.y * shape.x;
    let row1 = shape.z + t1.y * shape.x;
    return min(
        min(depth_at(row0 + t0.x), depth_at(row0 + t1.x)),
        min(depth_at(row1 + t0.x), depth_at(row1 + t1.x)),
    );
}

/// A depth that the pyramid holds.
fn depth_at(word: u32) -> f32 {
    return bitcast<f32>(atomicLoad(&pyramid[word]));
}

/// A sphere's bounds on the screen in pixels, rows from the top, inside the render size, and its
/// nearest depth. Not valid for a sphere that reaches the camera's plane, whose bounds are
/// unbounded.
struct ScreenBounds {
    valid: bool,
    low: vec2f,
    high: vec2f,
    nearest: f32,
}

/// The bounds on the screen of the sphere around `center`, relative to the camera, of `radius`.
fn screen_bounds(center: vec3f, radius: f32) -> ScreenBounds {
    var out: ScreenBounds;
    let o = params.occlusion;
    let m = o.view_proj;
    let clip = m * vec4f(center, 1.0);
    // How far each clip coordinate moves over the sphere: the radius times its row's length.
    let reach = radius * vec4f(
        length(vec3f(m[0].x, m[1].x, m[2].x)),
        length(vec3f(m[0].y, m[1].y, m[2].y)),
        length(vec3f(m[0].z, m[1].z, m[2].z)),
        length(vec3f(m[0].w, m[1].w, m[2].w)),
    );
    let w0 = clip.w - reach.w;
    let w1 = clip.w + reach.w;
    out.valid = w0 > 1e-6;
    if !out.valid {
        return out;
    }
    let x = quotient_bounds(clip.x - reach.x, clip.x + reach.x, w0, w1);
    let y = quotient_bounds(clip.y - reach.y, clip.y + reach.y, w0, w1);
    out.nearest = quotient_bounds(clip.z - reach.z, clip.z + reach.z, w0, w1).y;
    let size = o.size.xy;
    out.low = clamp(vec2f(x.x * 0.5 + 0.5, 0.5 - y.y * 0.5) * size, vec2f(0.0), size);
    out.high = clamp(vec2f(x.y * 0.5 + 0.5, 0.5 - y.x * 0.5) * size, vec2f(0.0), size);
    return out;
}

/// True when the sphere around `center`, relative to the camera, of `radius` lies wholly behind
/// the depth that the pyramid holds where it covers the screen. A sphere that reaches the camera's
/// plane or the near plane never hides, and nothing hides in a frame without occluders.
fn occluded(center: vec3f, radius: f32) -> bool {
    let o = params.occlusion;
    if o.info.x == 0u || atomicLoad(&pyramid[0]) == 0u {
        return false;
    }
    let bounds = screen_bounds(center, radius);
    if !bounds.valid || bounds.nearest >= 1.0 {
        return false;
    }
    // A texel of level L is 2^(L + 1) pixels wide: the first level whose texels are at least as
    // wide as the bounds.
    let span = u32(ceil(max(bounds.high.x - bounds.low.x, bounds.high.y - bounds.low.y)));
    var level = 0u;
    if span > 2u {
        level = u32(firstLeadingBit(span - 1u));
    }
    level = min(level, o.info.x - 1u);
    let shape = level_shape(level);
    let texel = f32(2u << level);
    let last = shape.xy - vec2u(1u);
    let t0 = min(vec2u(bounds.low / texel), last);
    let t1 = min(min(vec2u(bounds.high / texel), last), t0 + vec2u(1u));
    return bounds.nearest < farthest(shape, t0, t1);
}
#endif
