// Cluster levels: the pass that picks the patches of a tree of cluster patches that a view draws,
// and copies their indices into the view's own list, so one indirect draw draws them all.
//
// Three dispatches of one pipeline fill the view's list, which the dispatch's parameters pick:
// - stage 0, count: a thread a patch. The thread moves the patch's sphere by its mesh's copy in
//   the view's compacted instances, tests it against the view's six frustum planes, and applies
//   the level rule: a patch draws while its own error passes the view's threshold and the error of
//   the patch above it does not. It writes the patch's run of indices, or 0.
// - stage 1, scan: one workgroup adds each patch's count up, writes the offset of each patch's
//   indices in the view's list, and writes each cluster mesh's indirect draw.
// - stage 2, copy: a workgroup a patch copies the patch's indices into the view's list where the
//   scan put them.
//
// The patches of a tree draw in place of their parent, so the patches that a view draws cover the
// mesh once, near the camera at fine detail and far from it at coarse detail. The indirect draw's
// index count comes from the scan, so a view that sees no patch of a mesh draws none of it.
//
// The scene's patches follow each other mesh after mesh, and each mesh's record names its run of
// them, the slot of its copy in the view's compacted instances, the first of its indirect draws,
// and the base vertex that its indices start from.

/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 64u;
/// The smallest distance that the level rule compares, in metres, as the culling pass reads it.
const LEAST_DISTANCE: f32 = 1.0e-3;
/// The words of one patch's record, and of one mesh's record, in the tables.
const PATCH_WORDS: u32 = 8u;
const MESH_WORDS: u32 = 8u;
/// The words of one indexed indirect draw.
const INDIRECT_WORDS: u32 = 5u;
/// The words of one copy in the view's compacted instances: three rows of the world matrix, then
/// the ids.
const COPY_WORDS: u32 = 4u;

/// One dispatch's parameters. Three blocks follow each other, the count, the scan and the copy,
/// and each dispatch binds its own at a dynamic offset. Only the first word of `counts` differs
/// between them: it holds the stage, which picks the dispatch's work.
struct Params {
    /// The view's six frustum planes, relative to its camera.
    planes: array<vec4f, 6>,
    /// The stage, the scene's patches, the scene's cluster meshes, and the draws that the view's
    /// indirect buffer holds before its own.
    counts: vec4u,
    /// The level rule's factor, then 1 for an orthographic camera, whose distance counts as 1.
    levels: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
/// The scene's patch records, then its mesh records.
@group(0) @binding(1) var<storage, read> tables: array<vec4u>;
/// Every patch's indices, one patch after another.
@group(0) @binding(2) var<storage, read> tree_indices: array<u32>;
/// The view's compacted instances, four entries a copy.
@group(0) @binding(3) var<storage, read> visible: array<vec4u>;
/// The view's indirect draws, which the culling pass counts.
@group(0) @binding(4) var<storage, read> indirect: array<u32>;
/// Each patch's run of indices that draws in the view, or 0.
@group(0) @binding(5) var<storage, read_write> runs: array<u32>;
/// Where each patch's indices start in the view's list.
@group(0) @binding(6) var<storage, read_write> offsets: array<u32>;
/// The view's list of indices, which the view's cluster draws read.
@group(0) @binding(7) var<storage, read_write> list: array<u32>;
/// Each cluster mesh's indirect draw: its index count, an instance, its first index in the list,
/// its base vertex, and a spare.
@group(0) @binding(8) var<storage, read_write> draws: array<u32>;

/// The workgroup's running sums in the scan.
var<workgroup> sums: array<u32, WORKGROUP_SIZE>;

/// A patch's bounding sphere, its run of indices, its parent and its error.
struct Patch {
    centre: vec3f,
    radius: f32,
    first: u32,
    count: u32,
    parent: u32,
    error: f32,
}

/// A cluster mesh: its first patch, the patches it has, the slot of its copy, the first of its
/// indirect draws and its base vertex.
struct ClusterMesh {
    first_patch: u32,
    patch_count: u32,
    slot: u32,
    first_draw: u32,
    base_vertex: u32,
}

/// Patch `index`'s record.
fn patch_of(index: u32) -> Patch {
    let first = index * (PATCH_WORDS / 4u);
    let a = tables[first];
    let b = tables[first + 1u];
    return Patch(
        vec3f(bitcast<f32>(a.x), bitcast<f32>(a.y), bitcast<f32>(a.z)),
        bitcast<f32>(a.w),
        b.x,
        b.y,
        b.z,
        bitcast<f32>(b.w),
    );
}

/// Mesh `mesh`'s record.
fn mesh_of(mesh: u32) -> ClusterMesh {
    let at = params.counts.y * (PATCH_WORDS / 4u) + mesh * (MESH_WORDS / 4u);
    let a = tables[at];
    return ClusterMesh(a.x, a.y, a.z, a.w, tables[at + 1u].x);
}

/// The mesh that a patch belongs to: the last mesh whose first patch is at most it.
fn mesh_of_patch(at: u32) -> ClusterMesh {
    var found = mesh_of(0u);
    for (var m = 1u; m < params.counts.z; m++) {
        let mesh = mesh_of(m);
        if (at >= mesh.first_patch) {
            found = mesh;
        } else {
            break;
        }
    }
    return found;
}

/// The index count of a patch in this view: its run where the level rule draws it, else 0.
fn run_of(at: u32) -> u32 {
    let record = patch_of(at);
    let mesh = mesh_of_patch(at);
    let copy = mesh.slot;
    let m0 = bitcast<vec4f>(visible[copy * COPY_WORDS]);
    let m1 = bitcast<vec4f>(visible[copy * COPY_WORDS + 1u]);
    let m2 = bitcast<vec4f>(visible[copy * COPY_WORDS + 2u]);
    let local = vec4f(record.centre, 1.0);
    let centre = vec3f(dot(m0, local), dot(m1, local), dot(m2, local));
    let scale = max(
        length(vec3f(m0.x, m1.x, m2.x)),
        max(length(vec3f(m0.y, m1.y, m2.y)), length(vec3f(m0.z, m1.z, m2.z))),
    );
    let radius = record.radius * scale;
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if (dot(plane.xyz, centre) + plane.w < -radius) {
            return 0u;
        }
    }
    let factor = params.levels.x;
    let reach = scale * factor;
    let nearest = max(length(centre) - radius, LEAST_DISTANCE);
    let distance = select(nearest, 1.0, params.levels.y > 0.5);
    if record.error * reach >= distance {
        return 0u;
    }
    if record.parent != 0u && patch_of(record.parent - 1u).error * reach < distance {
        return 0u;
    }
    return record.count;
}

/// The count stage: the indices that a patch draws, or 0 for a patch outside the view or too
/// coarse for its distance.
fn count_patch(at: u32) {
    if (at >= params.counts.y) {
        return;
    }
    runs[at] = run_of(at);
}

/// The scan stage: the counts added up into the offsets of the view's list, and each cluster
/// mesh's indirect draw from where its patches start and end.
fn scan_patches(lane: u32) {
    let patches = params.counts.y;
    let meshes = params.counts.z;
    // This lane's run of patches, a share of the list each.
    let share = (patches + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    let first = lane * share;
    let end = min(first + share, patches);
    var total = 0u;
    for (var p = first; p < end; p++) {
        total += runs[p];
    }
    sums[lane] = total;
    workgroupBarrier();
    // Each lane's base: every count of the lanes before it. One lane adds them up.
    if (lane == 0u) {
        var running = 0u;
        for (var t = 0u; t < WORKGROUP_SIZE; t++) {
            running += sums[t];
            sums[t] = running;
        }
    }
    workgroupBarrier();
    var at = 0u;
    if (lane > 0u) {
        at = sums[lane - 1u];
    }
    for (var p = first; p < end; p++) {
        offsets[p] = at;
        at += runs[p];
    }
    if (lane != 0u || meshes == 0u) {
        return;
    }
    // The scene's total, and each mesh's draw: where its patches start in the list and how many
    // indices they took. A mesh that the culling pass drew nothing of draws nothing.
    let whole = sums[WORKGROUP_SIZE - 1u];
    for (var m = 0u; m < meshes; m++) {
        let mesh = mesh_of(m);
        let start = offsets[mesh.first_patch];
        var finish = whole;
        if (m + 1u < meshes) {
            finish = offsets[mesh_of(m + 1u).first_patch];
        }
        let drawn = indirect[(params.counts.w + mesh.first_draw) * INDIRECT_WORDS + 1u];
        let at = mesh.first_draw * INDIRECT_WORDS;
        draws[at] = select(0u, finish - start, drawn > 0u);
        draws[at + 1u] = select(0u, 1u, drawn > 0u);
        draws[at + 2u] = start;
        draws[at + 3u] = mesh.base_vertex;
        draws[at + 4u] = 0u;
    }
}

/// The copy stage: each drawn patch's indices, copied into the view's list where the scan put them.
fn copy_patch(at: u32, lane: u32) {
    if (at >= params.counts.y) {
        return;
    }
    let count = runs[at];
    if (count == 0u) {
        return;
    }
    let record = patch_of(at);
    let out = offsets[at];
    for (var k = lane; k < count; k += WORKGROUP_SIZE) {
        list[out + k] = tree_indices[record.first + k];
    }
}

/// One dispatch of the cluster pass. Its parameters name the stage, which is the same for every
/// thread of the dispatch.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
    @builtin(global_invocation_id) id: vec3u,
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let stage = params.counts.x;
    if (stage == 0u) {
        count_patch(id.x);
    } else if (stage == 1u) {
        scan_patches(lane);
    } else {
        copy_patch(group.x, lane);
    }
}
