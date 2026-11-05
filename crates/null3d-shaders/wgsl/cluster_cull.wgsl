// Cluster levels: the pass that picks the patches of a tree of cluster patches that a view draws,
// and copies their indices into the view's own list, so one indirect draw draws them all. A
// camera's view picks by its pixels, and a shadow view by its map's texels.
//
// The GROUPS build draws the groups of the slots instead (see the end of this file): a slot is one
// copy's level, whose 64 to 128-triangle groups the pass culls and packs into the view's list.
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

#ifndef GROUPS
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
#else
// Slots: each slot is one copy's level, and the pass culls the level's groups for that one copy and
// packs the kept groups' indices into the view's own list, so one indirect draw draws the slot. The
// level's pieces and groups keep a mesh's triangles in small patches that face about one way, so a
// slot draws only the patches that reach into the view and face the eye.
//
// Three dispatches of one pipeline fill the view's list, which the dispatch's parameters pick:
// - stage 0, count: a thread a group. The thread finds its slot's copy, tests the group's piece and
//   then the group against the view's six planes, the cone where it holds, and writes the group's
//   run of indices, or 0. A group is tested only where its piece passes, so the groups that draw
//   lie inside the pieces that the CPU sized the slot's room for.
// - stage 1, scan: one workgroup a slot adds its groups' runs up into each group's offset in the
//   slot's room, and writes the slot's indirect draw.
// - stage 2, copy: a workgroup copies the indices of a run of a slot's groups. Each index takes
//   its part's base vertex, so the slot draws with one draw whatever parts its level has.
//
// The slot's room in the view's list is fixed for the frame, so the scan needs no other slot's
// total, and a slot that outgrows it loses the runs past its room rather than writes past it.

/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 64u;
/// The words of each slot's record in the table, each group's, each piece's and each part's.
const SLOT_WORDS: u32 = 12u;
const GROUP_WORDS: u32 = 12u;
const PIECE_WORDS: u32 = 8u;
const PART_WORDS: u32 = 4u;
/// The words of one copy in the view's compacted instances, as the culling pass writes them.
const COPY_WORDS: u32 = 4u;
/// The words of one indexed indirect draw.
const INDIRECT_WORDS: u32 = 5u;
/// The groups that one copying workgroup takes.
const COPY_GROUPS: u32 = 64u;
/// How much wider than its cutoff a cone counts, as a share of the distance to its sphere, and how
/// far a copy's matrix may stretch for its groups to take the cone test. The culling shader and the
/// CPU paths keep the same values.
const CONE_MARGIN: f32 = 1.0e-3;
const SIMILAR_TOLERANCE: f32 = 1.0e-4;

/// The pass's parameters. The count stage reads the groups, the scan and copy stages a slot.
struct Params {
    /// The view's six frustum planes, relative to its camera.
    planes: array<vec4f, 6>,
    /// The stage, the groups of every slot, the slots, and a spare.
    counts: vec4u,
    /// The groups that one copying workgroup takes, and three spares.
    levels: vec4u,
    /// Spare.
    measure: vec4f,
    /// The table's first slot, group, piece and part, as places in the table's words, four to a
    /// place.
    records: vec4u,
}

@group(0) @binding(0) var<uniform> params: Params;
/// The slots' records, then the groups', the pieces' and the parts'.
@group(0) @binding(1) var<storage, read> tables: array<vec4u>;
/// The indices of the page that the slots draw from, in place: two 16-bit indices to a word, the
/// lower one first.
@group(0) @binding(2) var<storage, read> page_indices: array<u32>;
/// The view's compacted instances, four entries a copy.
@group(0) @binding(3) var<storage, read> visible: array<vec4u>;
/// The view's indirect draws, whose instance counts the culling pass wrote.
@group(0) @binding(4) var<storage, read> indirect: array<u32>;
/// Each group's run of indices that draws for its slot, or 0.
@group(0) @binding(5) var<storage, read_write> runs: array<u32>;
/// Each group's place in its slot's room, from the slot's first word of the runs' words.
@group(0) @binding(6) var<storage, read_write> offsets: array<u32>;
/// The view's list of indices, which the view's slot draws read.
@group(0) @binding(7) var<storage, read_write> list: array<u32>;
/// Each slot's indirect draw, in the slots' order: its index count, an instance, its first index in
/// the list, a base vertex of 0, and a spare.
@group(0) @binding(8) var<storage, read_write> draws: array<u32>;

/// The workgroup's runs in the scan.
var<workgroup> sums: array<u32, WORKGROUP_SIZE>;

/// A slot's record: where its copy's matrix lies, the word that counts its copies, its room in the
/// view's list, its level's groups and parts, and the first of its runs.
struct Slot {
    copy: u32,
    occupancy: u32,
    room: u32,
    capacity: u32,
    group_first: u32,
    group_count: u32,
    part_first: u32,
    part_count: u32,
    runs_base: u32,
}

/// A group's record: its first index in the page, its triangles, its piece, and its bounds.
struct Group {
    first: u32,
    triangles: u32,
    piece: u32,
    spare: u32,
    sphere: vec4f,
    cone: vec4f,
}

/// Slot `index`'s record.
fn slot_of(index: u32) -> Slot {
    let at = params.records.x + index * (SLOT_WORDS / 4u);
    let a = tables[at];
    let b = tables[at + 1u];
    let c = tables[at + 2u];
    return Slot(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, c.x);
}

/// Group `index`'s record.
fn group_of(index: u32) -> Group {
    let at = params.records.y + index * (GROUP_WORDS / 4u);
    let a = tables[at];
    return Group(a.x, a.y, a.z, a.w, bitcast<vec4f>(tables[at + 1u]), bitcast<vec4f>(tables[at + 2u]));
}/// A piece's or a group's bounds: the sphere around it, and the cone of its facings.
struct Bounds {
    sphere: vec4f,
    cone: vec4f,
}

/// Piece `index`'s bounds.
fn piece_of(index: u32) -> Bounds {
    let at = params.records.z + index * (PIECE_WORDS / 4u);
    return Bounds(bitcast<vec4f>(tables[at]), bitcast<vec4f>(tables[at + 1u]));
}

/// Part `index`'s first index in the page, its indices and its base vertex.
fn part_of(index: u32) -> vec4u {
    return tables[params.records.w + index * (PART_WORDS / 4u)];
}

/// The page's index `at`, which the page holds two to a word.
fn index_at(at: u32) -> u32 {
    let word = page_indices[at >> 1u];
    return select(word >> 16u, word & 0xffffu, (at & 1u) == 0u);
}

/// A sphere's place under the rows `m0`, `m1` and `m2` of a copy's world matrix, whose largest
/// axis scale is `scale`: its centre relative to the view's camera, then its radius.
fn placed(sphere: vec4f, m0: vec4f, m1: vec4f, m2: vec4f, scale: f32) -> vec4f {
    let local = vec4f(sphere.xyz, 1.0);
    return vec4f(dot(m0, local), dot(m1, local), dot(m2, local), sphere.w * scale);
}

/// The largest axis scale of the copy whose rows are `m0`, `m1` and `m2`.
fn scale_of(m0: vec4f, m1: vec4f, m2: vec4f) -> f32 {
    return max(
        length(vec3f(m0.x, m1.x, m2.x)),
        max(length(vec3f(m0.y, m1.y, m2.y)), length(vec3f(m0.z, m1.z, m2.z))),
    );
}

/// True when the copy's matrix keeps angles: a turn and the same positive scale on each axis, so
/// that it turns its groups' cones as it turns their facings.
fn keeps_angles(m0: vec4f, m1: vec4f, m2: vec4f, scale: f32) -> bool {
    let c0 = vec3f(m0.x, m1.x, m2.x);
    let c1 = vec3f(m0.y, m1.y, m2.y);
    let c2 = vec3f(m0.z, m1.z, m2.z);
    let lengths = vec3f(length(c0), length(c1), length(c2));
    let least = min(lengths.x, min(lengths.y, lengths.z));
    let square = SIMILAR_TOLERANCE * scale * scale;
    return least > 0.0
        && scale - least <= SIMILAR_TOLERANCE * scale
        && abs(dot(c0, c1)) <= square
        && abs(dot(c0, c2)) <= square
        && abs(dot(c1, c2)) <= square
        && dot(cross(c0, c1), c2) > 0.0;
}

/// True when a placed sphere reaches into the view's frustum.
fn in_view(place: vec4f) -> bool {
    for (var k = 0u; k < 6u; k++) {
        let plane = params.planes[k];
        if dot(plane.xyz, place.xyz) + plane.w < -place.w {
            return false;
        }
    }
    return true;
}

/// True when every triangle within `cone`, turned by a copy that keeps angles where `similar` says,
/// faces away from the eye at the placed sphere.
fn faces_away(place: vec4f, cone: vec4f, similar: bool, m0: vec4f, m1: vec4f, m2: vec4f) -> bool {
    if !similar || cone.w >= 1.0 {
        return false;
    }
    let turned = vec3f(dot(m0.xyz, cone.xyz), dot(m1.xyz, cone.xyz), dot(m2.xyz, cone.xyz));
    let reach = length(turned);
    if reach <= 0.0 {
        return false;
    }
    return dot(place.xyz, turned) / reach >= (cone.w + CONE_MARGIN) * length(place.xyz) + place.w;
}

/// True when the bounds `sphere` and `cone` of a group or a piece may draw for the copy whose rows
/// are `m0`, `m1` and `m2`, whose largest axis scale is `scale` and whose angles `similar` says it
/// keeps.
fn bounds_show(
    sphere: vec4f,
    cone: vec4f,
    m0: vec4f,
    m1: vec4f,
    m2: vec4f,
    scale: f32,
    similar: bool,
) -> bool {
    let place = placed(sphere, m0, m1, m2, scale);
    return in_view(place) && !faces_away(place, cone, similar, m0, m1, m2);
}

/// The count stage: the indices that one of a slot's groups draws, or 0 where the slot holds no
/// copy, the group's piece is outside the view or faces away, or the group itself does.
fn count_group(at: u32, slot_index: u32) {
    if (slot_index >= params.counts.z) {
        return;
    }
    let slot = slot_of(slot_index);
    if (at >= slot.group_count) {
        return;
    }
    var run = 0u;
    let record = group_of(slot.group_first + at);
    // A slot whose copy the culling pass did not place draws nothing: the copy picked another
    // level, and it draws through its pieces.
    if indirect[slot.occupancy] > 0u {
        let m0 = bitcast<vec4f>(visible[slot.copy]);
        let m1 = bitcast<vec4f>(visible[slot.copy + 1u]);
        let m2 = bitcast<vec4f>(visible[slot.copy + 2u]);
        let scale = scale_of(m0, m1, m2);
        let similar = keeps_angles(m0, m1, m2, scale);
        let piece = piece_of(record.piece);
        if bounds_show(piece.sphere, piece.cone, m0, m1, m2, scale, similar)
            && bounds_show(record.sphere, record.cone, m0, m1, m2, scale, similar) {
            run = record.triangles * 3u;
        }
    }
    runs[slot.runs_base + at] = run;
}

/// The scan stage: each slot's groups added up into their places in the slot's room, and the slot's
/// indirect draw from their total, kept within the room.
fn scan_slot(slot_index: u32, lane: u32) {
    if (slot_index >= params.counts.z) {
        return;
    }
    let slot = slot_of(slot_index);
    let count = slot.group_count;
    // This lane's run of groups, a share of them each.
    let share = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    let first = lane * share;
    let end = min(first + share, count);
    var total = 0u;
    for (var k = first; k < end; k++) {
        total += runs[slot.runs_base + k];
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
    for (var k = first; k < end; k++) {
        let run = runs[slot.runs_base + k];
        offsets[slot.runs_base + k] = at;
        at += run;
    }
    // Lane 0 reads the offsets that every lane wrote.
    storageBarrier();
    workgroupBarrier();
    if (lane != 0u) {
        return;
    }
    let whole = sums[WORKGROUP_SIZE - 1u];
    let written = min(whole, slot.capacity);
    let at_draw = slot_index * INDIRECT_WORDS;
    draws[at_draw] = written;
    draws[at_draw + 1u] = select(0u, 1u, written > 0u);
    draws[at_draw + 2u] = slot.room;
    draws[at_draw + 3u] = 0u;
    draws[at_draw + 4u] = 0u;
}

/// The copy stage: the indices of a run of a slot's groups, each with its part's base vertex, into
/// the slot's room. The list's room bounds the copy, so a slot that outgrows it loses the runs past
/// it rather than writes past it.
fn copy_slot(chunk: u32, slot_index: u32, lane: u32) {
    if (slot_index >= params.counts.z) {
        return;
    }
    let slot = slot_of(slot_index);
    let first = chunk * COPY_GROUPS;
    if (first >= slot.group_count) {
        return;
    }
    let end = min(first + COPY_GROUPS, slot.group_count);
    for (var k = first; k < end; k++) {
        let run = runs[slot.runs_base + k];
        if (run == 0u) {
            continue;
        }
        let offset = offsets[slot.runs_base + k];
        let room = slot.capacity - min(offset, slot.capacity);
        let count = min(run, room);
        if (count == 0u) {
            continue;
        }
        let group = group_of(slot.group_first + k);
        let start = group.first;
        let finish = start + count;
        let out = slot.room + offset;
        // A group holds the triangles of one run of the page's indices, which may cross from one
        // part of the level into the next. Each part's share of the run takes the part's base
        // vertex.
        for (var p = slot.part_first; p < slot.part_first + slot.part_count; p++) {
            let part = part_of(p);
            let low = max(start, part.x);
            let high = min(finish, part.x + part.y);
            if (high <= low) {
                continue;
            }
            for (var i = low + lane; i < high; i += WORKGROUP_SIZE) {
                list[out + (i - start)] = index_at(i) + part.z;
            }
        }
    }
}

/// One dispatch of the slot pass. Its parameters name the stage, which is the same for every thread
/// of the dispatch.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
    @builtin(global_invocation_id) id: vec3u,
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let stage = params.counts.x;
    if (stage == 0u) {
        count_group(id.x, id.y);
    } else if (stage == 1u) {
        scan_slot(group.x, lane);
    } else {
        copy_slot(group.x, group.y, lane);
    }
}
#endif
