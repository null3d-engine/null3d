#define_import_path null3d::coat_sheen
#import null3d::globals::{EnvironmentLight}
#import null3d::ibl::{environment_radiance}
#import null3d::lighting::{brdf_ggx, dfg_lut, environment_brdf, f_schlick}
#import null3d::math::{INV_PI, PI, half_vector, max_component}

// The layers above a surface's base, as three.js's MeshPhysicalMaterial lights them: a clear coat
// and a sheen. The coat is a second GGX lobe, with a reflectance of 0.04 head on and 1 at grazing
// angles, at the coat's own normal and roughness. It reflects the environment through the
// split-sum table too. Everything below it dims by the share that its Fresnel term reflects. The
// sheen is the Charlie lobe of cloth (Estevez and Kulla) with Neubelt's visibility term. The light
// that the base gets dims by the sheen's directional albedo, which three.js's curve fit gives
// (`IBLSheenBRDF`), and the sheen's light from all directions is the irradiance times its color
// and that albedo.
//
// A template sets the surface's layers with `begin_layers` before it lights the surface. Each
// direct light then calls `layered_light`, which gathers the layers' light and returns the factor
// of the light that reaches the base. The ambient light and the environment call
// `layered_ambient`, `layered_environment` and `coat_environment`. `finish_layers` puts the layers
// over the base's light at the end. The layers' math runs at full precision in every build.

/// A surface's layers above its base, ready to light.
struct Layers {
    /// How much of the clear coat covers the surface, from 0 (none) to 1.
    coat: f32,
    /// The coat's perceptual roughness, raised as the base's roughness is.
    coat_roughness: f32,
    /// The coat's unit normal: the mesh's, or the coat normal map's.
    coat_normal: vec3f,
    /// The sheen's linear color: black for none.
    sheen_color: vec3f,
    /// The sheen's perceptual roughness, from 0.0001 to 1.
    sheen_roughness: f32,
}

/// The layers of the surface that the pixel shows.
var<private> surface_layers: Layers;
/// The coat's light from the direct lights so far, before the coat's factor.
var<private> coat_direct: vec3f;
/// The coat's light from the environment, before the coat's factor.
var<private> coat_indirect: vec3f;
/// The sheen's light so far, from the direct lights and from all directions.
var<private> sheen_light: vec3f;

/// The Charlie distribution of sheen, as three.js's `D_Charlie`.
fn d_charlie(roughness: f32, n_dot_h: f32) -> f32 {
    let alpha = roughness * roughness;
    let inv_alpha = 1.0 / alpha;
    // 2^(-14/2), so the sine squared stays above 0 at half precision too.
    let sin2h = max(1.0 - n_dot_h * n_dot_h, 0.0078125);
    return (2.0 + inv_alpha) * pow(sin2h, inv_alpha * 0.5) / (2.0 * PI);
}

/// Neubelt and Pettineo's visibility term of sheen, as three.js's `V_Neubelt`.
fn v_neubelt(n_dot_v: f32, n_dot_l: f32) -> f32 {
    return saturate(1.0 / (4.0 * (n_dot_l + n_dot_v - n_dot_l * n_dot_v)));
}

/// The sheen's directional albedo when seen at `n_dot_v`, by three.js's curve fit of the Charlie
/// lobe's integral (`IBLSheenBRDF`).
fn sheen_albedo(n_dot_v: f32, roughness: f32) -> f32 {
    let r2 = roughness * roughness;
    let r_inv = 1.0 / (roughness + 0.1);
    let a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * r_inv;
    let b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * r_inv;
    return saturate(exp(a * n_dot_v + b));
}

/// Sets the layers of the pixel's surface, and starts their light at nothing.
fn begin_layers(given: Layers) {
    surface_layers = given;
    coat_direct = vec3f(0.0);
    coat_indirect = vec3f(0.0);
    sheen_light = vec3f(0.0);
}

/// Gathers the layers' light from one direct light, whose color `light` includes its attenuation
/// and shadows, and returns the factor of that light which reaches the base under the sheen, as
/// three.js's `RE_Direct_Physical`. `normal` is the base's unit normal.
fn layered_light(normal: vec3f, to_view: vec3f, to_light: vec3f, light: vec3f) -> f32 {
    let current = surface_layers;
    if current.coat > 0.0 {
        let coat_normal = current.coat_normal;
        let n_dot_l = saturate(dot(coat_normal, to_light));
        let brdf = brdf_ggx(to_light, to_view, coat_normal, vec3f(0.04), 1.0, current.coat_roughness);
        coat_direct += n_dot_l * light * brdf;
    }
    let sheen = max_component(current.sheen_color);
    if sheen <= 0.0 {
        return 1.0;
    }
    let roughness = current.sheen_roughness;
    let n_dot_l = saturate(dot(normal, to_light));
    let n_dot_v = saturate(dot(normal, to_view));
    let half_dir = half_vector(to_light, to_view);
    let n_dot_h = saturate(dot(normal, half_dir));
    let brdf = current.sheen_color * (d_charlie(roughness, n_dot_h) * v_neubelt(n_dot_v, n_dot_l));
    sheen_light += n_dot_l * light * brdf;
    let albedo = max(sheen_albedo(n_dot_v, roughness), sheen_albedo(n_dot_l, roughness));
    return 1.0 - sheen * albedo;
}

/// Gathers the sheen's light from `irradiance` from all directions, such as the ambient light's
/// or the environment's, darkened by `occlusion`, and returns the factor of the base's light from
/// it, as three.js's `RE_IndirectDiffuse_Physical` and `RE_IndirectSpecular_Physical`. `n_dot_v`
/// is the cosine of the view angle at the base's normal.
fn layered_ambient(irradiance: vec3f, n_dot_v: f32, occlusion: f32) -> f32 {
    let current = surface_layers;
    let sheen = max_component(current.sheen_color);
    if sheen <= 0.0 {
        return 1.0;
    }
    let albedo = sheen_albedo(n_dot_v, current.sheen_roughness);
    sheen_light += irradiance * current.sheen_color * (albedo * INV_PI * occlusion);
    return 1.0 - sheen * albedo;
}

/// The environment's light that the coat reflects toward the camera, before its split-sum
/// terms: the prefiltered light at the coat's normal and roughness, times `strength`. It is black
/// for a surface without a coat, which reads nothing.
fn coat_environment(env: EnvironmentLight, to_view: vec3f, strength: f32) -> vec3f {
    let current = surface_layers;
    if current.coat <= 0.0 {
        return vec3f(0.0);
    }
    return environment_radiance(env, to_view, current.coat_normal, current.coat_roughness) * strength;
}

/// Gathers the coat's light from the environment's prefiltered `radiance` at the coat's normal,
/// darkened by `occlusion`, through the split-sum table at the coat's view angle and roughness, as
/// three.js's `EnvironmentBRDF` gives it.
fn layered_environment(radiance: vec3f, to_view: vec3f, occlusion: f32) {
    let current = surface_layers;
    if current.coat <= 0.0 {
        return;
    }
    let n_dot_v = saturate(dot(current.coat_normal, to_view));
    let dfg = dfg_lut(n_dot_v, current.coat_roughness);
    coat_indirect += radiance * environment_brdf(vec3f(0.04), 1.0, dfg) * occlusion;
}

/// The share of the light below the coat that passes through it: 1 less the coat times its
/// Fresnel term at the view angle, as three.js's physical material dims its outgoing light.
fn coat_transmittance(to_view: vec3f) -> f32 {
    let current = surface_layers;
    let n_dot_v = saturate(dot(current.coat_normal, to_view));
    return 1.0 - current.coat * f_schlick(vec3f(0.04), 1.0, n_dot_v).x;
}

/// The light that leaves the surface: `outgoing`, the base's light and its own light, with the
/// sheen's light added and the whole under the coat, plus the coat's own light.
fn finish_layers(outgoing: vec3f, to_view: vec3f) -> vec3f {
    let current = surface_layers;
    let below = outgoing + sheen_light;
    return below * coat_transmittance(to_view) + (coat_direct + coat_indirect) * current.coat;
}

/// The cosine between the coat's normal and `to_light`, or -1 for a surface without a coat.
fn coat_facing(to_light: vec3f) -> f32 {
    let current = surface_layers;
    return select(-1.0, dot(current.coat_normal, to_light), current.coat > 0.0);
}
