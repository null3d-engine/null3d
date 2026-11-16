// The moment layer's anti-aliasing: SMAA 1x (Jimenez et al. 2013), run under the share that the
// moment store covers. The layer's own targets have one sample, so its surfaces get none of the
// scene's MSAA samples; opaque edges keep them, and this step smooths the layer's edges alone.
//
// Three steps, as the method has them:
//
// - `edges` marks each pixel whose colour differs from the pixel to its left or above it by more
//   than the threshold, under the moment store's coverage: a pixel that the layer does not cover
//   marks nothing, so neither does an opaque edge outside it.
// - `blend` finds the ends of each marked edge and the areas at each side from the two lookup
//   tables, which the engine makes at the layer's first use, and writes the blending weights.
// - `resolve` mixes each pixel with the neighbour that its weights name.
//
// Ported from the SMAA reference implementation (https://github.com/iryoku/smaa), whose notice the
// engine keeps among its third-party notices: Copyright (C) 2013 Jorge Jimenez, Jose I. Echevarria,
// Belen Masia, Fernando Navarro and Diego Gutierrez, under the MIT licence.
//
// The area table holds 160 by 560 texels, the horizontal and vertical patterns in its left half and
// the diagonal patterns in its right half, each with a slot for each subpixel offset. The search
// table holds 64 by 16 texels: the distances that the searches' last step adds.

#import null3d::fullscreen::{triangle}

#ifdef EDGES
@group(0) @binding(0) var scene_color: texture_2d<f32>;
@group(0) @binding(1) var moment_store: texture_2d<f32>;
#endif
#ifdef BLEND
@group(0) @binding(0) var edges_texture: texture_2d<f32>;
@group(0) @binding(1) var area_table: texture_2d<f32>;
@group(0) @binding(2) var search_table: texture_2d<f32>;
@group(0) @binding(3) var image_sampler: sampler;
#endif
#ifdef RESOLVE
@group(0) @binding(0) var scene_color: texture_2d<f32>;
@group(0) @binding(1) var blend_texture: texture_2d<f32>;
@group(0) @binding(2) var image_sampler: sampler;
#endif

/// The least share of the light that a surface lets through, below which the layer covers a pixel
/// not at all.
const LEAST_COVERAGE: f32 = 1e-4;
/// The least difference of luma, from 0 to 1, that marks an edge.
const THRESHOLD: f32 = 0.1;
/// A neighbouring edge that is this many times stronger hides a weaker one, so the weaker one
/// marks nothing.
const LOCAL_CONTRAST: f32 = 2.0;
/// The most steps of a search along a row or a column. Each step crosses two pixels.
const SEARCH_STEPS: u32 = 16u;
/// The most steps of a diagonal search, one pixel each.
const SEARCH_STEPS_DIAG: u32 = 8u;
/// How much of a corner the method rounds.
const CORNER_ROUNDING: f32 = 0.25;
/// The area table's greatest distances, orthogonal and diagonal, and its layout.
const AREA_MAX_DISTANCE: f32 = 16.0;
const AREA_MAX_DISTANCE_DIAG: f32 = 20.0;
const AREA_PIXEL_SIZE: vec2f = vec2f(1.0 / 160.0, 1.0 / 560.0);
/// The search table's size, and the size of its packed part.
const SEARCH_SIZE: vec2f = vec2f(66.0, 33.0);
const SEARCH_PACKED_SIZE: vec2f = vec2f(64.0, 16.0);

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

/// The size of the image in pixels and the size of one texel.
struct Metrics {
    size: vec2f,
    texel: vec2f,
}

#ifdef EDGES
/// The share of the scene that the moment store covers at `texel`, from its total optical depth.
fn coverage_at(texel: vec2i) -> f32 {
    let size = vec2i(textureDimensions(moment_store));
    let at = clamp(texel, vec2i(0), size - vec2i(1));
    return 1.0 - exp(-max(textureLoad(moment_store, vec2u(at), 0).x, 0.0));
}

/// The luma of a colour, mapped from the scene's range to 0 to 1. The display path holds display
/// colour already and the HDR path linear colour, so a curve keeps both in one range.
fn luma(color: vec3f) -> f32 {
    return 1.0 - exp(-max(dot(color, vec3f(0.2126, 0.7152, 0.0722)), 0.0));
}

/// The luma of the scene color at `texel`, clamped to the image.
fn luma_at(texel: vec2i) -> f32 {
    let size = vec2i(textureDimensions(scene_color));
    let at = clamp(texel, vec2i(0), size - vec2i(1));
    return luma(textureLoad(scene_color, vec2u(at), 0).rgb);
}

/// The edges of the pixel at `texel`: its luma differs from the pixel to its left in red, and from
/// the pixel above it in green, by more than the threshold. The method also drops an edge that a
/// stronger edge beside it hides.
fn edges_at(texel: vec2i) -> vec2f {
    let left = texel - vec2i(1, 0);
    let top = texel - vec2i(0, 1);
    let center = luma_at(texel);
    let deltas = abs(vec2f(center, center) - vec2f(luma_at(left), luma_at(top)));
    var edges = step(vec2f(THRESHOLD), deltas);
    if edges.x + edges.y == 0.0 {
        return vec2f(0.0);
    }
    let around = abs(
        vec2f(center, center) - vec2f(luma_at(texel + vec2i(1, 0)), luma_at(texel + vec2i(0, 1))),
    );
    let far = abs(
        vec2f(luma_at(left), luma_at(top))
            - vec2f(luma_at(left - vec2i(1, 0)), luma_at(top - vec2i(0, 1))),
    );
    let most = max(max(deltas, around), far);
    edges *= step(deltas, vec2f(LOCAL_CONTRAST * max(most.x, most.y)));
    return edges;
}

/// The first step: the edges of each covered pixel.
@fragment
fn edges(@builtin(position) at: vec4f) -> @location(0) vec4f {
    if coverage_at(vec2i(at.xy)) <= LEAST_COVERAGE {
        return vec4f(0.0);
    }
    let e = edges_at(vec2i(at.xy));
    return vec4f(e, 0.0, 1.0);
}
#endif

#ifdef BLEND
fn blend_metrics() -> Metrics {
    let size = vec2f(textureDimensions(edges_texture));
    return Metrics(size, 1.0 / size);
}

/// The edges at `uv`, sampled with the linear sampler.
fn edges_at_uv(uv: vec2f) -> vec2f {
    return textureSampleLevel(edges_texture, image_sampler, uv, 0.0).rg;
}

/// The edges at `uv` moved `offset` texels, sampled with the linear sampler.
fn edges_offset(m: Metrics, uv: vec2f, offset: vec2i) -> vec2f {
    return edges_at_uv(uv + vec2f(offset) * m.texel);
}

/// Two binary values of a bilinear fetch, as the diagonal searches read them.
fn decode_diag_access(e: vec2f) -> vec2f {
    return round(e * abs(5.0 * e - 5.0 * 0.75));
}

fn decode_diag_access4(e: vec4f) -> vec4f {
    let rb = e.rb * abs(5.0 * e.rb - 5.0 * 0.75);
    return round(vec4f(rb.x, e.y, rb.y, e.w));
}

/// How many pixels the last step of a search adds, from the search table.
fn search_length(e: vec2f, offset: f32) -> f32 {
    var scale = SEARCH_SIZE * vec2f(0.5, -1.0);
    var bias = SEARCH_SIZE * vec2f(offset, 1.0);
    scale += vec2f(-1.0, 1.0);
    bias += vec2f(0.5, -0.5);
    scale *= 1.0 / SEARCH_PACKED_SIZE;
    bias *= 1.0 / SEARCH_PACKED_SIZE;
    return textureSampleLevel(search_table, image_sampler, scale * e + bias, 0.0).r;
}

/// The area that the orthogonal pattern at distances `dist` covers, with the crossing edges `e1`
/// and `e2`.
fn area(dist: vec2f, e1: f32, e2: f32) -> vec2f {
    var uv = vec2f(AREA_MAX_DISTANCE, AREA_MAX_DISTANCE) * round(4.0 * vec2f(e1, e2)) + dist;
    uv = AREA_PIXEL_SIZE * uv + 0.5 * AREA_PIXEL_SIZE;
    return textureSampleLevel(area_table, image_sampler, uv, 0.0).rg;
}

/// The area that a diagonal pattern at distances `dist` covers, with the crossing edges `e`.
fn area_diag(dist: vec2f, e: vec2f) -> vec2f {
    var uv = vec2f(AREA_MAX_DISTANCE_DIAG, AREA_MAX_DISTANCE_DIAG) * e + dist;
    uv = AREA_PIXEL_SIZE * uv + 0.5 * AREA_PIXEL_SIZE;
    uv.x += 0.5;
    return textureSampleLevel(area_table, image_sampler, uv, 0.0).rg;
}

/// The steps to the left and to the up along a diagonal, and whether the line ended: the steps
/// taken in x, then the last fetch's edges, as a pair. The diagonal search crosses one pixel each
/// step.
fn search_diag(m: Metrics, start: vec2f, dir: vec2f, shifted: bool) -> vec2f {
    var uv = start;
    if shifted {
        uv.x += 0.25 * m.texel.x;
    }
    var steps = -1.0;
    var rest = 1.0;
    var e = vec2f(0.0);
    while steps < f32(SEARCH_STEPS_DIAG - 1u) && rest > 0.9 {
        uv += m.texel * dir;
        steps += 1.0;
        e = edges_at_uv(uv);
        if shifted {
            e = decode_diag_access(e);
        }
        rest = dot(e, vec2f(0.5));
    }
    return vec2f(steps, rest);
}

/// The blending weights that the diagonal patterns give, from the edges `e` at `uv`.
fn diag_weights(m: Metrics, uv: vec2f, e: vec2f) -> vec2f {
    var weights = vec2f(0.0);
    var d = vec4f(0.0);
    if e.x > 0.0 {
        let found = search_diag(m, uv, vec2f(-1.0, 1.0), false);
        d.x = found.x;
        d.z = found.y;
        d.x += select(0.0, 1.0, found.y > 0.9);
    }
    let right = search_diag(m, uv, vec2f(1.0, -1.0), false);
    d.y = right.x;
    d.w = right.y;
    if d.x + d.y > 2.0 {
        let at = vec4f(-d.x + 0.25, d.x, d.y, -d.y - 0.25) * m.texel.xyxy + uv.xyxy;
        let c = vec4f(
            edges_offset(m, at.xy, vec2i(-1, 0)).rg,
            edges_offset(m, at.zw, vec2i(1, 0)).rg,
        );
        let decoded = decode_diag_access4(c);
        let swapped = vec4f(decoded.y, decoded.x, decoded.w, decoded.z);
        var cc = vec2f(2.0, 2.0) * swapped.xz + swapped.yw;
        cc = select(vec2f(0.0), cc, vec2f(d.z, d.w) >= vec2f(0.9));
        weights += area_diag(d.xy, cc);
    }
    let down = search_diag(m, uv, vec2f(-1.0, -1.0), true);
    d.x = down.x;
    d.z = down.y;
    if edges_at_uv(uv + vec2f(m.texel.x, 0.0)).r > 0.0 {
        let across = search_diag(m, uv, vec2f(1.0, 1.0), true);
        d.y = across.x;
        d.w = across.y;
        d.y += select(0.0, 1.0, across.y > 0.9);
    } else {
        d.y = 0.0;
        d.w = 0.0;
    }
    if d.x + d.y > 2.0 {
        let at = vec4f(-d.x, -d.x, d.y, d.y) * m.texel.xyxy + uv.xyxy;
        let c = vec4f(
            edges_offset(m, at.xy, vec2i(-1, 0)).g,
            edges_offset(m, at.xy, vec2i(0, -1)).r,
            edges_offset(m, at.zw, vec2i(1, 0)).g,
            edges_offset(m, at.zw, vec2i(1, 0)).r,
        );
        var cc = vec2f(2.0, 2.0) * c.xz + c.yw;
        cc = select(vec2f(0.0), cc, vec2f(d.z, d.w) >= vec2f(0.9));
        weights += area_diag(d.xy, cc).gr;
    }
    return weights;
}

/// The steps to the left along a row, as a coordinate from which the search's last step is added.
fn search_x_left(m: Metrics, start: vec2f, end: f32) -> f32 {
    var uv = start;
    var e = vec2f(0.0, 1.0);
    while uv.x > end && e.y > 0.8281 && e.x == 0.0 {
        e = edges_at_uv(uv);
        uv.x -= 2.0 * m.texel.x;
    }
    let offset = -(255.0 / 127.0) * search_length(e, 0.0) + 3.25;
    return uv.x + m.texel.x * offset;
}

/// The steps to the right along a row.
fn search_x_right(m: Metrics, start: vec2f, end: f32) -> f32 {
    var uv = start;
    var e = vec2f(0.0, 1.0);
    while uv.x < end && e.y > 0.8281 && e.x == 0.0 {
        e = edges_at_uv(uv);
        uv.x += 2.0 * m.texel.x;
    }
    let offset = -(255.0 / 127.0) * search_length(e, 0.5) + 3.25;
    return uv.x - m.texel.x * offset;
}

/// The steps up a column.
fn search_y_up(m: Metrics, start: vec2f, end: f32) -> f32 {
    var uv = start;
    var e = vec2f(1.0, 0.0);
    while uv.y > end && e.x > 0.8281 && e.y == 0.0 {
        e = edges_at_uv(uv);
        uv.y -= 2.0 * m.texel.y;
    }
    let offset = -(255.0 / 127.0) * search_length(e.gr, 0.0) + 3.25;
    return uv.y + m.texel.y * offset;
}

/// The steps down a column.
fn search_y_down(m: Metrics, start: vec2f, end: f32) -> f32 {
    var uv = start;
    var e = vec2f(1.0, 0.0);
    while uv.y < end && e.x > 0.8281 && e.y == 0.0 {
        e = edges_at_uv(uv);
        uv.y += 2.0 * m.texel.y;
    }
    let offset = -(255.0 / 127.0) * search_length(e.gr, 0.5) + 3.25;
    return uv.y - m.texel.y * offset;
}

/// Rounds a horizontal pattern's corners by `weights`, from the edges around it.
fn round_horizontal_corner(m: Metrics, weights: vec2f, at: vec4f, dist: vec2f) -> vec2f {
    let left_right = step(dist.xy, dist.yx);
    var rounding = (1.0 - CORNER_ROUNDING) * left_right;
    rounding /= left_right.x + left_right.y;
    var factor = vec2f(1.0);
    factor.x -= rounding.x * edges_offset(m, at.xy, vec2i(0, 1)).r;
    factor.x -= rounding.y * edges_offset(m, at.zw, vec2i(1, 1)).r;
    factor.y -= rounding.x * edges_offset(m, at.xy, vec2i(0, -2)).r;
    factor.y -= rounding.y * edges_offset(m, at.zw, vec2i(1, -2)).r;
    return weights * clamp(factor, vec2f(0.0), vec2f(1.0));
}

/// Rounds a vertical pattern's corners by `weights`, from the edges around it.
fn round_vertical_corner(m: Metrics, weights: vec2f, at: vec4f, dist: vec2f) -> vec2f {
    let left_right = step(dist.xy, dist.yx);
    var rounding = (1.0 - CORNER_ROUNDING) * left_right;
    rounding /= left_right.x + left_right.y;
    var factor = vec2f(1.0);
    factor.x -= rounding.x * edges_offset(m, at.xy, vec2i(1, 0)).g;
    factor.x -= rounding.y * edges_offset(m, at.zw, vec2i(1, 1)).g;
    factor.y -= rounding.x * edges_offset(m, at.xy, vec2i(-2, 0)).g;
    factor.y -= rounding.y * edges_offset(m, at.zw, vec2i(-2, 1)).g;
    return weights * clamp(factor, vec2f(0.0), vec2f(1.0));
}

/// The second step: the blending weights of each edge pixel.
@fragment
fn blend(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let m = blend_metrics();
    let uv = position.xy * m.texel;
    let pixel = position.xy;
    var weights = vec4f(0.0);
    var e = edges_at_uv(uv);
    if e.y > 0.0 {
        let diagonal = diag_weights(m, uv, e);
        weights.x = diagonal.x;
        weights.y = diagonal.y;
        if weights.r + weights.g == 0.0 {
            let left = search_x_left(
                m,
                uv + vec2f(-0.25, -0.125) * m.texel,
                uv.x + (-0.25 - 2.0 * f32(SEARCH_STEPS)) * m.texel.x,
            );
            let e1 = edges_at_uv(vec2f(left, uv.y - 0.25 * m.texel.y)).r;
            let right = search_x_right(
                m,
                uv + vec2f(1.25, -0.125) * m.texel,
                uv.x + (1.25 + 2.0 * f32(SEARCH_STEPS)) * m.texel.x,
            );
            var d = abs(round(m.size.xx * vec2f(left, right) - pixel.xx));
            let e2 = edges_at_uv(vec2f(right + m.texel.x, uv.y - 0.25 * m.texel.y)).r;
            let found = area(sqrt(d), e1, e2);
            let rounded = round_horizontal_corner(
                m,
                found,
                vec4f(left, uv.y, right, uv.y),
                d,
            );
            weights.x = rounded.x;
            weights.y = rounded.y;
        } else {
            e.x = 0.0;
        }
    }
    if e.x > 0.0 {
        let up = search_y_up(
            m,
            uv + vec2f(-0.125, -0.25) * m.texel,
            uv.y + (-0.25 - 2.0 * f32(SEARCH_STEPS)) * m.texel.y,
        );
        let e1 = edges_at_uv(vec2f(uv.x - 0.25 * m.texel.x, up)).g;
        let down = search_y_down(
            m,
            uv + vec2f(-0.125, 1.25) * m.texel,
            uv.y + (1.25 + 2.0 * f32(SEARCH_STEPS)) * m.texel.y,
        );
        let d = abs(round(m.size.yy * vec2f(up, down) - pixel.yy));
        let e2 = edges_at_uv(vec2f(uv.x - 0.25 * m.texel.x, down + m.texel.y)).g;
        let found = area(sqrt(d), e1, e2);
        let rounded = round_vertical_corner(m, found, vec4f(uv.x, up, uv.x, down), d);
        weights.z = rounded.x;
        weights.w = rounded.y;
    }
    return weights;
}
#endif

#ifdef RESOLVE
@fragment
fn resolve(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let size = vec2f(textureDimensions(scene_color));
    let texel = 1.0 / size;
    let uv = position.xy * texel;
    var weights: vec4f;
    weights.x = textureSampleLevel(blend_texture, image_sampler, uv + vec2f(texel.x, 0.0), 0.0).a;
    weights.y = textureSampleLevel(blend_texture, image_sampler, uv + vec2f(0.0, -texel.y), 0.0).g;
    let beside = textureSampleLevel(blend_texture, image_sampler, uv, 0.0);
    weights.w = beside.x;
    weights.z = beside.z;
    if weights.x + weights.y + weights.z + weights.w < 1e-5 {
        return textureLoad(scene_color, vec2u(position.xy), 0);
    }
    let horizontal = max(weights.x, weights.z) > max(weights.y, weights.w);
    var offsets = vec4f(0.0, weights.y, 0.0, weights.w);
    var blend = weights.yw;
    if horizontal {
        offsets = vec4f(weights.x, 0.0, weights.z, 0.0);
        blend = weights.xz;
    }
    blend /= blend.x + blend.y;
    let at = uv.xyxy + offsets * vec4f(texel.xy, -texel.xy);
    let color = blend.x * textureSampleLevel(scene_color, image_sampler, at.xy, 0.0)
        + blend.y * textureSampleLevel(scene_color, image_sampler, at.zw, 0.0);
    return color;
}
#endif
