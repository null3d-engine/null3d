// The volumetric fog's light step: one triangle over the grid's texture (null3d::fog_volume), whose
// texels are the grid's cells. Each cell takes a point inside it, moved by the frame's offset, and
// finds the fog's density there from the scene's fog. It adds the light that the fog scatters
// toward the camera: the sun's, where the shadow cascades see the point, and that of each point and
// spot light of the point's cluster, through its shadow tile. Then it blends the result with the
// last frame's grid at the same place in the world, which smooths the frames' offsets into a finer
// grid over a few frames. It writes the light scattered per meter in `rgb` and the fog's density
// in `a`.
//
// The step binds the camera's frame group at group 0, as the scene's background does, so it reads
// the sun's cascades, the clustered lights and the shadow atlas as the scene's surfaces do. Its own
// group holds its settings, the last frame's grid and a sampler.
#import null3d::fog_volume::{FogStep, SLICES_PER_ROW, fog_edge_distance, fog_grid_place, fog_phase, fog_point, fog_slice_edge}
#import null3d::lighting::{distance_attenuation, spot_attenuation}
#import null3d::lights::{cluster_lights, grid_word, light_of}
#import null3d::shadows::{cascades, light_shadow, no_plane, sun_texels}

@group(1) @binding(0) var<uniform> settings: FogStep;
@group(1) @binding(1) var history: texture_2d<f32>;
@group(1) @binding(2) var history_sampler: sampler;

/// The largest exponent of the density's change with height, which keeps it finite.
const HEIGHT_EXPONENT_LIMIT: f32 = 40.0;
/// The share of the shadow distance over which the sun's shadows fade out.
const FADE_SHARE: f32 = 0.1;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// How much of the sun's light reaches a point in the air at `relative`: 1 in full light, 0 in full
/// shadow. The point takes the first cascade, from the one that holds its distance, whose box holds
/// it, and compares its depth with the four nearest texels, blended by its place between them. A
/// point in the air has no surface, so it takes no bias. Past the last cascade the sun is unshadowed.
fn sun_seen(relative: vec3f) -> f32 {
    let count = u32(cascades.forward.w);
    let seen = relative + cascades.origin.xyz;
    let along = dot(seen, cascades.forward.xyz);
    let end = cascades.ends[max(count, 1u) - 1u];
    if count == 0u || along >= end {
        return 1.0;
    }
    let distance = mix(along, length(seen) * length(cascades.forward.xyz), cascades.biases.z);
    let size = cascades.kernel.x;
    let inside = 1.0 - 2.0 * cascades.kernel.y;
    var lit = 1.0;
    var found = false;
    // Every cell runs one pass per cascade, as the scene's surfaces do (see null3d::shadows).
    for (var k = 0u; k < count; k++) {
        let holds_distance = k + 1u == count || distance < cascades.ends[k];
        if !found && holds_distance {
            let clip = cascades.view_proj[k] * vec4f(relative, 1.0);
            if all(abs(clip.xy) <= vec2f(inside)) {
                found = true;
                var uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
                // WebGL2 keeps the rows of a drawn texture bottom first.
                uv.y = 1.0 - uv.y;
#endif
                let at = uv * size - 0.5;
                let first = floor(at);
                let blend = at - first;
                let four = sun_texels(first, k, clip.z, no_plane(), size);
                lit = mix(mix(four.x, four.y, blend.x), mix(four.z, four.w, blend.x), blend.y);
            }
        }
    }
    return mix(lit, 1.0, smoothstep(end * (1.0 - FADE_SHARE), end, along));
}

/// The light of the point and spot lights of the cluster that holds `relative`, scattered toward a
/// camera that looks along `toward`, through each light's shadow tile.
fn lamps_seen(relative: vec3f, toward: vec3f) -> vec3f {
    var sum = vec3f(0.0);
    let found = cluster_lights(relative);
    let g = settings.sun_direction.w;
    for (var k = 0u; k < found.y; k++) {
        let lamp = light_of(grid_word(found.x + k));
        let offset = lamp.position_range.xyz - relative;
        let gap = length(offset);
        let to_lamp = offset / max(gap, 1e-6);
        // Close to a lamp the light grows without bound, which the grid's cells cannot hold.
        let closest = max(gap, settings.medium.w);
        let fade = distance_attenuation(closest, lamp.position_range.w, lamp.color_decay.w);
        let cosine = dot(-to_lamp, lamp.direction_cone.xyz);
        var strength = fade * spot_attenuation(lamp.direction_cone.w, lamp.penumbra.x, cosine);
        let tile = lamp.penumbra.w;
        if tile > 0.5 && strength > 0.0 {
            strength *= light_shadow(u32(tile) - 1u, relative, to_lamp, to_lamp, gap);
        }
        sum += lamp.color_decay.rgb * (strength * fog_phase(g, dot(to_lamp, toward)));
    }
    return sum;
}

@fragment
fn light(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let grid = settings.grid;
    let size = vec2u(grid.cells.xy);
    let texel = vec2u(position.xy);
    let tile = texel / size;
    let slice = tile.y * SLICES_PER_ROW + tile.x;
    if f32(slice) >= grid.cells.z {
        return vec4f(0.0);
    }
    let cell = vec2f(texel % size);
    let offset = settings.jitter.xyz;
    let screen = (cell + 0.5 + offset.xy) / grid.cells.xy;
    let distance = fog_edge_distance(grid, f32(slice) + 0.5 + offset.z);
    let relative = fog_point(settings, screen, distance);
    let toward = select(settings.forward.xyz, normalize(relative), grid.texel.w > 0.5);
    let medium = settings.medium;
    let climb = clamp(-medium.y * relative.y, -HEIGHT_EXPONENT_LIMIT, HEIGHT_EXPONENT_LIMIT);
    let density = medium.x * exp(climb);
    let g = settings.sun_direction.w;
    let to_sun = -settings.sun_direction.xyz;
    var scattered = settings.sun_color.rgb * (sun_seen(relative) * fog_phase(g, dot(to_sun, toward)));
    scattered += lamps_seen(relative, toward) * settings.sun_color.w;
    var result = vec4f(scattered * density, density);
    // The last frame's grid at the same place in the world, where its view held the place.
    if medium.z > 0.0 {
        let clip = settings.history_view_proj * vec4f(relative, 1.0);
        let before = dot(settings.history_row, vec4f(relative, 1.0));
        if clip.w > 0.0 && before > 0.0 && before < grid.cells.w {
            let ndc = clip.xy / clip.w;
            let down = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
            let up = vec2f(down.x, 0.5 + ndc.y * 0.5);
            let place = select(down, up, grid.texel.z > 0.5);
            if all(place >= vec2f(0.0)) && all(place <= vec2f(1.0)) {
                let at = vec3f(place * grid.cells.xy, fog_slice_edge(grid, before));
                let read = fog_grid_place(grid, at);
                let near = textureSampleLevel(history, history_sampler, read.near, 0.0);
                let far = textureSampleLevel(history, history_sampler, read.far, 0.0);
                result = mix(result, mix(near, far, read.blend), medium.z);
            }
        }
    }
    return result;
}
