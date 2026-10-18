#define_import_path null3d::probes
#import null3d::cubemap::{octahedral_point, octahedral_uv}
#import null3d::ibl::roughness_level
#import null3d::tables::{environment_sampler, light_tables}

// Reflection probes (decision record D-149): the light around a point of the scene, which the
// engine captures in the browser, filtered for each roughness as the environment's map is. Each
// probe holds an octahedral map in a layer of one texture array, at binding 3 of the frame's
// group, and lights the surfaces inside its box in place of the environment.
//
// A probe's box projects its reflections: a reflection ray from a surface meets the box's far
// side, and the probe reads its map in the direction from its capture point to that place. So a
// room's walls reflect where they stand, not as if they lay infinitely far away. A probe lights
// the whole of its box, a floor on the box's bottom included, and fades out over its blend
// distance beyond the box's sides, where the next probe, or the environment, takes the rest. The engine lists each view's probes in the frame's group, inner probes first: a
// surface takes light from at most two of them.

/// One probe, as the engine lists it for a view. Positions are relative to the view's camera.
struct ReflectionProbe {
    /// The box's corner of least x, y and z in `xyz`, and the blend distance in `w`.
    low: vec4f,
    /// The box's opposite corner in `xyz`, and the probe's intensity in `w`.
    high: vec4f,
    /// The capture point in `xyz`, and the probe's layer of the texture array in `w`.
    center: vec4f,
    /// 1 in `x` when the probe projects its reflections onto its box, and 0 when it reads them as
    /// light from infinitely far away. Its other values are spare.
    flags: vec4f,
}

/// The probes that a view lists.
struct ReflectionProbes {
    /// How many probes the view lists in `x`, the maps' last mip level in `y`, and the texels
    /// across a side of their largest level in `z`. `w` is spare.
    head: vec4f,
    probes: array<ReflectionProbe, 8>,
}

// The probes' maps are layers of the frame's shared array at binding 3 (null3d::tables,
// `light_tables`), read with the environment's sampler.
#ifdef WEBGL2
@group(0) @binding(14) var<uniform> reflection_probes: ReflectionProbes;
#else
@group(0) @binding(18) var<uniform> reflection_probes: ReflectionProbes;
#endif

const PI: f32 = 3.14159265358979;

/// The light that a view's probes give a surface: the reflected light and the irradiance, each
/// already weighed, and the share of the environment's light that they take, from 0 to 1.
struct ProbeLight {
    radiance: vec3f,
    irradiance: vec3f,
    weight: f32,
}

/// True while the view lists a probe.
fn has_probes() -> bool {
    return reflection_probes.head.x > 0.5;
}

/// The light of layer `layer` in direction `d`, at mip level `level`. Each level's edge texels
/// lie on the map's folds, so each level has its own texture coordinates, and the two nearest
/// levels mix by hand.
fn probe_texel(layer: i32, d: vec3f, level: f32) -> vec3f {
    let e = octahedral_point(d);
    let size = reflection_probes.head.z;
    let low = floor(level);
    let high = min(low + 1.0, reflection_probes.head.y);
    let at_low = octahedral_uv(e, size / exp2(low));
    let at_high = octahedral_uv(e, size / exp2(high));
    let a = textureSampleLevel(light_tables, environment_sampler, at_low, layer, low).rgb;
    let b = textureSampleLevel(light_tables, environment_sampler, at_high, layer, high).rgb;
    return mix(a, b, level - low);
}

/// The light from the view's probes at position `relative`, relative to the camera, for a surface
/// of unit normal `normal` and perceptual `roughness` that reflects along the unit direction
/// `reflected`. Inner probes come first, and each takes its weight of what the probes before it
/// left, so nested probes blend at their edges. The diffuse light reads each map's roughest level
/// along the normal, as three.js reads an environment map's.
fn probe_light(relative: vec3f, reflected: vec3f, normal: vec3f, roughness: f32) -> ProbeLight {
    var out = ProbeLight(vec3f(0.0), vec3f(0.0), 0.0);
    let count = u32(reflection_probes.head.x);
    let last = reflection_probes.head.y;
    let level = roughness_level(roughness, last);
    // A ray that runs along an axis meets that axis's sides at infinity.
    let ray = select(reflected, vec3f(1e-5), abs(reflected) < vec3f(1e-5));
    var taken = 0u;
    for (var i = 0u; i < count; i++) {
        let probe = reflection_probes.probes[i];
        let inside = min(relative - probe.low.xyz, probe.high.xyz - relative);
        // A surface on the box's side, such as a floor on its bottom, lies inside within a
        // centimeter of rounding.
        let edge = min(min(inside.x, inside.y), inside.z);
        let blend = probe.low.w;
        if edge < -max(blend, 0.01) {
            continue;
        }
        let fade = select(1.0, saturate(1.0 + edge / blend), blend > 0.0 && edge < 0.0);
        let weight = fade * fade * (3.0 - 2.0 * fade) * (1.0 - out.weight);
        var direction = reflected;
        if probe.flags.x > 0.5 {
            let far = select(probe.low.xyz, probe.high.xyz, ray > vec3f(0.0));
            let along = (far - relative) / ray;
            let t = max(min(min(along.x, along.y), along.z), 0.0);
            direction = relative + reflected * t - probe.center.xyz;
        }
        let layer = i32(probe.center.w);
        let share = weight * probe.high.w;
        out.radiance += probe_texel(layer, direction, level) * share;
        out.irradiance += probe_texel(layer, normal, last) * (PI * share);
        out.weight += weight;
        taken += 1u;
        if taken == 2u || out.weight > 0.999 {
            break;
        }
    }
    return out;
}
