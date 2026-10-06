#define_import_path null3d::shadows

// The shadows of the main directional light, which lit templates read where a surface receives
// shadows. Each frame the core fits up to four cascades to the camera's view, near ones small and
// far ones large, and draws the depth of the light's shadow casters into one layer of a depth
// texture array per cascade. Far cascades draw only every few frames, and keep the box they drew
// with in between. A receiver picks the cascade that holds its distance along the camera's view,
// or the next one whose box holds it, and compares its depth from the light with the depth that
// the cascade stored. Over a band at the far end of each cascade but the last, it blends that
// shadow with the next cascade's, so no line shows where the cascades meet.
//
// Depth is reversed, as everywhere in the engine: 1 on the light's side of a cascade and 0 on the
// far side. A point is lit where its depth is at least the stored depth. The filter reads the
// cascade's texels four at a time and compares each with the receiver's plane at that texel's
// center, then blends them, so a shadow's edge fades over a square of 3 or 5 texels.
//
// Point and spot lights cast shadows into the tiles of the shadow atlas, a second depth texture
// array with one tile per layer. A spot light's tile is a perspective view from the light that
// holds its cone. A point light has six tiles in a row, one per face of a cube around it. Each
// light's record in the light list holds its first tile plus one, or 0 without one, and the
// tiles' uniform block holds each tile's matrix with the light's biases. The tiles' filter has the
// cascades' size, through the comparison sampler, which tests four texels against one depth and
// blends them.

/// The cascades of the main directional light's shadows, as the core writes them each frame.
struct ShadowCascades {
    /// Each cascade's matrix from positions relative to the camera into its clip space.
    view_proj: array<mat4x4f, 4>,
    /// Where each cascade ends along the camera's view. Past the last, nothing is shadowed.
    ends: vec4f,
    /// The vector whose dot product with a position relative to the camera gives its distance
    /// along the camera's view, then the cascade count.
    forward: vec4f,
    /// The size in meters of one texel of each cascade's layer.
    texels: vec4f,
    /// The light's bias toward the light and its normal bias, in meters, then 1 when receivers pick
    /// their cascade by their distance from the camera, or 0 by their distance along its view, and
    /// 0.
    biases: vec4f,
    /// The texels on each side of each layer, the size of one texel in texture coordinates, and
    /// the texels on each side of the filter's square: 3 or 5, or less for the comparison
    /// sampler's own blend of four texels.
    kernel: vec4f,
    /// The camera that draws, relative to the camera that fitted the cascades, whose distances
    /// pick each receiver's cascade: 0 unless another camera fitted them, as the debug API's
    /// shadow camera does.
    origin: vec4f,
    /// Where each cascade's band starts, as receivers measure their distance to pick a cascade.
    /// From there to the cascade's end, a receiver blends its shadow with the next cascade's. The
    /// last cascade's band starts at its end.
    bands: vec4f,
}

/// The tiles of the shadow atlas, as the core writes them each frame.
struct ShadowTiles {
    /// Each tile's matrix from positions relative to the camera into its clip space.
    view_proj: array<mat4x4f, 24>,
    /// Each tile's texel size per meter of distance from its light, the light's bias and normal
    /// bias in meters, and the light's tiles: 1 for a spot light, 6 for a point light.
    params: array<vec4f, 24>,
    /// The filter's values for the atlas's tiles, as the cascades' `kernel` holds them.
    kernel: vec4f,
}

#ifdef WEBGL2
// WebGL2's shading language has no read of four texels at once, so the filter compares each texel
// on its own, through the comparison sampler at the texel's center. In WebGL2's `standard` depth
// mode, the backend makes that sampler pass every comparison, as the map holds depths the other
// way round there.
@group(0) @binding(4) var shadow_map: texture_depth_2d_array;
#else
// The cascades' depths, which the filter reads four texels at a time as floats, so that each texel
// compares with a depth of its own. WebGPU's compatibility mode reads a depth texture through a
// comparison sampler alone, so the map binds as a float texture.
@group(0) @binding(4) var shadow_map: texture_2d_array<f32>;
@group(0) @binding(14) var shadow_texels: sampler;
#endif
@group(0) @binding(5) var shadow_sampler: sampler_comparison;
@group(0) @binding(6) var<uniform> cascades: ShadowCascades;
@group(0) @binding(9) var shadow_atlas: texture_depth_2d_array;
@group(0) @binding(10) var<uniform> tiles: ShadowTiles;

/// The most cascades that the main directional light has.
const MAX_CASCADES: u32 = 4u;
/// The share of the shadow distance over which shadows fade out.
const FADE_SHARE: f32 = 0.1;

/// The most that a surface at a steep angle to the light scales its depth bias by.
const MAX_SLOPE: f32 = 2.0;
/// The steepest that a receiver's plane rises toward the light, as the tangent of its angle to the
/// light, when the filter's texels compare with the plane. A steeper surface takes this slope.
const MAX_PLANE_SLOPE: f32 = 10.0;
/// How far below a receiver's plane, in meters, a caster must lie for the filter to ignore it. It
/// only needs to cover the rounding of depths.
const PLANE_MARGIN: f32 = 0.01;

/// The plane of a receiver in the texels of a cascade: where the receiver's own point lies, in
/// texels from the map's corner, its depth there less `PLANE_MARGIN`, and how much its depth
/// changes per texel along each axis.
struct ReceiverPlane {
    at: vec2f,
    depth: f32,
    slope: vec2f,
}

/// A plane for receivers that face away from the light. Its depth lies below every depth that a
/// shadow map holds, which run from 0 to 1, so every texel compares with the receiver's own depth.
fn no_plane() -> ReceiverPlane {
    return ReceiverPlane(vec2f(0.0), -2.0, vec2f(0.0));
}

/// How far a receiver moves before its shadow lookup, relative to its position. `normal` is its unit
/// normal, `to_light` the unit direction toward the light, `biases` the light's bias toward the
/// light and normal bias in meters, and `texel` the size of a shadow map texel at the point. Each
/// bias keeps its size in meters in every cascade, so it does not jump where one cascade gives way
/// to the next. One texel caps it, as a finer map needs less. Then it scales by the surface's angle
/// to the light: the normal bias by the angle's sine, and the bias toward the light by its tangent,
/// up to `MAX_SLOPE`. A surface that faces the light moves little, so a caster's
/// shadow starts where it stands on such a surface. One at a steep angle moves further, as its depth
/// changes faster across each texel.
fn bias_offset(normal: vec3f, to_light: vec3f, biases: vec2f, texel: f32) -> vec3f {
    let cosine = clamp(dot(normal, to_light), 0.0, 1.0);
    let sine = sqrt(1.0 - cosine * cosine);
    let slope = min(sine, MAX_SLOPE * cosine) / max(cosine, 1e-4);
    let capped = min(biases, vec2f(texel));
    return to_light * (capped.x * slope) + normal * (capped.y * sine);
}

/// The plane of a receiver at `relative`, with unit normal `normal` and unit direction `to_light`
/// toward the light, in the texels of a cascade whose matrix is `view_proj` and whose layers have
/// `size` texels on each side. The cascade's projection is orthographic, so the plane stays a plane
/// in the map. Two directions along the surface give how its texel and its depth change, and the
/// depth's change per texel follows from them.
fn receiver_plane(
    view_proj: mat4x4f,
    relative: vec3f,
    normal: vec3f,
    to_light: vec3f,
    size: f32,
) -> ReceiverPlane {
    let cosine = dot(normal, to_light);
    if cosine <= 0.0 {
        return no_plane();
    }
    let clip = view_proj * vec4f(relative, 1.0);
    let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(normal.x) > 0.9);
    let along = normalize(cross(normal, helper));
    let a = view_proj * vec4f(along, 0.0);
    let b = view_proj * vec4f(cross(normal, along), 0.0);
    var flip = vec2f(0.5, -0.5);
#ifdef WEBGL2
    // WebGL2 keeps the rows of a drawn texture bottom first.
    flip.y = 0.5;
#endif
    let ta = a.xy * flip * size;
    let tb = b.xy * flip * size;
    let at = (clip.xy * flip + 0.5) * size;
    let det = ta.x * tb.y - ta.y * tb.x;
    if abs(det) < 1e-12 {
        return no_plane();
    }
    // A surface nearly edge-on to the light rises steeply across each texel. It takes the steepest
    // slope that the filter follows, as a smaller rise only leaves more of the old comparison.
    let sine = sqrt(max(1.0 - cosine * cosine, 0.0));
    let steepness = min(1.0, MAX_PLANE_SLOPE * cosine / max(sine, 1e-4));
    let slope = vec2f(a.z * tb.y - b.z * ta.y, b.z * ta.x - a.z * tb.x) / det * steepness;
    let margin = PLANE_MARGIN * (view_proj * vec4f(to_light, 0.0)).z;
    return ReceiverPlane(at, clip.z - margin, slope);
}

/// Whether the receiver sees past each of four texels of layer `layer` of the cascades: 1 for a
/// texel that lies behind it, 0 for one that shadows it. `first` is the first texel's place, in
/// whole texels from the map's corner. The others are the next along x, the next along y and the
/// next along both, in that order. Each texel compares with the receiver's `plane` at the texel's
/// center, or with the receiver's own `depth` where that lies nearer the light. A caster such as a
/// pavement slab holds its own bottom face under its lit top. That face rises toward the light
/// across the texels as the top does, so it stays below the plane at every texel, and the top
/// stays lit however coarse the texels are. A caster on the plane or in front of it, such as a box
/// standing on it, shadows it, so the shadow meets the box's base. `size` is the texels on each
/// side of a layer.
fn sun_texels(first: vec2f, layer: u32, depth: f32, plane: ReceiverPlane, size: f32) -> vec4f {
    let slope = plane.slope;
    let at_first = plane.depth + dot(first + 0.5 - plane.at, slope);
    let reference = max(vec4f(depth), at_first + vec4f(0.0, slope.x, slope.y, slope.x + slope.y));
#ifdef WEBGL2
    // A comparison at a texel's center tests that texel alone.
    let center = (first + 0.5) / size;
    let next = vec2f(1.0 / size, 0.0);
    return vec4f(
        textureSampleCompareLevel(shadow_map, shadow_sampler, center, layer, reference.x),
        textureSampleCompareLevel(shadow_map, shadow_sampler, center + next, layer, reference.y),
        textureSampleCompareLevel(shadow_map, shadow_sampler, center + next.yx, layer, reference.z),
        textureSampleCompareLevel(shadow_map, shadow_sampler, center + next.xx, layer, reference.w),
    );
#else
    // One read gives the four texels around the corner that they share: the next along y, the
    // next along both, the next along x, then the first.
    let stored = textureGather(0, shadow_map, shadow_texels, (first + 1.0) / size, layer).wzxy;
    return step(stored, reference);
#endif
}

/// The blend of the block of 2 x 2 texels from `first` on (`sun_texels`), with the weights `x` of
/// its two columns and `y` of its two rows.
fn sun_block(
    first: vec2f,
    x: vec2f,
    y: vec2f,
    layer: u32,
    depth: f32,
    plane: ReceiverPlane,
    size: f32,
) -> f32 {
    return dot(x.xyxy * y.xxyy, sun_texels(first, layer, depth, plane, size));
}

/// The share of the main directional light that reaches a receiver at `uv` in layer `layer` of the
/// cascades, blended over the filter's square of texels. `kernel` holds the texels on each side of
/// a layer and the filter's square. Each texel takes its share in the atlas's filter (`filtered`),
/// whose samples blend the texels in pairs. So the square of 3 texels weights 4 x 4 texels, the
/// square of 5 weights 6 x 6, and a smaller value the 2 x 2 around the point, as one sample of the
/// comparison sampler does. Each texel compares with `depth` and `plane` (`sun_texels`), four at a
/// time, so the squares of 3 and 5 take 4 and 9 reads, as many as the atlas's filter.
fn sun_filtered(kernel: vec4f, uv: vec2f, layer: u32, depth: f32, plane: ReceiverPlane) -> f32 {
    let size = kernel.x;
    let taps = kernel.z;
    // The texel corner nearest to the point, and the point's place from the center of the texel
    // before that corner, from 0 to 1 on each axis. That texel's place is `corner - 1`.
    let corner = floor(uv * size + 0.5);
    let s = uv * size + 0.5 - corner;
    let t = vec2f(1.0) - s;
    if taps < 3.0 {
        return sun_block(corner - 1.0, vec2f(t.x, s.x), vec2f(t.y, s.y), layer, depth, plane, size);
    }
    if taps < 5.0 {
        // Along each axis, the first block's texels weigh 1 - s and 2 - s, the second's 1 + s and
        // s, out of 4.
        let b = vec2f(2.0) - s;
        let c = vec2f(1.0) + s;
        let x0 = vec2f(t.x, b.x);
        let y0 = vec2f(t.y, b.y);
        let x1 = vec2f(c.x, s.x);
        let y1 = vec2f(c.y, s.y);
        let first = corner - 2.0;
        let sum = sun_block(first, x0, y0, layer, depth, plane, size)
            + sun_block(first + vec2f(2.0, 0.0), x1, y0, layer, depth, plane, size)
            + sun_block(first + vec2f(0.0, 2.0), x0, y1, layer, depth, plane, size)
            + sun_block(first + 2.0, x1, y1, layer, depth, plane, size);
        return sum / 16.0;
    }
    // Along each axis, the three blocks' texels weigh 1 - s and 3 - 2s, 4 - s and 3 + s, then
    // 1 + 2s and s, out of 12.
    let b = vec2f(3.0) - 2.0 * s;
    let c = vec2f(4.0) - s;
    let d = vec2f(3.0) + s;
    let e = vec2f(1.0) + 2.0 * s;
    let x0 = vec2f(t.x, b.x);
    let y0 = vec2f(t.y, b.y);
    let x1 = vec2f(c.x, d.x);
    let y1 = vec2f(c.y, d.y);
    let x2 = vec2f(e.x, s.x);
    let y2 = vec2f(e.y, s.y);
    let first = corner - 3.0;
    var sum = sun_block(first, x0, y0, layer, depth, plane, size);
    sum += sun_block(first + vec2f(2.0, 0.0), x1, y0, layer, depth, plane, size);
    sum += sun_block(first + vec2f(4.0, 0.0), x2, y0, layer, depth, plane, size);
    sum += sun_block(first + vec2f(0.0, 2.0), x0, y1, layer, depth, plane, size);
    sum += sun_block(first + vec2f(2.0, 2.0), x1, y1, layer, depth, plane, size);
    sum += sun_block(first + vec2f(4.0, 2.0), x2, y1, layer, depth, plane, size);
    sum += sun_block(first + vec2f(0.0, 4.0), x0, y2, layer, depth, plane, size);
    sum += sun_block(first + vec2f(2.0, 4.0), x1, y2, layer, depth, plane, size);
    sum += sun_block(first + vec2f(4.0, 4.0), x2, y2, layer, depth, plane, size);
    return sum / 144.0;
}

/// How much of the main directional light reaches a point: 1 in full light, 0 in full shadow.
/// `relative` is the point's position relative to the camera, `normal` its unit normal, which
/// moves the point off its own surface before the lookup, and `to_light` the unit direction toward
/// the light.
fn sun_shadow(relative: vec3f, normal: vec3f, to_light: vec3f) -> f32 {
    let count = u32(cascades.forward.w);
    let seen = relative + cascades.origin.xyz;
    let along = dot(seen, cascades.forward.xyz);
    let end = cascades.ends[max(count, 1u) - 1u];
    if count == 0u || along >= end {
        return 1.0;
    }
    // Behind a perspective camera, a receiver's cascade comes from its distance from the camera,
    // which turning the camera leaves alone, so its shadow stays the same as the view turns. Behind
    // an orthographic camera, whose cascades have texels of one size, it comes from its distance
    // along the view.
    let distance = mix(along, length(seen) * length(cascades.forward.xyz), cascades.biases.z);
    // Both loops below run MAX_CASCADES passes at every pixel, and the cascade count only chooses
    // the passes that do work. Adreno 830's driver ran a loop the wrong number of times when its
    // pass count differed between the pixels of a work group, as the fractal noise in
    // null3d::noise found. The cascades end farther out one after another, so the cascade that
    // holds the distance comes after each cascade whose end the distance passed.
    var first = 0u;
    for (var k = 0u; k < MAX_CASCADES; k++) {
        if k + 1u < count && distance >= cascades.ends[k] {
            first = k + 1u;
        }
    }
    // A box that kept its place while the camera turned can miss the point; the next cascade's
    // box is larger.
    var cascade = MAX_CASCADES;
    var clip = vec4f(0.0);
    for (var k = 0u; k < MAX_CASCADES; k++) {
        if cascade == MAX_CASCADES && k >= first && k < count {
            let at = sun_clip(k, relative, normal, to_light);
            if sun_holds(at) {
                cascade = k;
                clip = at;
            }
        }
    }
    if cascade == MAX_CASCADES {
        return 1.0;
    }
    var lit = sun_layer(cascade, clip, relative, normal, to_light);
    // In the band at the cascade's far end, the shadow fades linearly into the next cascade's, which
    // the next box holds there. Only the band's receivers read a second layer.
    let band = cascades.bands[cascade];
    if cascade == first && cascade + 1u < count && distance > band {
        let next = cascade + 1u;
        let at = sun_clip(next, relative, normal, to_light);
        if sun_holds(at) {
            let weight = (distance - band) / max(cascades.ends[cascade] - band, 1e-6);
            lit = mix(lit, sun_layer(next, at, relative, normal, to_light), min(weight, 1.0));
        }
    }
    return mix(lit, 1.0, smoothstep(end * (1.0 - FADE_SHARE), end, along));
}

/// The clip position in cascade `cascade` of a receiver at `relative`, with unit normal `normal`
/// and unit direction `to_light` toward the light, after the light's biases at that cascade's
/// texels move it.
fn sun_clip(cascade: u32, relative: vec3f, normal: vec3f, to_light: vec3f) -> vec4f {
    let texel = cascades.texels[cascade];
    let offset = bias_offset(normal, to_light, cascades.biases.xy, texel);
    return cascades.view_proj[cascade] * vec4f(relative + offset, 1.0);
}

/// True when a cascade's box holds the clip position `clip`, with the texels that the filter reads
/// beyond the point, up to three, inside its layer.
fn sun_holds(clip: vec4f) -> bool {
    let inside = 1.0 - 6.0 * cascades.kernel.y;
    return !any(abs(clip.xy) > vec2f(inside));
}

/// How much of the main directional light reaches a receiver through cascade `cascade`, where the
/// receiver lies at `clip` in the cascade's clip space (`sun_clip`), blended over the filter's
/// square of texels.
fn sun_layer(cascade: u32, clip: vec4f, relative: vec3f, normal: vec3f, to_light: vec3f) -> f32 {
    var uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
    // WebGL2 keeps the rows of a drawn texture bottom first.
    uv.y = 1.0 - uv.y;
#endif
    let m = cascades.view_proj[cascade];
    let plane = receiver_plane(m, relative, normal, to_light, cascades.kernel.x);
    return sun_filtered(cascades.kernel, uv, cascade, clip.z, plane);
}

/// The comparison of `depth` with layer `layer` of the shadow atlas around `uv`, blended over the
/// filter's square of texels with even weights. `kernel` holds the texels on each side of a layer,
/// the size of one texel and the filter's square. Each sample of the comparison sampler blends four
/// texels, so a square of 3 texels takes 4 samples and a square of 5 takes 9. The samples sit
/// between texels where their bilinear weights give each texel of the square its share (Ignacio
/// Castaño's filter for The Witness).
fn filtered(kernel: vec4f, uv: vec2f, layer: u32, depth: f32) -> f32 {
    let size = kernel.x;
    let texel = kernel.y;
    let taps = kernel.z;
    if taps < 3.0 {
        return textureSampleCompareLevel(shadow_atlas, shadow_sampler, uv, layer, depth);
    }
    // The texel corner nearest to the point, and the point's place from the texel center before
    // that corner, from 0 to 1 on each axis.
    let corner = floor(uv * size + 0.5);
    let s = uv * size + 0.5 - corner;
    let origin = (corner - 0.5) * texel;
    var weights: array<vec2f, 3>;
    var offsets: array<vec2f, 3>;
    var samples = 2u;
    var total = 16.0;
    if taps < 5.0 {
        weights[0] = 3.0 - 2.0 * s;
        weights[1] = 1.0 + 2.0 * s;
        offsets[0] = (2.0 - s) / weights[0] - 1.0;
        offsets[1] = s / weights[1] + 1.0;
    } else {
        samples = 3u;
        total = 144.0;
        weights[0] = 4.0 - 3.0 * s;
        weights[1] = vec2f(7.0);
        weights[2] = 1.0 + 3.0 * s;
        offsets[0] = (3.0 - 2.0 * s) / weights[0] - 2.0;
        offsets[1] = (3.0 + s) / 7.0;
        offsets[2] = s / weights[2] + 2.0;
    }
    var sum = 0.0;
    for (var row = 0u; row < samples; row += 1u) {
        for (var column = 0u; column < samples; column += 1u) {
            let at = origin + vec2f(offsets[column].x, offsets[row].y) * texel;
            let lit = textureSampleCompareLevel(shadow_atlas, shadow_sampler, at, layer, depth);
            sum += weights[column].x * weights[row].y * lit;
        }
    }
    return sum / total;
}

/// The face of a point light's cube that a direction from the light points through, in the order
/// of its tiles: +x, -x, +y, -y, +z, -z.
fn cube_face(direction: vec3f) -> u32 {
    let size = abs(direction);
    if size.x >= size.y && size.x >= size.z {
        return select(1u, 0u, direction.x > 0.0);
    }
    if size.y >= size.z {
        return select(3u, 2u, direction.y > 0.0);
    }
    return select(5u, 4u, direction.z > 0.0);
}

/// How much of a point or spot light reaches a point: 1 in full light, 0 in full shadow. `first`
/// is the light's first tile. `relative` is the point's position relative to the camera, `normal`
/// its unit normal, `to_light` the unit direction toward the light, and `gap` the distance to it.
/// The light's biases are in meters, up to one texel of the tile at the point's distance from the
/// light (`bias_offset`). A point outside its tile's view is lit.
fn light_shadow(first: u32, relative: vec3f, normal: vec3f, to_light: vec3f, gap: f32) -> f32 {
    let params = tiles.params[first];
    let moved = relative + bias_offset(normal, to_light, params.yz, params.x * gap);
    var tile = first;
    if params.w > 1.5 {
        tile += cube_face(moved - (relative + to_light * gap));
    }
    let clip = tiles.view_proj[tile] * vec4f(moved, 1.0);
    if clip.w <= 0.0 {
        return 1.0;
    }
    let ndc = clip.xyz / clip.w;
    if abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 {
        return 1.0;
    }
    var uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
    // WebGL2 keeps the rows of a drawn texture bottom first.
    uv.y = 1.0 - uv.y;
#endif
    return filtered(tiles.kernel, uv, tile, ndc.z);
}
