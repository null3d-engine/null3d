// The final pass: one triangle over the whole canvas. Each pixel reads the scene color under it,
// applies the exposure and the tone mapping, encodes sRGB and dithers.
//
// The scene color holds linear color multiplied by its coverage. Where it is only partly covered,
// as over a transparent canvas's background, the pass maps the color that covers it and keeps the
// coverage as the canvas's premultiplied alpha. The scene color and the canvas have one size, so a
// pixel reads the texel it covers, which also keeps each path's row order: WebGL2 keeps GL's order
// in both.
#import null3d::tonemap

@group(0) @binding(0) var<uniform> settings: null3d::tonemap::Output;
@group(0) @binding(1) var scene_color: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space: (-1, -1), (3, -1) and (-1, 3).
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = textureLoad(scene_color, vec2i(position.xy), 0);
    let coverage = texel.a;
    if coverage <= 0.0 {
        return vec4f(0.0);
    }
    let mapped = null3d::tonemap::tone_map(texel.rgb / coverage, settings);
    let encoded = saturate(null3d::tonemap::encode(mapped, position.xy));
    return vec4f(encoded * coverage, coverage);
}
