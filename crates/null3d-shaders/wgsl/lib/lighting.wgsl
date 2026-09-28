#define_import_path null3d::lighting

// Lighting models, in linear color.

const PI: f32 = 3.141592653589793;

/// The light a Lambert surface reflects under one directional light and ambient light: the albedo
/// over pi times the irradiance, as three.js's MeshLambertMaterial computes it. `to_light` points
/// from the surface toward the light; `light` and `ambient` are colors times intensities.
fn lambert(albedo: vec3f, normal: vec3f, to_light: vec3f, light: vec3f, ambient: vec3f) -> vec3f {
    let n_dot_l = max(dot(normal, to_light), 0.0);
    return albedo / PI * (n_dot_l * light + ambient);
}
