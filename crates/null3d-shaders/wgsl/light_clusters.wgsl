// Light clustering on the GPU: lists each cluster's point and spot lights in the light grid that
// fragment shaders read (see lib/lights.wgsl). The CPU picks the frame's lights, cuts the camera's
// view into slices along it and tiles across it, and uploads the light list with the parameters
// below. Three dispatches in one compute pass then fill the grid, as the job workers do on WebGL2,
// with the same tests in the same order, so both paths list the same lights:
//
// - `count_lights`: each cluster's word gets the number of lights that reach the cluster.
// - `place_lights`: one workgroup adds up the counts, each at most the cap of one cluster and in all at
//   most the index list's room, and gives each cluster's word where its lights start in the grid
//   and how many it keeps.
// - `write_lights`: each cluster writes the indices of the lights it keeps, in the light list's order.
//
// `count_lights` and `write_lights` run one workgroup per slice and run of tiles. A light reaches a rectangle
// of the tiles of each slice. The workgroup's threads find the rectangles of a run of lights
// together, one light each, and then each thread tests its own tile against all of them.
//
// The tile rectangle of a light in a slice: the part of the light's sphere between the slice's
// bounds, a sphere around that part, and the planes between the tiles that sphere reaches. The
// arithmetic matches the CPU's step by step (the render crate's light_grid.rs `rect`), and keeps
// to the operations that WGSL rounds as the CPU does.

/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 128u;
/// Bits of a cluster's word that hold where its lights start in the light grid.
const START_BITS: u32 = 23u;
/// The most planes between tiles that the parameters hold. They hold the bounds of 32 slices.
const MAX_PLANES: u32 = 32u;
/// A tile rectangle that holds no tile.
const NO_TILES: u32 = 0xffffffffu;

struct ClusterParams {
    /// Tiles across, tiles up, slices, and the lights of the light list.
    shape: vec4u,
    /// The most lights of one cluster, the entries of the index list, the clusters, and 0.
    limits: vec4u,
    /// The row that gives a position's depth along the view.
    depth_row: vec4f,
    /// The depth row's direction, of length 1, then one over the row's length.
    forward: vec4f,
    /// How far each tile test reaches past a sphere: the share of its radius and the share of its
    /// distance from the camera.
    reach: vec4f,
    /// Each slice's bounds along the view, where it starts and where it ends, two slices per
    /// vector.
    bounds: array<vec4f, 16>,
    /// The planes between the columns of tiles, then between the rows.
    planes: array<vec4f, MAX_PLANES>,
}

@group(0) @binding(0) var<uniform> params: ClusterParams;
/// The light list: four vectors per light, the first its position relative to the camera and its
/// range.
@group(0) @binding(1) var<storage, read> lights: array<vec4f>;
/// One word per cluster, then the light index list.
@group(0) @binding(2) var<storage, read_write> grid: array<u32>;

/// The tile rectangles of the workgroup's run of lights.
var<workgroup> rects: array<u32, WORKGROUP_SIZE>;
/// Each thread's total of counts, then the totals of the threads before it and its own.
var<workgroup> totals: array<u32, WORKGROUP_SIZE>;

/// The first and last tiles between consecutive planes, from plane `first`, that a sphere
/// reaches, or a first tile after the last when it reaches none.
fn tile_span(first: u32, tiles: u32, center: vec3f, reach: f32) -> vec2u {
    var found = vec2u(1u, 0u);
    var plane = params.planes[first];
    var before = plane.x * center.x + plane.y * center.y + plane.z * center.z + plane.w;
    for (var tile = 0u; tile < tiles; tile++) {
        plane = params.planes[first + tile + 1u];
        let after = plane.x * center.x + plane.y * center.y + plane.z * center.z + plane.w;
        // The sphere reaches the tile unless it lies wholly before its first plane or wholly
        // after its second.
        if before >= -reach && after <= reach {
            if found.x > found.y {
                found.x = tile;
            }
            found.y = tile;
        }
        before = after;
    }
    return found;
}

/// The tiles of slice `slice` that light `light` reaches, packed as the bytes first column, last
/// column, first row and last row, or NO_TILES.
fn rect(light: u32, slice: u32) -> u32 {
    let position_range = lights[light * 4u];
    let p = position_range.xyz;
    let r = position_range.w;
    let row = params.depth_row;
    let depth = row.x * p.x + row.y * p.y + row.z * p.z + row.w;
    let pair = params.bounds[slice / 2u];
    let bounds = select(pair.xy, pair.zw, (slice & 1u) == 1u);
    let inverse_scale = params.forward.w;
    // The part of the sphere inside the slice, as offsets along the view from its center.
    let below = (bounds.x - depth) * inverse_scale;
    let above = (bounds.y - depth) * inverse_scale;
    if !(below <= r && above >= -r) {
        return NO_TILES;
    }
    let low = max(below, -r);
    let high = min(above, r);
    // A sphere around that part: its widest circle, and its half length along the view.
    let widest = min(max(low, 0.0), high);
    let half = (high - low) * 0.5;
    let middle = (high + low) * 0.5;
    let squared = max(r * r - widest * widest, 0.0) + half * half;
    var center = p;
    var radius = r;
    if squared < r * r {
        let f = params.forward.xyz;
        center = vec3f(p.x + f.x * middle, p.y + f.y * middle, p.z + f.z * middle);
        radius = sqrt(squared);
    }
    let away = sqrt(center.x * center.x + center.y * center.y + center.z * center.z);
    let reach = radius * params.reach.x + params.reach.y * away;
    let tiles_x = params.shape.x;
    let columns = tile_span(0u, tiles_x, center, reach);
    let rows = tile_span(tiles_x + 1u, params.shape.y, center, reach);
    if columns.x > columns.y || rows.x > rows.y {
        return NO_TILES;
    }
    return columns.x | (columns.y << 8u) | (rows.x << 16u) | (rows.y << 24u);
}

/// True when a tile rectangle holds tile `tile`.
fn covers(rect: u32, tile: vec2u) -> bool {
    let first = vec2u(rect & 0xffu, (rect >> 16u) & 0xffu);
    let last = vec2u((rect >> 8u) & 0xffu, rect >> 24u);
    return rect != NO_TILES && all(tile >= first) && all(tile <= last);
}

/// Finds the tile rectangles in slice `slice` of the lights from `first` on, one per thread of
/// the workgroup, for every thread to read.
fn find_rects(first: u32, slice: u32, local: u32) {
    let light = first + local;
    var found = NO_TILES;
    if light < params.shape.w {
        found = rect(light, slice);
    }
    rects[local] = found;
}

/// A thread's tile, by its workgroup's slice and run of tiles.
fn tile_of(group: vec3u, local: u32) -> u32 {
    return group.x * WORKGROUP_SIZE + local;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn count_lights(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) local: u32,
) {
    let tiles_x = params.shape.x;
    let tiles = tiles_x * params.shape.y;
    let slice = group.y;
    let tile = tile_of(group, local);
    let at = vec2u(tile % tiles_x, tile / tiles_x);
    var found = 0u;
    for (var first = 0u; first < params.shape.w; first += WORKGROUP_SIZE) {
        find_rects(first, slice, local);
        workgroupBarrier();
        let run = min(WORKGROUP_SIZE, params.shape.w - first);
        for (var k = 0u; k < run; k++) {
            if covers(rects[k], at) {
                found++;
            }
        }
        workgroupBarrier();
    }
    if tile < tiles {
        grid[slice * tiles + tile] = found;
    }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn place_lights(@builtin(local_invocation_index) local: u32) {
    let per_cluster = params.limits.x;
    let room = params.limits.y;
    let clusters = params.limits.z;
    // Each thread adds up a run of clusters.
    let each = (clusters + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    let first = min(local * each, clusters);
    let end = min(first + each, clusters);
    var total = 0u;
    for (var c = first; c < end; c++) {
        total += min(grid[c], per_cluster);
    }
    totals[local] = total;
    workgroupBarrier();
    // The totals of the threads up to each one, in steps that double.
    for (var step = 1u; step < WORKGROUP_SIZE; step <<= 1u) {
        var before = 0u;
        if local >= step {
            before = totals[local - step];
        }
        workgroupBarrier();
        totals[local] += before;
        workgroupBarrier();
    }
    // The clusters before this thread's run keep their counts until the index list is full.
    var used = totals[local] - total;
    for (var c = first; c < end; c++) {
        let wanted = min(grid[c], per_cluster);
        let start = min(used, room);
        let kept = min(used + wanted, room) - start;
        var word = 0u;
        if kept > 0u {
            word = (clusters + start) | (kept << START_BITS);
        }
        grid[c] = word;
        used += wanted;
    }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn write_lights(
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) local: u32,
) {
    let tiles_x = params.shape.x;
    let tiles = tiles_x * params.shape.y;
    let slice = group.y;
    let tile = tile_of(group, local);
    let at = vec2u(tile % tiles_x, tile / tiles_x);
    var word = 0u;
    if tile < tiles {
        word = grid[slice * tiles + tile];
    }
    let start = word & ((1u << START_BITS) - 1u);
    let kept = word >> START_BITS;
    var written = 0u;
    for (var first = 0u; first < params.shape.w; first += WORKGROUP_SIZE) {
        find_rects(first, slice, local);
        workgroupBarrier();
        let run = min(WORKGROUP_SIZE, params.shape.w - first);
        for (var k = 0u; k < run; k++) {
            if written < kept && covers(rects[k], at) {
                grid[start + written] = first + k;
                written++;
            }
        }
        workgroupBarrier();
    }
}
