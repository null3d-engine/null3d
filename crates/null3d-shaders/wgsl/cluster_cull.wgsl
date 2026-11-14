// Cluster levels: the pass that picks the patches of a tree of cluster patches that a view draws,
// and copies their indices into the view's own list, so one indirect draw draws them all. A
// camera's view picks by its pixels, and a shadow view by its map's texels.
//
// Three dispatches of one pipeline fill the view's list, which the dispatch's parameters pick:
// - stage 0, count: a thread a patch. The thread moves the patch's sphere by its mesh's copy in
//   the view's compacted instances, tests it against the view's six frustum planes, and applies
//   the level rule: a patch draws while its own error passes the view's threshold at its own
//   sphere and the error of the patch above it does not pass at that patch's sphere. It writes the
//   patch's run of indices, or 0, and each workgroup writes the total of its patches' runs.
// - stage 1, scan: one workgroup adds the workgroups' totals up into each group's first offset in
//   the view's list, and writes each cluster mesh's indirect draw.
// - stage 2, copy: a workgroup a patch finds the patch's offset from its group's first offset
//   and the runs before it in the group, and copies the patch's indices into the view's list.
//
// The scan adds one total for each group of patches, not each patch's run, so its one workgroup
// takes a share of the groups that is a workgroup's width smaller.
//
// The patches of a tree draw in place of their parent, so the patches that a view draws cover the
// mesh once, near the camera at fine detail and far from it at coarse detail. The indirect draw's
// index count comes from the scan, so a view that sees no patch of a mesh draws none of it.
//
// The scene's patches follow each other mesh after mesh, and each mesh's record names its run of
// them, the slot of its copy in the view's compacted instances, the first of the layout's indirect
// draws, where the culling pass counts its copy, and the base vertex that its indices start from.
// The view's own draws hold one draw for each record, in the records' order. Two sets of mesh records follow the patches,
// one record for each tree in each: the scene's layout's, which the camera's views read, and the
// casters' layout's, which the shadow views read. A tree that a layout does not draw has a record
// whose slot is NOT_DRAWN, so the view picks none of its patches and writes none of its draws.

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
/// The slot and the draw of a tree that the view's layout does not draw.
const NOT_DRAWN: u32 = 0xffffffffu;
/// The reach of a rule that is off, which draws the finest patches, as it draws every mesh's base
/// level.
const OFF_REACH: f32 = 3.0e38;

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
    /// Where the view measures errors: 0 in the last word for the camera's distance, 1 for a
    /// light's orthographic view, which measures 1 at every distance, and 2 for a light's
    /// perspective view, which measures from the light at the first three words.
    measure: vec4f,
    /// The first mesh record of the view's set, and the indices that the view's list holds, which
    /// the pass never writes past.
    records: vec4u,
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
/// After one word for each patch, each group of patches' total of runs, which the scan turns into
/// where the group's indices start in the view's list.
@group(0) @binding(6) var<storage, read_write> offsets: array<u32>;
/// The view's list of indices, which the view's cluster draws read.
@group(0) @binding(7) var<storage, read_write> list: array<u32>;
/// Each cluster mesh's indirect draw, in the order of the meshes' records: its index count, an
/// instance, its first index in the list, its base vertex, and a spare.
@group(0) @binding(8) var<storage, read_write> draws: array<u32>;

/// The workgroup's runs in the count, and its running sums in the scan.
var<workgroup> sums: array<u32, WORKGROUP_SIZE>;
/// The copying workgroup's patch's run, and where its indices start in the view's list.
var<workgroup> copy_count: u32;
var<workgroup> copy_at: u32;

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

/// Mesh `mesh`'s record in the view's set.
fn mesh_of(mesh: u32) -> ClusterMesh {
    let at = params.counts.y * (PATCH_WORDS / 4u) + (params.records.x + mesh) * (MESH_WORDS / 4u);
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

/// A patch's sphere, placed by the rows `m0`, `m1` and `m2` of its copy's world matrix, whose
/// largest axis scale is `scale`: its centre relative to the view's camera, then its radius.
fn placed(record: Patch, m0: vec4f, m1: vec4f, m2: vec4f, scale: f32) -> vec4f {
    let local = vec4f(record.centre, 1.0);
    return vec4f(dot(m0, local), dot(m1, local), dot(m2, local), record.radius * scale);
}

/// The distance that the level rule compares for a placed sphere: the distance from the camera to
/// its nearest point, at least the least distance, or 1 for an orthographic camera. A light's
/// orthographic view measures 1, and its perspective view the distance from the light.
fn rule_distance(sphere: vec4f) -> f32 {
    if params.measure.w > 1.5 {
        return max(length(sphere.xyz - params.measure.xyz) - sphere.w, LEAST_DISTANCE);
    }
    let nearest = max(length(sphere.xyz) - sphere.w, LEAST_DISTANCE);
    return select(nearest, 1.0, params.levels.y > 0.5 || params.measure.w > 0.5);
}

/// The index count of a patch in this view: its run where the level rule draws it, else 0.
fn run_of(at: u32) -> u32 {
    let record = patch_of(at);
    let mesh = mesh_of_patch(at);
    if mesh.slot == NOT_DRAWN {
        return 0u;
    }
    // The culling pass counts this tree's copies this frame. A tree that it drew nothing of holds
    // none, and its copy's matrix may still hold the last frame that drew it, so a stale tree
    // counts no patch and moves no later tree's offset.
    let drawn = indirect[(params.counts.w + mesh.first_draw) * INDIRECT_WORDS + 1u];
    if drawn == 0u {
        return 0u;
    }
    let copy = mesh.slot;
    let m0 = bitcast<vec4f>(visible[copy * COPY_WORDS]);
    let m1 = bitcast<vec4f>(visible[copy * COPY_WORDS + 1u]);
    let m2 = bitcast<vec4f>(visible[copy * COPY_WORDS + 2u]);
    let scale = max(
        length(vec3f(m0.x, m1.x, m2.x)),
        max(length(vec3f(m0.y, m1.y, m2.y)), length(vec3f(m0.z, m1.z, m2.z))),
    );
    let sphere = placed(record, m0, m1, m2, scale);
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if (dot(plane.xyz, sphere.xyz) + plane.w < -sphere.w) {
            return 0u;
        }
    }
    let factor = params.levels.x;
    let reach = select(OFF_REACH, scale * factor, factor > 0.0);
    if record.error * reach >= rule_distance(sphere) {
        return 0u;
    }
    // The parent's error is tested at the parent's own sphere, which holds this patch's, so the
    // patches that draw cover the mesh once. The record names the parent's place in the scene's
    // patches.
    if record.parent != 0u {
        let parent = patch_of(record.parent - 1u);
        if parent.error * reach < rule_distance(placed(parent, m0, m1, m2, scale)) {
            return 0u;
        }
    }
    return record.count;
}

/// The count stage: the indices that a patch draws, or 0 for a patch outside the view or too
/// coarse for its distance, and the total of the workgroup's patches, after the patches' words.
fn count_patch(at: u32, lane: u32, group: u32) {
    var run = 0u;
    if (at < params.counts.y) {
        run = run_of(at);
        runs[at] = run;
    }
    sums[lane] = run;
    workgroupBarrier();
    if (lane == 0u) {
        var total = 0u;
        for (var t = 0u; t < WORKGROUP_SIZE; t++) {
            total += sums[t];
        }
        offsets[params.counts.y + group] = total;
    }
}

/// Where patch `at`'s indices start in the view's list, once the scan wrote its group's first
/// offset: that offset and the runs of the patches before it in the group.
fn patch_offset(at: u32) -> u32 {
    let group = at / WORKGROUP_SIZE;
    var offset = offsets[params.counts.y + group];
    for (var p = group * WORKGROUP_SIZE; p < at; p++) {
        offset += runs[p];
    }
    return offset;
}

/// The scan stage: the groups' totals added up into each group's first offset in the view's list,
/// and each cluster mesh's indirect draw from where its patches start and end.
fn scan_patches(lane: u32) {
    let patches = params.counts.y;
    let meshes = params.counts.z;
    let groups = (patches + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    // This lane's run of groups, a share of them each.
    let share = (groups + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    let first = lane * share;
    let end = min(first + share, groups);
    var total = 0u;
    for (var g = first; g < end; g++) {
        total += offsets[patches + g];
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
    for (var g = first; g < end; g++) {
        let total = offsets[patches + g];
        offsets[patches + g] = at;
        at += total;
    }
    // Lane 0 reads the offsets that every lane wrote.
    storageBarrier();
    workgroupBarrier();
    if (lane != 0u || meshes == 0u) {
        return;
    }
    // The scene's total, and each mesh's draw: where its patches start in the list and how many
    // indices they took. A mesh that the culling pass drew nothing of draws nothing, and a draw
    // stops where the view's list ends.
    let whole = sums[WORKGROUP_SIZE - 1u];
    let capacity = params.records.y;
    for (var m = 0u; m < meshes; m++) {
        let mesh = mesh_of(m);
        if (mesh.slot == NOT_DRAWN) {
            continue;
        }
        let start = patch_offset(mesh.first_patch);
        var finish = whole;
        if (m + 1u < meshes) {
            finish = patch_offset(mesh_of(m + 1u).first_patch);
        }
        finish = min(finish, capacity);
        // The culling pass counts the mesh's copy in the layout's draw, and the view's own draws
        // hold one draw a tree, in the trees' order, where the passes that draw the tree read it.
        let drawn = indirect[(params.counts.w + mesh.first_draw) * INDIRECT_WORDS + 1u];
        let at = m * INDIRECT_WORDS;
        draws[at] = select(0u, finish - min(start, finish), drawn > 0u);
        draws[at + 1u] = select(0u, 1u, drawn > 0u);
        draws[at + 2u] = start;
        draws[at + 3u] = mesh.base_vertex;
        draws[at + 4u] = 0u;
    }
}

/// The copy stage: each drawn patch's indices, copied into the view's list at its offset. One lane
/// finds the offset, which every lane reads.
fn copy_patch(at: u32, lane: u32) {
    if (at >= params.counts.y) {
        return;
    }
    if (lane == 0u) {
        copy_count = runs[at];
    }
    let count = workgroupUniformLoad(&copy_count);
    if (count == 0u) {
        return;
    }
    if (lane == 0u) {
        copy_at = patch_offset(at);
    }
    let out = workgroupUniformLoad(&copy_at);
    let record = patch_of(at);
    // The list's capacity bounds the copy, so a view whose patches outgrow its list loses the last
    // of them rather than writes past it.
    let end = min(count, params.records.y - min(out, params.records.y));
    for (var k = lane; k < end; k += WORKGROUP_SIZE) {
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
        count_patch(id.x, lane, group.x);
    } else if (stage == 1u) {
        scan_patches(lane);
    } else {
        copy_patch(group.x, lane);
    }
}
