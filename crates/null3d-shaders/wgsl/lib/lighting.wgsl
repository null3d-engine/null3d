#define_import_path null3d::lighting
#import null3d::math

// Lighting in linear color: the Lambert model, and the physically based model of glTF's
// metallic-roughness materials with the formulas of three.js's MeshStandardMaterial. Directions
// are unit vectors that point away from the surface: `to_light` toward the light and `to_view`
// toward the camera. Light colors include the intensity.

/// The light a Lambert surface reflects under one directional light and ambient light, as
/// three.js's MeshLambertMaterial computes it. It is the albedo over pi times the irradiance. The
/// direction `to_light` points from the surface toward the light. The colors `light` and `ambient`
/// include their intensities.
fn lambert(albedo: vec3f, normal: vec3f, to_light: vec3f, light: vec3f, ambient: vec3f) -> vec3f {
    let n_dot_l = max(dot(normal, to_light), 0.0);
    return albedo / null3d::math::PI * (n_dot_l * light + ambient);
}

/// The Lambert diffuse reflectance: the diffuse color over pi, as three.js's `BRDF_Lambert`.
fn brdf_lambert(diffuse: vec3f) -> vec3f {
    return null3d::math::INV_PI * diffuse;
}

/// Schlick's Fresnel term, in the form with `exp2` that Epic gave and three.js's `F_Schlick` uses.
/// It is the reflectance at a half vector whose cosine with the view is `v_dot_h`. It runs from
/// `f0` at normal incidence to `f90` at grazing angles.
fn f_schlick(f0: vec3f, f90: f32, v_dot_h: f32) -> vec3f {
    let fresnel = exp2((-5.55473 * v_dot_h - 6.98316) * v_dot_h);
    return f0 * (1.0 - fresnel) + f90 * fresnel;
}

/// The GGX normal distribution, as three.js's `D_GGX`. `alpha` is the square of the perceptual
/// roughness.
fn d_ggx(alpha: f32, n_dot_h: f32) -> f32 {
    let a2 = alpha * alpha;
    let denom = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
    return null3d::math::INV_PI * a2 / (denom * denom);
}

/// The height-correlated Smith visibility term of GGX, as three.js's `V_GGX_SmithCorrelated`. It
/// includes the 1 / (4 n.l n.v) of the microfacet model.
fn v_ggx_smith_correlated(alpha: f32, n_dot_l: f32, n_dot_v: f32) -> f32 {
    let a2 = alpha * alpha;
    let gv = n_dot_l * sqrt(a2 + (1.0 - a2) * n_dot_v * n_dot_v);
    let gl = n_dot_v * sqrt(a2 + (1.0 - a2) * n_dot_l * n_dot_l);
    return 0.5 / max(gv + gl, null3d::math::EPSILON);
}

/// The GGX specular reflectance for one light, as three.js's `BRDF_GGX`: the GGX distribution,
/// Schlick's Fresnel term and the correlated Smith visibility term. `roughness` is perceptual.
fn brdf_ggx(
    to_light: vec3f,
    to_view: vec3f,
    normal: vec3f,
    f0: vec3f,
    f90: f32,
    roughness: f32,
) -> vec3f {
    let alpha = roughness * roughness;
    let half_dir = normalize(to_light + to_view);
    let n_dot_l = saturate(dot(normal, to_light));
    let n_dot_v = saturate(dot(normal, to_view));
    let n_dot_h = saturate(dot(normal, half_dir));
    let v_dot_h = saturate(dot(to_view, half_dir));
    let fresnel = f_schlick(f0, f90, v_dot_h);
    return fresnel * (v_ggx_smith_correlated(alpha, n_dot_l, n_dot_v) * d_ggx(alpha, n_dot_h));
}

/// The scale and bias of the split-sum approximation of specular light from all directions, for a
/// view at `n_dot_v` and a perceptual `roughness`. This is Karis's analytic fit from "Physically
/// Based Shading on Mobile". three.js reads the same two terms from a lookup texture instead.
fn dfg_approx(n_dot_v: f32, roughness: f32) -> vec2f {
    let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
    let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
    let r = roughness * c0 + c1;
    let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
    return vec2f(-1.04, 1.04) * a004 + r.zw;
}

/// The specular reflectance of light from the environment, from the split-sum terms `dfg`, as
/// three.js's `EnvironmentBRDF`.
fn environment_brdf(f0: vec3f, f90: f32, dfg: vec2f) -> vec3f {
    return f0 * dfg.x + f90 * dfg.y;
}

/// Light that a surface's microfacets reflect once, and light that they reflect more than once.
struct Scattering {
    /// The share of the light that leaves after one bounce.
    single: vec3f,
    /// The share of the light that leaves after more than one bounce.
    multi: vec3f,
}

/// The single and multiple scattering of light from all directions, after Fdez-Agüera's
/// "Multiple-Scattering Microfacet Model for Real-Time Image Based Lighting". It follows three.js's
/// `computeMultiscattering`. `dfg` holds the split-sum terms.
fn multiscattering(f0: vec3f, f90: f32, dfg: vec2f) -> Scattering {
    let single = f0 * dfg.x + f90 * dfg.y;
    let ess = dfg.x + dfg.y;
    let ems = 1.0 - ess;
    let average = f0 + (1.0 - f0) * 0.047619;
    let multi = single * average / (1.0 - ems * average);
    return Scattering(single, multi * ems);
}

/// The factor that gives direct specular light back the energy that single scattering loses on
/// rough surfaces, after Turquin. It follows three.js's `multiScatteringCompensation`. `f0` is the
/// reflectance at normal incidence, blended toward the base color by metalness.
fn multiscatter_compensation(f0: vec3f, dfg: vec2f) -> vec3f {
    return 1.0 + f0 * (1.0 / (dfg.x + dfg.y) - 1.0);
}

/// How much of the environment's specular light ambient occlusion lets through, after Lagarde and
/// de Rousiers. It follows three.js's `computeSpecularOcclusion`.
fn specular_occlusion(n_dot_v: f32, occlusion: f32, roughness: f32) -> f32 {
    return saturate(pow(n_dot_v + occlusion, exp2(-16.0 * roughness - 1.0)) - 1.0 + occlusion);
}

/// How a point or spot light fades with `distance`, as three.js's `getDistanceAttenuation`: one
/// over the distance to the power `decay`. When `cutoff` is more than 0, the light also fades
/// smoothly to nothing at that distance.
fn distance_attenuation(distance: f32, cutoff: f32, decay: f32) -> f32 {
    var falloff = 1.0 / max(pow(distance, decay), 0.01);
    if cutoff > 0.0 {
        let ratio2 = null3d::math::square(distance / cutoff);
        falloff *= null3d::math::square(saturate(1.0 - ratio2 * ratio2));
    }
    return falloff;
}

/// How a spot light fades toward the edge of its cone, as three.js's `getSpotAttenuation`. The
/// arguments are cosines: of the cone's half angle, of the angle where the penumbra starts, and of
/// the angle to the point.
fn spot_attenuation(cone_cos: f32, penumbra_cos: f32, angle_cos: f32) -> f32 {
    return smoothstep(cone_cos, penumbra_cos, angle_cos);
}

/// The irradiance of a hemisphere light, as three.js's `getHemisphereLightIrradiance`. It blends
/// from the ground color to the sky color as the normal turns toward `up`.
fn hemisphere_irradiance(normal: vec3f, up: vec3f, sky: vec3f, ground: vec3f) -> vec3f {
    let weight = 0.5 * dot(normal, up) + 0.5;
    return mix(ground, sky, weight);
}

/// The irradiance at a unit `normal` from nine spherical harmonics coefficients in three.js's
/// order, as three.js's `shGetIrradianceAt` computes it for light probes.
fn sh_irradiance(normal: vec3f, sh: array<vec3f, 9>) -> vec3f {
    let x = normal.x;
    let y = normal.y;
    let z = normal.z;
    var result = sh[0] * 0.886227;
    result += sh[1] * (2.0 * 0.511664 * y);
    result += sh[2] * (2.0 * 0.511664 * z);
    result += sh[3] * (2.0 * 0.511664 * x);
    result += sh[4] * (2.0 * 0.429043 * x * y);
    result += sh[5] * (2.0 * 0.429043 * y * z);
    result += sh[6] * (0.743125 * z * z - 0.247708);
    result += sh[7] * (2.0 * 0.429043 * x * z);
    result += sh[8] * (0.429043 * (x * x - y * y));
    return result;
}

/// A surface of glTF's metallic-roughness model at one point, set up for lighting as three.js
/// sets up MeshStandardMaterial.
struct PbrMaterial {
    /// The base color, which metals reflect.
    base_color: vec3f,
    /// The color of diffuse light: the base color without its metallic part.
    diffuse: vec3f,
    /// The dielectric reflectance at normal incidence, 0.04.
    specular: vec3f,
    /// The reflectance at normal incidence, blended from `specular` toward the base color by
    /// metalness.
    specular_blended: vec3f,
    /// The reflectance at grazing angles.
    specular_grazing: f32,
    /// The perceptual roughness, from 0.0525 to 1.
    roughness: f32,
    /// The metalness, from 0 to 1.
    metalness: f32,
}

/// Sets up a PbrMaterial as three.js does. It raises `roughness` to at least 0.0525, adds
/// `geometry_roughness`, and keeps the sum at 1 or less. `geometry_roughness` softens highlights
/// where the normal changes fast between pixels. Pass 0 to leave it out.
fn pbr_material(
    base_color: vec3f,
    metalness: f32,
    roughness: f32,
    geometry_roughness: f32,
) -> PbrMaterial {
    var m: PbrMaterial;
    m.base_color = base_color;
    m.diffuse = base_color * (1.0 - metalness);
    m.specular = vec3f(0.04);
    m.specular_blended = mix(m.specular, base_color, metalness);
    m.specular_grazing = 1.0;
    m.roughness = min(max(roughness, 0.0525) + geometry_roughness, 1.0);
    m.metalness = metalness;
    return m;
}

/// Light that a surface reflects toward the camera, in its diffuse and specular parts.
struct Reflected {
    /// The diffuse part.
    diffuse: vec3f,
    /// The specular part.
    specular: vec3f,
}

/// The light that a PBR surface reflects from one direct light, as three.js's
/// `RE_Direct_Physical`. `light` is the light's color after attenuation and shadows.
/// `compensation` comes from `multiscatter_compensation`. The diffuse part leaves out the light
/// that the specular layer reflects.
fn direct_light(
    m: PbrMaterial,
    normal: vec3f,
    to_view: vec3f,
    to_light: vec3f,
    light: vec3f,
    compensation: vec3f,
) -> Reflected {
    let irradiance = saturate(dot(normal, to_light)) * light;
    let brdf = brdf_ggx(to_light, to_view, normal, m.specular_blended, m.specular_grazing, m.roughness);
    let v_dot_h = saturate(dot(to_view, normalize(to_light + to_view)));
    let fresnel = f_schlick(m.specular, m.specular_grazing, v_dot_h);
    return Reflected(
        irradiance * brdf_lambert(m.diffuse) * (1.0 - fresnel),
        irradiance * brdf * compensation,
    );
}

/// The diffuse light that a PBR surface reflects from ambient, hemisphere and probe light, as
/// three.js's `RE_IndirectDiffuse_Physical`. It leaves out the light that the specular layer
/// reflects. `dfg` holds the split-sum terms.
fn indirect_diffuse(m: PbrMaterial, irradiance: vec3f, dfg: vec2f) -> vec3f {
    let s = multiscattering(m.specular, m.specular_grazing, dfg);
    return irradiance * brdf_lambert(m.diffuse) * (1.0 - s.single - s.multi);
}

/// The light that a PBR surface reflects from an environment map, as three.js's
/// `RE_IndirectSpecular_Physical`. The prefiltered reflection is `radiance`, and the environment's
/// diffuse light is `irradiance`. The split-sum terms are in `dfg`.
fn indirect_specular(m: PbrMaterial, radiance: vec3f, irradiance: vec3f, dfg: vec2f) -> Reflected {
    let dielectric = multiscattering(m.specular, m.specular_grazing, dfg);
    let metallic = multiscattering(m.base_color, m.specular_grazing, dfg);
    let single = mix(dielectric.single, metallic.single, m.metalness);
    let multi = mix(dielectric.multi, metallic.multi, m.metalness);
    let cosine_weighted = irradiance * null3d::math::INV_PI;
    let diffuse = m.diffuse * (1.0 - (dielectric.single + dielectric.multi));
    return Reflected(diffuse * cosine_weighted, radiance * single + multi * cosine_weighted);
}
