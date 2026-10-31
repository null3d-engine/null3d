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
// Each copy also holds its instance's index, where the vertex shaders of rows with row values find
// them.
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
// Skinned objects whose vertex shaders skin them share a bucket by mesh and material, as a crowd
// of one model draws in one instanced draw per part. Their bucket's first joint is
// PER_SOURCE_JOINT, and each copy takes the first joint of its own object's skin from the skin
// firsts texture, at the object's source, laid out as the index textures are. The texture keeps
// the culling group within the eight storage buffers that every device allows a shader stage.
//
// A bucket of a mesh with levels of detail links to the bucket of its next coarser level, and each
// level's bucket holds the level's switch measure: its error in the units of the base mesh, a
// distance in meters at scale 1, or a share of the render's height that the bounds cover. An
// instance's entry names its base level's bucket. The thread walks the links while the next
// level's switch distance stays under its distance from the main camera to the nearest point of
// its bounding sphere, and appends the instance to the last level that passes. Every view places its instances relative to the main camera, shadow views
// too, so they all pick by its distance. Past each switch distance lies a band in which the level
// before still draws: there, the instance goes to both levels' fade buckets, whose pipelines dither
// each pixel to one of them, and the copy's fourth id holds the fade value, positive for the new
// level and negative for the old. A link of 0 means none, so a bucket record without levels holds
// zeros there, and a view whose level factor is 0 draws every instance's base level.
//
// An instance of a mesh with levels whose bounding sphere covers fewer pixels than the threshold
// draws nothing: the last level holds no geometry. The sphere's world diameter times the level
// factor measures the pixels it covers, so it hides while that product stays under its distance,
// the same comparison that picks the levels. A mesh without levels has no such last level, so it
// draws at every distance. Past the hide distance a band thins the coarsest level out with the
// same dither, where a fading build exists, so the instance does not pop away.
//
// An instance tests the local sphere of its bucket, scaled by its own matrix, unless its source
// gives a radius of its own: a batch whose vertex shader carries rows away from their origins sets
// one, and every row then tests a sphere of that radius around its origin. The ranges texture holds
// it beside the row's distance range.
//
// An instance also draws only inside its distance range, which the ranges texture holds for each
// source as a start distance and an end distance. Both edges lie inside the range and fade over
// the same band, through the fading build of the level that the instance would draw.
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
//
// The MOTION build culls the motion view: the camera's view of the motion layout, whose buckets
// draw each moving object's motion (decision record D-140). It reads the last frame's matrices
// where the pyramid sits, and keeps an instance in view only when its matrix changed since the
// last frame, or when its bucket moves by itself, as skinned meshes and swaying materials do. Each
// copy holds the last frame's matrix after the ids, both moved by the cell's offset, 112 bytes in
// all. An instance that changed grid cells keeps a last matrix relative to the old cell's center:
// the move of whole cells that brings it nearest to the new matrix puts it right. An instance draws
// its motion with the level of detail that the camera's view picks, without the fading band.

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
/// The smallest distance that the level rule compares, in meters. A camera inside an instance's
/// bounds measures this distance, so the instance keeps its base level.
const LEAST_DISTANCE: f32 = 1.0e-3;

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
    /// What the level choice reads: the level factor (0 for none), 1 for an orthographic camera,
    /// whose distance counts as 1, the share of a switch distance that a fading band covers, and
    /// the projection's P[1][1].
    levels: vec4f,
    /// The first word is 1 while the levels debug view draws, whose copies carry each source's
    /// level code in place of the fade value. The rest are spare.
    debug: vec4u,
    /// Each run: its first position in the cell order, its end, and its first workgroup.
    ranges: array<vec4u, MAX_RANGES>,
    /// What the occlusion phases read. Other views leave it unset.
    occlusion: Occlusion,
}

/// A bucket: one pipeline, mesh and material, with its slice of the compacted instance buffer and
/// its indirect draws, one per part of the mesh, from `first_draw` on. Its instances are culled
/// with the local sphere of `radius` around `center_x`, `center_y` and `center_z`. A bucket of
/// skinned objects names the first joint of their skin, which the vertex shaders that skin read
/// beside the material, or PER_SOURCE_JOINT, which sends each copy to its own. A bucket with
/// `indices` 1 writes each survivor's index instead, one entry each, from entry `base` on. In the
/// motion layout, whose buckets never read by index, `indices` 1 marks a bucket whose instances
/// move by themselves.
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
    /// The switch value of the bucket's level of detail: its error, its distance or its screen
    /// coverage, as `level_switch` says. 0 for a base level.
    value: f32,
    /// The bucket of the next coarser level plus one, or 0 for none.
    next: u32,
    /// The fade bucket of the bucket's level plus one, or 0 for none.
    fade: u32,
    /// The threshold bias that picks the bucket's levels: 1 for the quality settings' threshold,
    /// above 1 for a coarser level, and below 1 for a finer one. A record that holds no level
    /// keeps 0, which counts as 1.
    bias: f32,
    /// What the switch value measures: the level's error, a distance, or a share of the screen's
    /// height.
    level_switch: u32,
    /// The level of detail that the bucket draws, from 0, which the levels debug view writes
    /// beside each copy.
    level: u32,
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
#ifdef MOTION
/// The last frame's world matrices, three rows per instance, as `matrices` holds this frame's. The
/// binding is the pyramid's, which the motion view never reads.
@group(0) @binding(8) var<storage, read_write> previous: array<vec4f>;
#else
/// The view's depth pyramid, which only the occlusion phases bind: the count of the frame's
/// occluders, then the levels' depths as the bits of 32-bit floats.
@group(0) @binding(8) var<storage, read_write> pyramid: array<atomic<u32>>;
#endif
/// The offset from each view's camera to the center of each grid cell: texel x of row y holds
/// cell x's offset for the view whose row is y.
@group(0) @binding(9) var cell_offsets: texture_2d<f32>;

/// Each source's distance range and own radius: texel x of row y holds source y * a row's width
/// plus x's start distance and end distance, its own local radius, which scales by the instance's
/// matrix as its bounding sphere, and a word that nothing reads. A source without a range holds 0
/// and infinity, and a source without a radius of its own holds 0, which keeps its bucket's sphere.
@group(0) @binding(11) var instance_ranges: texture_2d<f32>;

/// What a level's switch value measures: its error in the mesh's units, a distance in meters for a
/// source of scale 1, or the share of the render's height that the source's bounds cover.
const SWITCH_ERROR: u32 = 0u;
const SWITCH_DISTANCE: u32 = 1u;
const SWITCH_COVERAGE: u32 = 2u;

/// The first joint of each source that a bucket of skinned objects shares: texel x of row y holds
/// source y << INDEX_ROW_SHIFT | x's.
@group(0) @binding(10) var skin_firsts: texture_2d<u32>;

/// The bucket of an instance that draws nowhere.
const HIDDEN: u32 = 0xffffffffu;

/// The bits of a level code, which the levels debug view reads in place of a copy's fade value:
/// the level in the lowest bits, a mark for a source that the size rule or a draw range hid, the
/// share of a fading band that the level keeps, and the sign that names the band's side. The
/// levels view's shader reads the same bits.
const LEVEL_CODE_LEVEL_MAX: u32 = 7u;
const LEVEL_CODE_HIDDEN: u32 = 1u << 3u;
const LEVEL_CODE_FADE_SHIFT: u32 = 4u;
const LEVEL_CODE_FADE_MAX: u32 = 63u;
const LEVEL_CODE_NEGATIVE: u32 = 1u << 10u;

/// The code of a draw at level `level`, of a source that `hidden` hides, at fade `fade`.
fn level_code(level: u32, hidden: bool, fade: f32) -> u32 {
    let share = u32(round(clamp(abs(fade), 0.0, 1.0) * f32(LEVEL_CODE_FADE_MAX)));
    return (level & LEVEL_CODE_LEVEL_MAX)
        | select(0u, LEVEL_CODE_HIDDEN, hidden)
        | (share << LEVEL_CODE_FADE_SHIFT)
        | select(0u, LEVEL_CODE_NEGATIVE, fade < 0.0);
}
/// A bucket's first joint that sends each copy to its source's own in `skin_firsts`.
const PER_SOURCE_JOINT: u32 = 0xffffffffu;
/// Sources per row of the skin firsts texture are 1 << INDEX_ROW_SHIFT.
const INDEX_ROW_SHIFT: u32 = 11u;
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

/// The ranges texture's texel of the source `index`: its distance range's start and end in x and
/// y, its own local radius in z, and a word that nothing reads.
fn ranges_of(index: u32) -> vec4f {
    let row = (1u << 11u) - 1u;
    return textureLoad(instance_ranges, vec2u(index & row, index >> 11u), 0);
}

/// An instance in the view: its bucket and its own index, whether the sketch marks it as an
/// occluder, its matrix moved by its cell's offset, its bounding sphere relative to the camera, and
/// the texel that holds its distance range. The bucket is `HIDDEN` for an instance that draws
/// nowhere in the view: hidden, on none of the view's layers, or outside the frustum.
struct Survivor {
    bucket: u32,
    index: u32,
    occluder: bool,
    r0: vec4f,
    r1: vec4f,
    r2: vec4f,
    center: vec3f,
    radius: f32,
    /// The largest axis scale of the instance's world matrix.
    scale: f32,
    /// The source's distance range and own local radius (see `ranges_of`).
    ranges: vec4f,
}

/// Instance `i`, tested against the view's layers and frustum.
fn survivor(i: u32) -> Survivor {
    var out: Survivor;
    out.bucket = HIDDEN;
    out.index = i;
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
    // A row that carries a bound of its own, as a batch whose vertex shader moves its rows does,
    // tests that bound; a row without one tests its bucket's local sphere.
    out.ranges = ranges_of(i);
    let own = out.ranges.z;
    out.radius = select(bucket.radius * scale, own * scale, own > 0.0);
    out.scale = scale;
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if dot(plane.xyz, out.center) + plane.w < -out.radius {
            return out;
        }
    }
    out.bucket = b;
    return out;
}

/// The distance at which a level with `bucket` switches in, for an instance of largest axis scale
/// `scale` and world radius `radius`, at the view's factor `factor` and threshold `bias`.
fn switch_distance(bucket: Bucket, scale: f32, radius: f32, factor: f32, bias: f32) -> f32 {
    if bucket.level_switch == SWITCH_DISTANCE {
        return bucket.value * scale / bias;
    }
    if bucket.level_switch == SWITCH_COVERAGE {
        // The bounds cover a share of the render's height while radius × P[1][1] / coverage
        // exceeds the distance from the camera.
        let p11 = params.levels.w;
        if bucket.value <= 0.0 || p11 <= 0.0 {
            return 1e38;
        }
        return radius * p11 / (bucket.value * bias);
    }
    return bucket.value * scale * factor;
}

/// The level of detail that an instance in view draws: its bucket, the bucket of the level before
/// it, how far past the level's switch distance the instance lies, as a share of that distance,
/// how far past the hide distance it lies, as a share of the hide distance, whether its bounds
/// cover fewer pixels than the threshold or lie outside its distance range, where nothing draws,
/// and the distances the range reads.
struct Level {
    bucket: u32,
    before: u32,
    past: f32,
    hide_past: f32,
    hidden: bool,
    distance: f32,
    start: f32,
    end: f32,
}

/// The level of detail that an instance in view draws, its base level where the view picks none.
fn level_of(s: Survivor) -> Level {
    var out = Level(s.bucket, s.bucket, 0.0, 0.0, false, 0.0, s.ranges.x, s.ranges.y);
    let whole = params.levels.x;
    let bias = select(1.0, buckets[s.bucket].bias, buckets[s.bucket].bias > 0.0);
    let factor = whole / bias;
    let nearest = max(length(s.center) - s.radius, LEAST_DISTANCE);
    let distance = select(nearest, 1.0, params.levels.y > 0.5);
    out.distance = distance;
    var next = buckets[s.bucket].next;
    if next != 0u && whole > 0.0 {
        while next != 0u && switch_distance(buckets[next - 1u], s.scale, s.radius, factor, bias) < distance {
            out.before = out.bucket;
            out.bucket = next - 1u;
            next = buckets[out.bucket].next;
        }
        if out.bucket != s.bucket {
            out.past = distance / switch_distance(buckets[out.bucket], s.scale, s.radius, factor, bias) - 1.0;
        }
    }
    // A bound that covers fewer pixels than the threshold draws nothing: the last level holds no
    // geometry. Only a mesh with levels has that last level, so a bucket with no coarser level
    // keeps drawing at every distance. The view's level factor also carries the render height,
    // the render scale and the threshold, so all of them move the hide distance.
    let hide = 2.0 * s.radius * factor;
    let small = buckets[s.bucket].next != 0u && hide > 0.0 && hide < distance;
    out.hidden = small || distance < out.start || distance > out.end;
    if small {
        out.hide_past = distance / hide - 1.0;
    }
    return out;
}

/// Appends an instance in the view to the bucket of the level of detail it draws, and to the fade
/// buckets of two levels inside a fading band. An instance that hides draws nothing, apart from the
/// share of the pixels a fading level keeps as it thins the instance out. The draws start
/// `draws_before` draws into the indirect draws.
fn append(s: Survivor, level: Level, draws_before: u32) {
    let band = params.levels.z;
    let new_fade = buckets[level.bucket].fade;
    let old_fade = buckets[level.before].fade;
    let debug = params.debug.x != 0u;
    // A source outside its distance range draws nothing, apart from the mark that the levels
    // debug view draws at its base level.
    if level.distance < level.start || level.distance > level.end {
        if debug {
            append_to(s, s.bucket, draws_before, 0.0, true);
        }
        return;
    }
    // Inside each edge of it, the share of the pixels that the dither keeps grows to one, or falls
    // to none, through the fading build of the level that the source would draw.
    if band > 0.0 && new_fade != 0u {
        if level.start > 0.0 && level.distance < level.start * (1.0 + band) {
            let t = (level.distance / level.start - 1.0) / band;
            append_to(s, new_fade - 1u, draws_before, max(t, 1e-6), false);
            return;
        }
        if level.distance > level.end / (1.0 + band) {
            let inner = level.end / (1.0 + band);
            let t = (level.distance - inner) / (level.end - inner);
            append_to(s, new_fade - 1u, draws_before, -max(t, 0.0), false);
            return;
        }
    }
    if level.bucket != s.bucket && band > 0.0 && new_fade != 0u && old_fade != 0u {
        let t = level.past / band;
        if t < 1.0 {
            append_to(s, new_fade - 1u, draws_before, max(t, 1e-6), false);
            append_to(s, old_fade - 1u, draws_before, -max(t, 0.0), false);
            return;
        }
    }
    if level.hidden {
        if band > 0.0 && new_fade != 0u && level.hide_past < band {
            append_to(s, new_fade - 1u, draws_before, -max(level.hide_past / band, 0.0), false);
        } else if debug {
            // The size rule hides the source, or its bounds cover fewer pixels than the
            // threshold: the levels view draws its base level marked as hidden.
            append_to(s, s.bucket, draws_before, 0.0, true);
        }
        return;
    }
    append_to(s, level.bucket, draws_before, 0.0, false);
}

/// Appends an instance in the view to bucket `b`'s slice with the fade value `fade`, and counts it
/// in each of the bucket's draws, which start `draws_before` draws into the indirect draws. A
/// source that `hidden` marks, and every source while the levels debug view draws, carries the
/// level code that the view's shader reads in place of the fade value.
fn append_to(s: Survivor, b: u32, draws_before: u32, fade: f32, hidden: bool) {
    let bucket = buckets[b];
    let first = (draws_before + bucket.first_draw) * INDIRECT_WORDS + 1u;
    let slot = atomicAdd(&indirect[first], 1u);
    for (var d = 1u; d < bucket.draws; d++) {
        atomicAdd(&indirect[first + d * INDIRECT_WORDS], 1u);
    }
    if bucket.indices != 0u {
        visible[bucket.base + slot] = vec4u(s.index, bitcast<u32>(fade), 0u, 0u);
        return;
    }
    var first_joint = bucket.first_joint;
    if first_joint == PER_SOURCE_JOINT {
        let row = (1u << INDEX_ROW_SHIFT) - 1u;
        first_joint = textureLoad(skin_firsts, vec2u(s.index & row, s.index >> INDEX_ROW_SHIFT), 0).x;
    }
    let dst = (bucket.base + slot) * 4u;
    visible[dst] = bitcast<vec4u>(s.r0);
    visible[dst + 1u] = bitcast<vec4u>(s.r1);
    visible[dst + 2u] = bitcast<vec4u>(s.r2);
    var fourth = bitcast<u32>(fade);
    if params.debug.x != 0u {
        fourth = level_code(bucket.level, hidden, fade);
    }
    visible[dst + 3u] = vec4u(bucket.material, first_joint, s.index, fourth);
}

#ifdef MOTION
/// The width of a grid cell in meters.
const CELL_SIZE: f32 = 1024.0;

/// The last frame's row `k` of instance `i`, moved by whole cells to the cell of `now`, this
/// frame's row, and by the cell's `offset` from the camera.
fn previous_row(i: u32, k: u32, now: vec4f, offset: f32) -> vec4f {
    var row = previous[i * 3u + k];
    row.w += CELL_SIZE * round((now.w - row.w) / CELL_SIZE) + offset;
    return row;
}

/// Culls the motion view: keeps each instance in view that moved since the last frame, or whose
/// bucket moves by itself, with both its matrices.
@compute @workgroup_size(128)
fn main(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    if i == NONE {
        return;
    }
    let s = survivor(i);
    if s.bucket == HIDDEN {
        return;
    }
    let level = level_of(s);
    // An instance that hides draws no pixels, so it draws no motion either.
    if level.hidden {
        return;
    }
    let bucket = buckets[level.bucket];
    let now = array<vec4f, 3>(matrices[i * 3u], matrices[i * 3u + 1u], matrices[i * 3u + 2u]);
    let last = array<vec4f, 3>(previous[i * 3u], previous[i * 3u + 1u], previous[i * 3u + 2u]);
    let still = all(now[0] == last[0]) && all(now[1] == last[1]) && all(now[2] == last[2]);
    if still && bucket.indices == 0u {
        return;
    }
    let offset = vec3f(s.r0.w - now[0].w, s.r1.w - now[1].w, s.r2.w - now[2].w);
    let first = bucket.first_draw * INDIRECT_WORDS + 1u;
    let slot = atomicAdd(&indirect[first], 1u);
    for (var d = 1u; d < bucket.draws; d++) {
        atomicAdd(&indirect[first + d * INDIRECT_WORDS], 1u);
    }
    let dst = (bucket.base + slot) * 7u;
    visible[dst] = bitcast<vec4u>(s.r0);
    visible[dst + 1u] = bitcast<vec4u>(s.r1);
    visible[dst + 2u] = bitcast<vec4u>(s.r2);
    // A bucket of skinned copies sends each copy to its own skin in `skin_firsts`. The motion pass
    // reads the first joint from this record, as every other pass does.
    var first_joint = bucket.first_joint;
    if first_joint == PER_SOURCE_JOINT {
        let row = (1u << INDEX_ROW_SHIFT) - 1u;
        first_joint = textureLoad(skin_firsts, vec2u(s.index & row, s.index >> INDEX_ROW_SHIFT), 0).x;
    }
    visible[dst + 3u] = vec4u(bucket.material, first_joint, s.index, 0u);
    visible[dst + 4u] = bitcast<vec4u>(previous_row(i, 0u, now[0], offset.x));
    visible[dst + 5u] = bitcast<vec4u>(previous_row(i, 1u, now[1], offset.y));
    visible[dst + 6u] = bitcast<vec4u>(previous_row(i, 2u, now[2], offset.z));
}

#else ifndef OCCLUSION
/// Culls once, against the frustum alone, into the first set of indirect draws, or for a camera
/// view that culls in two phases, in a frame without marked occluders, into its second set.
@compute @workgroup_size(128)
fn main(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    if i == NONE {
        return;
    }
    let s = survivor(i);
    if s.bucket != HIDDEN {
        append(s, level_of(s), params.occlusion.info.y);
    }
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
    if i == NONE || atomicLoad(&indirect[params.occlusion.info.z + i]) == 0u {
        return;
    }
    let s = survivor(i);
    if s.bucket == HIDDEN || !s.occluder {
        return;
    }
    let level = level_of(s);
    // A bound that covers fewer pixels than the threshold draws no depth, so it cannot hide others.
    if level.hidden {
        return;
    }
    // A sphere that reaches the camera's plane covers much of the screen.
    let bounds = screen_bounds(s.center, s.radius);
    let span = max(bounds.high.x - bounds.low.x, bounds.high.y - bounds.low.y);
    if bounds.valid && span < f32(params.occlusion.info.w) {
        return;
    }
    atomicAdd(&pyramid[0], 1u);
    append(s, level, 0u);
}

/// The second occlusion phase: tests every instance in view against the depth pyramid, keeps
/// whether it is visible as its history, and appends the visible ones to the second set of draws.
@compute @workgroup_size(128)
fn late(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let i = instance_of(group.x, lane);
    if i == NONE {
        return;
    }
    let s = survivor(i);
    if s.bucket == HIDDEN {
        atomicStore(&indirect[params.occlusion.info.z + i], 0u);
        return;
    }
    let level = level_of(s);
    // A hidden instance draws nothing, so its history says it did not draw.
    let seen = !level.hidden && !occluded(s.center, s.radius);
    atomicStore(&indirect[params.occlusion.info.z + i], select(0u, 1u, seen));
    if seen {
        append(s, level, params.occlusion.info.y);
    }
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
