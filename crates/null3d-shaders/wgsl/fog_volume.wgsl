// The volumetric fog's block, sum and apply steps, each one triangle over its target.
//
// - `block_sum` draws over a texture of the grid's size (null3d::fog_volume). The slices fall into
//   blocks of a row of tiles each. Each cell sums the cells of its block from the block's first
//   slice to its own, along its view ray, with the exact integral over each slice: a slice of
//   density s and length l passes exp(-s × l) of the light behind it, and adds its scattered light
//   times (1 - exp(-s × l)) / s, so a thick slice keeps its light right (Hillaire, "Physically
//   Based and Unified Volumetric Rendering in Frostbite", 2015). It writes the light scattered
//   toward the camera across that part of the block, and the share of light that passes.
// - `sum` draws over a second texture of the grid's size. Each cell joins the sums of the whole
//   blocks in front of its own, front to back, then its own block's sum up to it. It writes the
//   light scattered toward the camera up to the cell's far edge, and the share of light that
//   passes. A cell reads at most a block's slices in the first step and a read per block in the
//   second, so the work grows with the slices, not with their square.
// - `apply` draws at the render size. Each pixel finds its distance from the scene's depth and adds
//   the summed grid's light there to the scene's color. Past the grid's reach it adds the sun's
//   light that the fog scatters, without shadows, in closed form: with every bit of fog scattering
//   as much as it dims, the light between two distances is the sun's light times the phase times
//   the drop in the share of light that passes. So no edge shows where the grid ends. The
//   background takes the grid's light alone, as it takes none of the scene's fog.
//
// The steps bind as depth of field's do: the block step and the sum as steps of bloom (settings, a
// texture and a sampler), and the apply step as depth of field's composite, with the summed grid at
// binding 4.
// The MULTISAMPLED builds read sample 0 of a multisampled depth, on WebGPU.
#import null3d::fullscreen::{triangle}
#import null3d::fog::{fog_height_ratio}
#import null3d::fog_volume::{FogStep, SLICES_PER_ROW, fog_cell_uv, fog_edge_distance, fog_phase, fog_ray, fog_screen_place, fog_volume_blend, fog_volume_place}

@group(0) @binding(0) var<uniform> settings: FogStep;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;
#ifdef MULTISAMPLED
@group(0) @binding(3) var depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(3) var depth_texture: texture_2d<f32>;
#endif
@group(0) @binding(4) var summed: texture_2d<f32>;

/// The distance along the view that the apply step gives the background, where the scene's depth
/// holds the far plane: far enough that the fog in front of it passes no light.
const BACKGROUND: f32 = 1e7;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

/// A cell's place in the grid's texture: its column and row in the slice, and its slice.
struct GridCell {
    cell: vec2u,
    slice: u32,
}

/// The cell of the grid's texture at `texel`.
fn grid_cell(texel: vec2u) -> GridCell {
    let size = vec2u(settings.grid.cells.xy);
    let tile = texel / size;
    return GridCell(texel % size, tile.y * SLICES_PER_ROW + tile.x);
}

/// The texel of `cell` in slice `slice` of the grid's texture.
fn grid_texel(cell: vec2u, slice: u32) -> vec2u {
    let size = vec2u(settings.grid.cells.xy);
    return vec2u(slice % SLICES_PER_ROW, slice / SLICES_PER_ROW) * size + cell;
}

/// Joins `back`, the light and the share of light that passes of the fog behind `front`, to
/// `front`, front to back.
fn join(front: vec4f, back: vec4f) -> vec4f {
    return vec4f(front.rgb + back.rgb * front.a, front.a * back.a);
}

@fragment
fn block_sum(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let grid = settings.grid;
    let at = grid_cell(vec2u(position.xy));
    if at.slice >= u32(grid.cells.z) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    // A view ray's length per unit along the view.
    let screen = (vec2f(at.cell) + 0.5) / grid.cells.xy;
    let stretch = length(fog_ray(settings, screen));
    let first = at.slice - at.slice % SLICES_PER_ROW;
    var light = vec3f(0.0);
    var passes = 1.0;
    var start = fog_edge_distance(grid, f32(first));
    // Every cell runs one pass per slice of a block, and its own slice only picks the passes that
    // add: drivers that run a loop wrongly when its count differs within a work group then see one
    // count.
    for (var k = 0u; k < SLICES_PER_ROW; k++) {
        let slice = first + k;
        if slice <= at.slice {
            let value = textureLoad(source, grid_texel(at.cell, slice), 0);
            let end = fog_edge_distance(grid, f32(slice + 1u));
            let span = (end - start) * stretch;
            start = end;
            let depth = value.a * span;
            let through = exp(-depth);
            let share = select((1.0 - through) / max(value.a, 1e-8), span, depth < 1e-4);
            light += value.rgb * (passes * share);
            passes *= through;
        }
    }
    return vec4f(light, passes);
}

@fragment
fn sum(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let slices = u32(settings.grid.cells.z);
    let at = grid_cell(vec2u(position.xy));
    if at.slice >= slices {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    let own = at.slice / SLICES_PER_ROW;
    var result = vec4f(0.0, 0.0, 0.0, 1.0);
    // Each whole block in front adds the sum of its last slice, as the block step wrote it. Every
    // cell runs one pass per block, as the block step runs one per slice.
    for (var b = 0u; b < (slices + SLICES_PER_ROW - 1u) / SLICES_PER_ROW; b++) {
        if b < own {
            let last = min(b * SLICES_PER_ROW + SLICES_PER_ROW - 1u, slices - 1u);
            result = join(result, textureLoad(source, grid_texel(at.cell, last), 0));
        }
    }
    return join(result, textureLoad(source, grid_texel(at.cell, at.slice), 0));
}

/// The depth value of the scene's texel `texel`: of a multisampled depth, its first sample. Fog
/// changes little from one sample to the next, so one read per pixel is enough.
fn depth_of(texel: vec2i) -> f32 {
    return textureLoad(depth_texture, texel, 0).x;
}

/// The share of light that passes along a view ray of length `span` from the camera, whose direction
/// rises by `rise` per unit of length, through the fog whose density at the camera's height and
/// height falloff the settings hold, as the scene's fog integrates it (null3d::fog).
fn passing(span: f32, rise: f32) -> f32 {
    let medium = settings.medium;
    return exp(-medium.x * span * fog_height_ratio(medium.y * span * rise));
}

/// The summed grid's value at `cell` across the view in slice `slice`, through a cubic B-spline over
/// the four by four nearest cells, from four filtered reads placed between them. A single filtered
/// read blends the four nearest cells along straight lines, so where the light changes, each cell's
/// edge shows as a step in its slope, which a coarse grid makes plain. The spline's slope changes
/// smoothly, so no cell shows, at any slice count.
fn summed_smooth(cell: vec2f, slice: u32) -> vec4f {
    let grid = settings.grid;
    let at = cell - 0.5;
    let first = floor(at);
    let f = at - first;
    let f2 = f * f;
    let f3 = f2 * f;
    // The weights of the cells before, at, after and two after the place.
    let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    let w3 = f3 / 6.0;
    // Each pair of cells takes one filtered read, between their centers by their weights.
    let low = w0 + w1;
    let high = w2 + w3;
    let low_at = first - 0.5 + w1 / low;
    let high_at = first + 1.5 + w3 / high;
    let top = low.x * summed_at(vec2f(low_at.x, low_at.y), slice)
        + high.x * summed_at(vec2f(high_at.x, low_at.y), slice);
    let bottom = low.x * summed_at(vec2f(low_at.x, high_at.y), slice)
        + high.x * summed_at(vec2f(high_at.x, high_at.y), slice);
    return low.y * top + high.y * bottom;
}

/// The summed grid's filtered value at `cell` in slice `slice`.
fn summed_at(cell: vec2f, slice: u32) -> vec4f {
    return textureSampleLevel(summed, source_sampler, fog_cell_uv(settings.grid, cell, slice), 0.0);
}

@fragment
fn apply(@builtin(position) position: vec4f) -> @location(0) vec4f {
    // The scene's color and depth have the target's size and drawn corner, so a pixel reads its
    // own texel of each.
    let texel = vec2i(position.xy);
    let color = textureLoad(source, texel, 0);
    let depth = depth_of(texel);
    let d = settings.depth;
    let along = select(-(d.x * depth + d.y) / (d.z * depth + d.w), BACKGROUND, depth <= 0.0);
    let screen = fog_screen_place(position.xy, settings.corner);
    let place = fog_volume_place(settings.grid, screen, along);
    let near = summed_smooth(place.cell, place.slices.x);
    let far = summed_smooth(place.cell, place.slices.y);
    var scattered = fog_volume_blend(near, far, place).rgb;
    // The background takes no fog (null3d::fog): its sky holds its own haze around the sun. So
    // it takes the grid's light in front of it, and no light from past the grid's reach.
    let reach = settings.grid.cells.w;
    if along > reach && depth > 0.0 {
        let ray = fog_ray(settings, screen);
        let stretch = length(ray);
        let direction = ray / stretch;
        let entered = passing(reach * stretch, direction.y);
        let left = passing(along * stretch, direction.y);
        let g = settings.sun_direction.w;
        let phase = fog_phase(g, dot(-settings.sun_direction.xyz, direction));
        scattered += settings.sun_color.rgb * (phase * max(entered - left, 0.0));
    }
    return vec4f(color.rgb + scattered, color.a);
}
