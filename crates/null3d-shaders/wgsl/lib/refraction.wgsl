#define_import_path null3d::refraction
#import null3d::mesh::{frame}

// The path that light takes through a volume, as three.js's MeshPhysicalMaterial describes it
// (transmission_pars_fragment, after the glTF Sample Viewer): the direction and length of the ray
// through a slab of a material's thickness, after it enters toward the camera, and the light that
// the volume absorbs over it, by Beer's law. null3d::transmission follows that ray to the copy of
// the opaque color that the view keeps, and null3d::translucency lights a thin surface with it.
//
// A build pays a binding for each global that it declares, whether it reads the global or not, and
// WebGPU counts those against its sampled textures per stage. So the copy that these functions
// serve is declared in null3d::transmission, which only builds that read it import.

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
