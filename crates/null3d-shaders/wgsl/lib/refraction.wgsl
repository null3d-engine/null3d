#define_import_path null3d::refraction
#import null3d::globals::{EnvironmentLight}
#import null3d::ibl::{environment_map, has_environment, map_direction}
#import null3d::tables::{environment_sampler}
#import null3d::ibl::{roughness_level}
#import null3d::mesh::{ambient_light, frame}
#import null3d::depth::{distance_code}

// Light that passes through a surface, as three.js's MeshPhysicalMaterial lets it through
// (transmission_pars_fragment, after the glTF Sample Viewer). The camera's view copies the color of
// its opaque objects into a texture with a whole chain of mip levels before its transparent pass,
// in which such surfaces draw. A surface finds where the light that reaches it left that copy: it
// follows the refracted view ray through the volume under it, as thick as the material says, and
// projects the ray's exit point onto the screen. It samples the copy there, at a mip level that its
// roughness sets, with three.js's bicubic filter across two levels, and the volume's color
// absorbs part of the light over the ray's length, by Beer's law.
//
// The copy has the canvas's size, and the frame draws the render size into its corner: the first
// rows on WebGPU, and the last on WebGL2, which counts rows from the bottom. On the 8-bit path it
// holds display color, decoded to linear by its sRGB format. Views other than the camera's have
// no copy, as the frame's values say: there the light comes from the environment, along the
// refracted ray.
//
// The copy's first level keeps the opaque depth's distance code in its alpha. Where the bent ray
// lands on an opaque surface that stands in front of the surface, such as a flower on the bank in
// front of water, that surface cannot be what light passes through. The light then comes from
// the surface's own pixel, unbent, whose opaque surface the depth test keeps behind it.

/// The copy of the view's opaque color, at binding 15 of the frame's group. The environment's
/// sampler reads it with a linear filter between levels.
@group(0) @binding(15) var transmission_map: texture_2d_array<f32>;

/// True while the view's frame copied its opaque color for surfaces that let light through.
fn has_copy() -> bool {
    return frame.camera_world.w > 0.5;
}

/// The direction and length of the path that light takes through a volume of `thickness` in the
/// mesh's own units, which `scale` turns into world units along each axis, after it enters it
/// toward the camera at a surface of unit normal `normal` with index of refraction `ior`. `to_view`
/// points from the surface toward the camera.
fn volume_ray(normal: vec3f, to_view: vec3f, thickness: f32, ior: f32, scale: vec3f) -> vec3f {
    let refracted = refract(-to_view, normal, 1.0 / ior);
    return normalize(refracted) * thickness * scale;
}

/// The share of each primary that a volume lets through over `distance`: `color` after
/// `attenuation_distance`, by Beer's law, or all of it where the distance is 0, the volume that
/// absorbs nothing.
fn volume_attenuation(distance: f32, color: vec3f, attenuation_distance: f32) -> vec3f {
    if attenuation_distance <= 0.0 {
        return vec3f(1.0);
    }
    let coefficient = -log(max(color, vec3f(1e-6))) / attenuation_distance;
    return exp(-coefficient * distance);
}

/// The roughness that blurs the light through a surface: none at an index of refraction of 1, and
/// all of its roughness from 1.5, as three.js scales it.
fn refraction_roughness(roughness: f32, ior: f32) -> f32 {
    return roughness * saturate(ior * 2.0 - 2.0);
}

// The B-spline weights of three.js's bicubic filter (Mipped Bicubic Texture Filtering by N8): the
// two amplitudes and the two offsets of each axis, at the fraction `a` between texels.
fn bspline_g0(a: f32) -> f32 {
    return (a * (a * (-a + 3.0) - 3.0) + 1.0 + a * a * (3.0 * a - 6.0) + 4.0) / 6.0;
}
fn bspline_g1(a: f32) -> f32 {
    return (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0 + a * a * a) / 6.0;
}
fn bspline_h0(a: f32) -> f32 {
    let w0 = a * (a * (-a + 3.0) - 3.0) + 1.0;
    let w1 = a * a * (3.0 * a - 6.0) + 4.0;
    return -1.0 + w1 / (w0 + w1);
}
fn bspline_h1(a: f32) -> f32 {
    let w2 = a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0;
    let w3 = a * a * a;
    return 1.0 + w3 / (w2 + w3);
}

/// The copy at texture coordinates `uv` of mip level `level`, through a cubic B-spline over the
/// level's texels, from four linear samples.
fn bicubic_level(uv: vec2f, level: f32) -> vec3f {
    let size = vec2f(textureDimensions(transmission_map, i32(level)));
    let at = uv * size + 0.5;
    let whole = floor(at);
    let part = at - whole;
    let g0 = vec2f(bspline_g0(part.x), bspline_g0(part.y));
    let g1 = vec2f(bspline_g1(part.x), bspline_g1(part.y));
    let h0 = (whole + vec2f(bspline_h0(part.x), bspline_h0(part.y)) - 0.5) / size;
    let h1 = (whole + vec2f(bspline_h1(part.x), bspline_h1(part.y)) - 0.5) / size;
    let s00 = textureSampleLevel(transmission_map, environment_sampler, h0, 0, level).rgb;
    let s10 = textureSampleLevel(transmission_map, environment_sampler, vec2f(h1.x, h0.y), 0, level).rgb;
    let s01 = textureSampleLevel(transmission_map, environment_sampler, vec2f(h0.x, h1.y), 0, level).rgb;
    let s11 = textureSampleLevel(transmission_map, environment_sampler, h1, 0, level).rgb;
    return g0.y * (g0.x * s00 + g1.x * s10) + g1.y * (g0.x * s01 + g1.x * s11);
}

/// How much smaller an opaque surface's distance code must be than the surface's own before it
/// counts as standing in front of it: one step of the code that the copy's alpha keeps, 8 bits on
/// the 8-bit path and a half float's 11 bits of precision on the HDR path, and half an 8-bit step
/// more, about 2% of the distance, for the place where the opaque surface meets the surface.
#ifdef TONE_MAP
const IN_FRONT: f32 = 1.5 / 255.0;
#else
const IN_FRONT: f32 = 0.5 / 255.0 + 1.0 / 2048.0;
#endif

/// The texture coordinates of the copy at `at`, a place in pixels down from the drawn corner's
/// top-left, kept inside the part of the copy that the frame drew, which `drawn` sizes in the copy
/// of size `full`.
fn copy_uv(at: vec2f, drawn: vec2f, full: vec2f) -> vec2f {
    var uv = clamp(at, vec2f(0.5), drawn - 0.5) / full;
#ifdef WEBGL2
    uv.y = 1.0 - uv.y;
#endif
    return uv;
}

/// The nearest distance code that the copy keeps at `at`, as `copy_uv` places it, and at the four
/// pixels beside it, which its filter reads too. An opaque edge's pixel can hold the color of the
/// surface in front with the depth of the one behind.
fn nearest_code(at: vec2f, drawn: vec2f, full: vec2f) -> f32 {
    var nearest = 1.0;
    for (var k = 0; k < 5; k++) {
        let side = select(-1.0, 1.0, (k & 1) == 1) * select(0.0, 1.0, k > 0);
        let beside = select(vec2f(0.0, side), vec2f(side, 0.0), k < 3);
        let texel = vec2i(copy_uv(at + beside, drawn, full) * full);
        nearest = min(nearest, textureLoad(transmission_map, texel, 0, 0).a);
    }
    return nearest;
}

/// The copy's light at the point that `clip`, a position in clip space, projects to, blurred by
/// `roughness` of a surface with index of refraction `ior`. The point stays inside the part of the
/// copy that the frame drew. Where the copy's opaque surface there stands in front of the surface
/// at `pixel`, its fragment position, the light comes from that pixel instead.
fn copied_light(clip: vec4f, pixel: vec3f, roughness: f32, ior: f32) -> vec3f {
    let full = vec2f(textureDimensions(transmission_map, 0));
    let drawn = frame.target_size.xy;
    // Down from the drawn corner's top-left, in its pixels.
    let ndc = clip.xy / clip.w;
    let bent = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * drawn;
    var uv = copy_uv(bent, drawn, full);
    if nearest_code(bent, drawn, full) < distance_code(pixel.z) - IN_FRONT {
        // A fragment's position counts rows as the copy keeps them on each GPU path.
        uv = pixel.xy / full;
    }
    let last = floor(log2(max(full.x, full.y)));
    let level = min(log2(drawn.x) * refraction_roughness(roughness, ior), last);
    let low = floor(level);
    let below = bicubic_level(uv, low);
    let above = bicubic_level(uv, min(low + 1.0, last));
    return mix(below, above, level - low);
}

/// The environment's light from direction `d` as a surface of perceptual `roughness` takes it,
/// times the environment's intensity, or the frame's ambient and hemisphere light along `d` without
/// an environment.
fn surrounding_light(env: EnvironmentLight, d: vec3f, roughness: f32) -> vec3f {
    if !has_environment(env) {
        return ambient_light(d);
    }
    let level = roughness_level(roughness, env.params.x);
    let light = textureSampleLevel(environment_map, environment_sampler, map_direction(env, d), level);
    return light.rgb * env.params.y;
}

/// The light that passes through a surface at `relative`, a position relative to the camera, of
/// unit `normal`, toward the camera along `to_view`, before the surface's own Fresnel term and
/// color take their share: the copy's light where the refracted ray leaves the volume, or the
/// environment's along the ray without a copy, times what the volume lets through over the ray.
/// `pixel` is the fragment's position, `thickness` and `ior` the volume's thickness and index of
/// refraction, `attenuation` its color and distance, and `scale` the object's scale along each
/// axis.
fn transmitted_light(
    pixel: vec3f,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    roughness: f32,
    thickness: f32,
    ior: f32,
    attenuation: vec4f,
    scale: vec3f,
) -> vec3f {
    let ray = volume_ray(normal, to_view, thickness, ior, scale);
    var light: vec3f;
    if has_copy() {
        light = copied_light(frame.view_proj * vec4f(relative + ray, 1.0), pixel, roughness, ior);
    } else {
        let d = normalize(refract(-to_view, normal, 1.0 / ior));
        let blurred = refraction_roughness(roughness, ior);
        light = surrounding_light(frame.environment, d, blurred);
    }
    return light * volume_attenuation(length(ray), attenuation.rgb, attenuation.w);
}
