// The automatic exposure's downsample path: two full-screen steps for devices without the
// compute histogram, and for the Low preset.
//
// `downsample` draws a grid of 16 x 16 cells over the color's drawn corner. Each cell takes the
// mean stops of 4 x 4 filtered taps over its part of the corner, and its center weight. A cell
// writes its stops in red and its weight in green.
//
// `adapt` draws one texel. Its one fragment adds the weight of each cell to a bin of its stops,
// meters the bins as the histogram path does, and moves the stored exposure toward the result
// (null3d::exposure). It reads the stored exposure from the texel that the frame before wrote,
// which the frame builder copies there after this step.
//
// Both steps bind as a custom effect does: their settings, the texture they read with the linear
// sampler, the sampler, and a texture they read as plain floats. The grid's weights are the same
// in either row order, so WebGL2's rows from the bottom change nothing but where the corner lies.

#import null3d::exposure::{Settings, adapted, bin_of, center_weight, meter, stops}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;
@group(0) @binding(3) var stored: texture_2d<f32>;

/// The taps of a cell each way.
const TAPS: u32 = 4u;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn downsample(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let corner = position.xy - 0.5;
    var sum = 0.0;
    for (var y = 0u; y < TAPS; y++) {
        for (var x = 0u; x < TAPS; x++) {
            let cell = corner + (vec2f(f32(x), f32(y)) + 0.5) / f32(TAPS);
            let at = clamp(
                cell * settings.map.xy + settings.map.zw,
                settings.bounds.xy,
                settings.bounds.zw,
            );
            sum += stops(textureSampleLevel(source, source_sampler, at, 0.0).rgb);
        }
    }
    let place = position.xy / settings.grid.xy;
    let weight = center_weight(place, settings.grid.z, settings.shares.z);
    return vec4f(sum / f32(TAPS * TAPS), weight, 0.0, 1.0);
}

@fragment
fn adapt(@builtin(position) position: vec4f) -> @location(0) vec4f {
    var bins: array<f32, 128>;
    let size = vec2i(textureDimensions(source));
    for (var y = 0; y < size.y; y++) {
        for (var x = 0; x < size.x; x++) {
            let cell = textureLoad(source, vec2i(x, y), 0);
            let bin = bin_of(cell.x);
            bins[bin] += cell.y;
        }
    }
    let metered = meter(&bins, settings.shares.x, settings.shares.y);
    let previous = textureLoad(stored, vec2i(0), 0).y;
    return adapted(previous, metered, settings);
}
