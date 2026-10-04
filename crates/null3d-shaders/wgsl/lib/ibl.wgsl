#define_import_path null3d::ibl
#import null3d::globals::{EnvironmentLight}
#import null3d::lighting::{sh_irradiance}

// Image-based light: the light of the scene's environment, as three.js's MeshStandardMaterial
// takes it from `scene.environment` (envmap_physical_pars_fragment). The environment is a cube
// map that the asset tool prefilters, one roughness per mip level, and nine spherical harmonics
// coefficients of its diffuse light (D-19). The frame's group binds the map at bindings 11 and 12
// of the mesh pipelines: a blank cube while the scene has no environment, which the frame's
// values then say not to read.

@group(0) @binding(11) var environment_map: texture_cube<f32>;
@group(0) @binding(12) var environment_sampler: sampler;

/// True while the scene has an environment whose map is on the GPU.
fn has_environment(env: EnvironmentLight) -> bool {
    return env.params.z > 0.0;
}

/// A direction in the world, as the map holds it: turned back by the environment's rotation.
fn map_direction(env: EnvironmentLight, d: vec3f) -> vec3f {
    return vec3f(dot(env.rotation[0].xyz, d), dot(env.rotation[1].xyz, d), dot(env.rotation[2].xyz, d));
}

/// The irradiance from the environment at a surface whose unit normal is `normal`, from its nine
/// coefficients, times the environment's intensity.
fn environment_irradiance(env: EnvironmentLight, normal: vec3f) -> vec3f {
    let sh = array<vec3f, 9>(
        env.sh[0].xyz,
        env.sh[1].xyz,
        env.sh[2].xyz,
        env.sh[3].xyz,
        env.sh[4].xyz,
        env.sh[5].xyz,
        env.sh[6].xyz,
        env.sh[7].xyz,
        env.sh[8].xyz,
    );
    return sh_irradiance(map_direction(env, normal), sh) * env.params.y;
}

/// The roughness of the GGX filter whose light matches three.js's PMREM best, at each material
/// roughness from 0 to 1 in steps of 0.05 (D-19). three.js's PMREM blurs less than the GGX
/// distribution of its own materials, so a port keeps its look only through this table.
const THREE_ROUGHNESS = array<f32, 21>(
    0.0, 0.0, 0.07, 0.12, 0.19, 0.23, 0.255, 0.3, 0.345, 0.375, 0.41,
    0.45, 0.5, 0.54, 0.61, 0.695, 0.775, 0.825, 0.875, 0.93, 0.98,
);

/// The mip level that holds the light that three.js's standard material reflects at perceptual
/// `roughness`: the table's filter roughness g, between its steps. Level i of n + 1 holds filter
/// roughness 1 - sqrt(1 - i / n), so level g (2 - g) n holds g. More levels go to smooth surfaces,
/// whose reflections change fastest.
fn roughness_level(roughness: f32, last_level: f32) -> f32 {
    let at = saturate(roughness) * 20.0;
    let low = min(u32(at), 19u);
    var table = THREE_ROUGHNESS;
    let g = mix(table[low], table[low + 1u], at - f32(low));
    return last_level * g * (2.0 - g);
}

/// The light that a surface of perceptual `roughness` reflects toward the camera from the
/// environment, as three.js's `getIBLRadiance`: the reflection of the view about the unit
/// `normal`, bent toward the normal on rough surfaces, which keeps them from gathering light from
/// behind themselves, times the environment's intensity.
fn environment_radiance(
    env: EnvironmentLight,
    to_view: vec3f,
    normal: vec3f,
    roughness: f32,
) -> vec3f {
    let r2 = roughness * roughness;
    let reflected = normalize(mix(reflect(-to_view, normal), normal, r2 * r2));
    let level = roughness_level(roughness, env.params.x);
    let light = textureSampleLevel(
        environment_map,
        environment_sampler,
        map_direction(env, reflected),
        level,
    );
    return light.rgb * env.params.y;
}
