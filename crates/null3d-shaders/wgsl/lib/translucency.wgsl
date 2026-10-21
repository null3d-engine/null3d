#define_import_path null3d::translucency
#import null3d::math::{INV_PI}
#import null3d::refraction::{volume_attenuation}

// Light through a thin surface, as glTF's KHR_materials_diffuse_transmission describes it and the
// Khronos sample renderer draws it: a leaf, a petal or an ear lets part of the light that reaches
// its back through to its front. Of the surface's diffuse light, the diffuse transmission's share
// passes through, and the front keeps the rest. The light from behind spreads as a Lambert surface
// spreads it, through the material's transmission color, and the base color does not tint it.
//
// The scene's lights gather the light that reaches the back while they light the front: each
// direct light adds its color times the cosine of its angle with the back's normal, after its
// shadows, which the lookup finds from the side that the light falls on. The ambient, hemisphere
// and environment light from behind come from the irradiance at the reversed normal. With glTF's
// KHR_materials_volume, the light from behind takes the volume's color by Beer's law over the
// surface's thickness.

/// The light from the scene's direct lights that reaches the surface's back, which
/// `gather_back_light` sums while the lights light its front.
var<private> back_irradiance: vec3f;

/// The normal that a shadow lookup takes for a light in the direction `to_light`: the surface's
/// unit `normal` where the light falls on its front, and the reverse where it falls on its back, so
/// the lookup moves the point toward the light either way.
fn lit_side(normal: vec3f, to_light: vec3f) -> vec3f {
    return select(normal, -normal, dot(normal, to_light) < 0.0);
}

/// Adds one direct light's share of the light that reaches the back of a surface with unit
/// `normal`. `to_light` points toward the light, and `incoming` is its color after its fall-off
/// and its shadows.
fn gather_back_light(normal: vec3f, to_light: vec3f, incoming: vec3f) {
    back_irradiance += saturate(-dot(normal, to_light)) * incoming;
}

/// The light that a thin surface lets through to its front. `indirect` is the ambient,
/// hemisphere and environment irradiance at the reversed normal, after occlusion. `color` is the
/// transmission color, `share` the diffuse transmission, and `energy` the share of each primary
/// that the specular layer leaves to the diffuse light. `distance` is the volume's thickness in
/// world units, and `attenuation` the volume's color and its attenuation distance, 0 for a volume
/// that absorbs nothing.
fn transmitted_diffuse(
    indirect: vec3f,
    color: vec3f,
    share: f32,
    energy: vec3f,
    distance: f32,
    attenuation: vec4f,
) -> vec3f {
    let through = color * volume_attenuation(distance, attenuation.rgb, attenuation.w);
    return (back_irradiance + indirect) * through * energy * (share * INV_PI);
}
