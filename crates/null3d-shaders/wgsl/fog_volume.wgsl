// The volumetric fog's sum and apply steps, each one triangle over its target.
//
// - `sum` draws over a texture of the grid's size (null3d::fog_volume). Each cell sums the cells in
//   front of it along its view ray, from the camera out, with the exact integral over each slice:
//   a slice of density s and length l passes exp(-s × l) of the light behind it, and adds its
//   scattered light times (1 - exp(-s × l)) / s, so a thick slice keeps its light right (Hillaire,
//   "Physically Based and Unified Volumetric Rendering in Frostbite", 2015). It writes the light
//   scattered toward the camera up to the cell's far edge, and the share of light that passes.
// - `apply` draws at the render size. Each pixel finds its distance from the scene's depth and adds
//   the summed grid's light there to the scene's color. Past the grid's reach it adds the sun's
//   light that the fog scatters, without shadows, in closed form: with every bit of fog scattering
//   as much as it dims, the light between two distances is the sun's light times the phase times
//   the drop in the share of light that passes. So no edge shows where the grid ends.
//
// The steps bind as depth of field's do: the sum as a step of bloom (settings, a texture and a
// sampler), and the apply step as depth of field's composite, with the summed grid at binding 4.
// The MULTISAMPLED builds read sample 0 of a multisampled depth, on WebGPU.
#import null3d::fog::{fog_height_ratio}
#import null3d::fog_volume::{FogStep, SLICES_PER_ROW, fog_edge_distance, fog_phase, fog_ray, fog_screen_place, fog_volume_blend, fog_volume_place}

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
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn sum(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let grid = settings.grid;
    let size = vec2u(grid.cells.xy);
    let texel = vec2u(position.xy);
    let tile = texel / size;
    let slice = tile.y * SLICES_PER_ROW + tile.x;
    let slices = u32(grid.cells.z);
    if slice >= slices {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    let cell = texel % size;
    // A view ray's length per unit along the view.
    let screen = (vec2f(cell) + 0.5) / grid.cells.xy;
    let stretch = length(fog_ray(settings, screen));
    var light = vec3f(0.0);
    var passes = 1.0;
    var start = 0.0;
    // Every cell runs one pass per slice, and its own slice only picks the passes that add: drivers
    // that run a loop wrongly when its count differs within a work group then see one count.
    for (var k = 0u; k < slices; k++) {
        if k <= slice {
            let at = vec2u(k % SLICES_PER_ROW, k / SLICES_PER_ROW) * size + cell;
            let value = textureLoad(source, at, 0);
            let end = fog_edge_distance(grid, f32(k + 1u));
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
    let near = textureSampleLevel(summed, source_sampler, place.near, 0.0);
    let far = textureSampleLevel(summed, source_sampler, place.far, 0.0);
    var scattered = fog_volume_blend(near, far, place).rgb;
    let reach = settings.grid.cells.w;
    if along > reach {
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
