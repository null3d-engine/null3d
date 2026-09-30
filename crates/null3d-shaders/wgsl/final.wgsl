// The final pass: one triangle over the whole canvas. Each pixel reads the scene color under it,
// applies the exposure and the tone mapping, encodes sRGB and dithers. A scene color that holds
// display color already, as on the 8-bit path, keeps its color.
//
// The scene drew into the top-left corner of the scene color at the render scale, and the scene
// color has the canvas's size. At the whole canvas's scale, each pixel reads the texel it covers.
// Below it, each pixel blends the four texels of the corner around its place, as a bilinear filter
// does, and so scales the corner up to the whole canvas. It blends their display colors, after the
// tone mapping: a filter over HDR color would let a small share of a very bright texel turn its
// neighbors almost white.
//
// The scene color holds linear color multiplied by its coverage. Where it is only partly covered,
// as over a transparent canvas's background, the pass maps the color that covers it and keeps the
// coverage as the canvas's premultiplied alpha. WebGL2 keeps GL's row order, bottom row first, in
// the scene color and the canvas alike.
#import null3d::tonemap

@group(0) @binding(0) var<uniform> settings: null3d::tonemap::Output;
@group(0) @binding(1) var scene_color: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space: (-1, -1), (3, -1) and (-1, 3). Its depth sits
    // halfway, so no depth mode of the WebGL2 path moves it to the edge of the clip range.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// A texel of the scene color as canvas pixel `pixel` shows it: tone mapped, encoded and dithered
/// for that pixel, and multiplied by its coverage.
fn display_texel(texel: vec2i, pixel: vec2f) -> vec4f {
    let color = textureLoad(scene_color, texel, 0);
    if (settings.flags & null3d::tonemap::DISPLAY_COLOR) != 0u {
        return color;
    }
    let coverage = color.a;
    if coverage <= 0.0 {
        return vec4f(0.0);
    }
    let mapped = null3d::tonemap::tone_map(color.rgb / coverage, settings);
    let encoded = saturate(null3d::tonemap::encode(mapped, pixel));
    return vec4f(encoded * coverage, coverage);
}

/// The texel of a place in the drawn corner, counted from the corner's top-left.
fn corner_texel(place: vec2f, size: vec2f) -> vec2i {
#ifdef WEBGL2
    return vec2i(i32(place.x), i32(size.y - 1.0 - place.y));
#else
    return vec2i(place);
#endif
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let size = vec2f(textureDimensions(scene_color));
    let packed = settings.render_size;
    let render = vec2f(f32(packed & 0xffffu), f32(packed >> 16u));
    if all(render == size) {
        return display_texel(vec2i(position.xy), position.xy);
    }
#ifdef WEBGL2
    let from_top = vec2f(position.x, size.y - position.y);
#else
    let from_top = position.xy;
#endif
    // The pixel's place in the corner, in texels from the center of its top-left texel. It stays
    // within the corner's texel centers, so no tap reads past the corner.
    let place = clamp(from_top / size * render - 0.5, vec2f(0.0), render - 1.0);
    let first = floor(place);
    let share = place - first;
    let last = min(first + 1.0, render - 1.0);
    let top = mix(
        display_texel(corner_texel(first, size), position.xy),
        display_texel(corner_texel(vec2f(last.x, first.y), size), position.xy),
        share.x,
    );
    let bottom = mix(
        display_texel(corner_texel(vec2f(first.x, last.y), size), position.xy),
        display_texel(corner_texel(last, size), position.xy),
        share.x,
    );
    return mix(top, bottom, share.y);
}
