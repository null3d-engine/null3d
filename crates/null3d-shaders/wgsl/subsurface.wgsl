// The subsurface blur's two steps: one triangle each over the render size's drawn corner. Light
// that enters skin leaves it a few millimetres away, redder the further it went. The skin pass drew
// the diffuse light that scatters into a target of its own (null3d::subsurface), and these steps
// spread it over the skin around each pixel, as Jimenez et al.'s separable subsurface scattering
// does, with Burley's diffusion profile for each color channel:
//
// - `across` blurs the skin target along the rows, into a target of half floats that keeps each
//   pixel's view distance in alpha.
// - `down` blurs that along the columns, and writes the scene's color plus the blurred light less
//   the sharp light, where the skin is the surface in front. Every other pixel keeps the scene's
//   color.
//
// Each tap's weight is the profile at the distance in the world between the tap's surface and the
// pixel's, from their view distances, so light never crosses from a nose to the cheek behind it.
// The taps reach the largest channel's scatter distance, more densely near the pixel. Where that
// distance covers less than a pixel, the pixel keeps its light. The MULTISAMPLED build reads
// sample 0 of a multisampled scene depth, on WebGPU. WebGPU draws a corner into a target's first
// rows, and WebGL2, which counts rows from the bottom, into its last, so the frame builder writes
// where the corner starts. A fragment's position and a texture's rows count the same way on each
// path.
#import null3d::subsurface::{scatter_distances, scattered_light}

/// A step's settings, which the frame builder writes for each step.
struct Step {
    /// xy: the first texel of the drawn corner. zw: its last texel.
    corner: vec4f,
    /// The projection's terms of x and y: its scales of x and y, then the shares of z that it
    /// adds to each. A position in view space at normalized place `ndc` and view-space z has
    /// x = (ndc.x * w - lens.z * z - offset.x) / lens.x, and y in the same way.
    lens: vec4f,
    /// xy: the projection's constant terms of x and y. zw: its terms of the clip's w, which is
    /// z * offset.z + offset.w.
    offset: vec4f,
    /// x: 1 where rows count down the image, as on WebGPU, and -1 where they count up, as on
    /// WebGL2. yzw: unused.
    rows: vec4f,
    /// The inverse projection's terms that turn a scene depth value into a view distance: the
    /// view-space z is (x * depth + y) / (z * depth + w).
    depth: vec4f,
    /// xy: the step's direction in texels. z: the taps. w: the drawn corner's size along it.
    taps: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Step;
/// The skin pass's target: the scattered light and scatter distances in its color, the view
/// distance in alpha, 0 where no skin drew.
@group(0) @binding(1) var skin: texture_2d<f32>;
/// The `across` step's target, which `down` blurs.
@group(0) @binding(2) var across_target: texture_2d<f32>;
/// The scene's color, which `down` adds the change to.
@group(0) @binding(3) var scene_color: texture_2d<f32>;
#ifdef MULTISAMPLED
@group(0) @binding(4) var scene_depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(4) var scene_depth: texture_2d<f32>;
#endif

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The position in view space of the surface at texel `texel` whose view distance is `away`.
fn view_position(texel: vec2f, away: f32) -> vec3f {
    let size = settings.corner.zw - settings.corner.xy + 1.0;
    let at = (texel - settings.corner.xy + 0.5) / size * 2.0 - 1.0;
    let ndc = vec2f(at.x, at.y * -settings.rows.x);
    let z = -away;
    let w = z * settings.offset.z + settings.offset.w;
    let lens = settings.lens;
    let x = (ndc.x * w - lens.z * z - settings.offset.x) / lens.x;
    let y = (ndc.y * w - lens.w * z - settings.offset.y) / lens.y;
    return vec3f(x, y, z);
}

/// Texels per world unit along the step's direction, at view distance `away`.
fn texels_per_unit(away: f32) -> f32 {
    let w = -away * settings.offset.z + settings.offset.w;
    let lens = select(settings.lens.y, settings.lens.x, settings.taps.x != 0.0);
    return abs(lens / w) * 0.5 * settings.taps.w;
}

/// The weight of a tap at distance `r` in the world from the pixel, for scatter distances `d`:
/// Burley's normalized diffusion profile along one line, `(e^(-r/s) + e^(-r/3s)) / sqrt(r)`,
/// where `s` is each channel's shape, as the Khronos sample renderer sets it for an albedo of 1.
/// `near` keeps the line's peak finite at the pixel itself.
fn profile(r: f32, d: vec3f, near: f32) -> vec3f {
    let s = max(d * 0.0765, vec3f(1e-7));
    let fade = exp(-r / (3.0 * s));
    return (fade * fade * fade + fade) / sqrt(max(r, near));
}

/// What one step's taps share: the pixel's view position, its scatter distances, the blur's
/// radius in texels, the spacing of the taps' places and the floor of a tap's distance.
struct Kernel {
    here: vec3f,
    d: vec3f,
    radius: f32,
    spacing: f32,
    near: f32,
}

/// The kernel of the pixel at `texel` at view distance `away` with scatter distances `d`, or a
/// radius of 0 where the blur covers less than a texel.
fn kernel_at(texel: vec2i, away: f32, d: vec3f) -> Kernel {
    let per_unit = texels_per_unit(away);
    let radius = max(d.x, max(d.y, d.z)) * per_unit;
    var k: Kernel;
    k.here = view_position(vec2f(texel), away);
    k.d = d;
    k.radius = select(0.0, radius, radius >= 1.0);
    k.spacing = 2.0 / (settings.taps.z - 1.0);
    k.near = 0.5 / per_unit;
    return k;
}

/// The place of tap `index` within the taps' line from -1 to 1. The taps lie closer together
/// near the pixel, where the profile changes fastest.
fn tap_place(k: Kernel, index: u32) -> f32 {
    return f32(index) * k.spacing - 1.0;
}

/// The texel of the tap at place `o`, within the drawn corner.
fn tap_texel(texel: vec2i, k: Kernel, o: f32) -> vec2i {
    let offset = vec2i(round(settings.taps.xy * o * abs(o) * k.radius));
    return clamp(texel + offset, vec2i(settings.corner.xy), vec2i(settings.corner.zw));
}

/// The weight of the tap at place `o`, whose texel `at` shows a surface at view distance `away`:
/// the profile at the distance between the two surfaces, times the share of the line it stands
/// for.
fn tap_weight(k: Kernel, o: f32, at: vec2i, away: f32) -> vec3f {
    let r = distance(view_position(vec2f(at), away), k.here);
    return profile(r, k.d, k.near) * 2.0 * abs(o) * k.radius * k.spacing;
}

/// The weight of the pixel's own light: the share of the line closest to it.
fn center_weight(k: Kernel) -> vec3f {
    return profile(0.0, k.d, k.near) * k.radius * k.spacing * k.spacing * 0.5;
}

/// The skin target's light along the rows around `texel`, from the pixel's own `light`.
fn blur_across(texel: vec2i, light: vec3f, k: Kernel) -> vec3f {
    var weights = center_weight(k);
    var sum = light * weights;
    for (var index = 0u; index < u32(settings.taps.z); index++) {
        let o = tap_place(k, index);
        let at = tap_texel(texel, k, o);
        let s = textureLoad(skin, at, 0);
        if o == 0.0 || s.a <= 0.0 {
            continue;
        }
        let weight = tap_weight(k, o, at, s.a);
        weights += weight;
        sum += scattered_light(s) * weight;
    }
    return sum / max(weights, vec3f(1e-20));
}

/// The `across` step's light along the columns around `texel`, from the pixel's own `light`.
fn blur_down(texel: vec2i, light: vec3f, k: Kernel) -> vec3f {
    var weights = center_weight(k);
    var sum = light * weights;
    for (var index = 0u; index < u32(settings.taps.z); index++) {
        let o = tap_place(k, index);
        let at = tap_texel(texel, k, o);
        let s = textureLoad(across_target, at, 0);
        if o == 0.0 || s.a <= 0.0 {
            continue;
        }
        let weight = tap_weight(k, o, at, s.a);
        weights += weight;
        sum += s.rgb * weight;
    }
    return sum / max(weights, vec3f(1e-20));
}

@fragment
fn across(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let s = textureLoad(skin, texel, 0);
    if s.a <= 0.0 {
        return vec4f(0.0);
    }
    let light = scattered_light(s);
    let k = kernel_at(texel, s.a, scatter_distances(s));
    if k.radius == 0.0 {
        return vec4f(light, s.a);
    }
    return vec4f(blur_across(texel, light, k), s.a);
}

/// The scene's view distance at `texel`, from its first depth sample.
fn scene_distance(texel: vec2i) -> f32 {
    let depth = textureLoad(scene_depth, texel, 0).x;
    let d = settings.depth;
    return -(d.x * depth + d.y) / (d.z * depth + d.w);
}

@fragment
fn down(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let color = textureLoad(scene_color, texel, 0);
    let s = textureLoad(skin, texel, 0);
    // Only skin that is the surface in front changes, so skin behind another object keeps it.
    let front = s.a > 0.0 && s.a <= scene_distance(texel) * 1.002 + 1e-4;
    if !front {
        return color;
    }
    let k = kernel_at(texel, s.a, scatter_distances(s));
    if k.radius == 0.0 {
        return color;
    }
    let blurred = blur_down(texel, textureLoad(across_target, texel, 0).rgb, k);
    return vec4f(max(color.rgb + blurred - scattered_light(s), vec3f(0.0)), color.a);
}
