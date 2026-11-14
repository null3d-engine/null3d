#define_import_path null3d::probe_grid
#import null3d::globals::{ProbeGrid}
#import null3d::tables::{environment_sampler}

// The scene's light probe grid (D-146): a grid of irradiance probes, each holding L1 spherical
// harmonics of the light that its surroundings bounce back. The probes' four RGB coefficients and
// two masks sit in one RGBA16F 3D texture at binding 10 of the frame's group: four sub-volumes
// along z, one per `vec4f` of a probe, each with one padding slice at either end, so a filtered
// read never blends across sub-volumes. A surface reads four texels, one per sub-volume, and
// hardware trilinear filtering blends the eight probes around it. The sample point moves half a
// probe spacing along the surface's normal, which stops the leaks of a flat wall; the fourth
// sub-volume stops the rest, because a probe that geometry encloses holds no validity.
//
// The coefficients leave the sky out. The fourth sub-volume's second number holds the share of the
// sky that each probe sees, which the live environment's light multiplies here, so an hour that
// moves the sky needs no new bake.

@group(0) @binding(10) var probe_grid_map: texture_3d<f32>;

/// True while the scene sets a light probe grid. An intensity of 0 keeps the grid in place, so the
/// grid's light fades to nothing instead of the environment returning.
fn has_probe_grid(grid: ProbeGrid) -> bool {
    return grid.origin.w > 0.5;
}

/// The irradiance that the scene's probe grid gives a surface at world position `world`, whose
/// unit normal is `normal`, times the grid's intensity: the light that the probes baked from their
/// surroundings, and the live environment's light `environment` times the sky each probe sees.
/// Zero where the scene sets no grid.
fn probe_grid_irradiance(
    grid: ProbeGrid,
    world: vec3f,
    normal: vec3f,
    environment: vec3f,
) -> vec3f {
    if (!has_probe_grid(grid)) {
        return vec3f(0.0);
    }
    let counts = grid.counts.xyz;
    // An axis one probe deep has an inverse spacing of 0, and its probe alone is what the clamp
    // keeps. Dividing by that 0 gives an infinity, which a normal component of 0 turns into NaN, so
    // the divisor holds 1 there. Every other axis divides by its own inverse spacing exactly.
    let inverse = grid.inverse_spacing.xyz;
    let divisor = select(vec3f(1.0), inverse, inverse > vec3f(0.0));
    let spacing = 1.0 / divisor;
    // The sample point moves half a spacing along the normal, then clamps into the grid.
    let at = clamp(
        (world + normal * (spacing * 0.5) - grid.origin.xyz) * grid.inverse_spacing.xyz,
        vec3f(0.0),
        counts - 1.0,
    );
    // Each sub-volume holds the grid's z plus one padding slice at either end.
    let stride = grid.counts.w;
    let depth = 4.0 * stride;
    let u = (at.x + 0.5) / counts.x;
    let v = (at.y + 0.5) / counts.y;
    let w = (at.z + 1.5) / depth;
    let step = vec3f(0.0, 0.0, stride / depth);
    // One filtered read per sub-volume: stage 0 holds L0's rgb and L1y's r, stage 1 the rest of
    // L1y and L1z, stage 2 the rest of L1z and L1x, and stage 3 the probe's validity and sky
    // visibility.
    let stage0 = textureSampleLevel(probe_grid_map, environment_sampler, vec3f(u, v, w), 0.0);
    let stage1 = textureSampleLevel(probe_grid_map, environment_sampler, vec3f(u, v, w) + step, 0.0);
    let stage2 = textureSampleLevel(
        probe_grid_map,
        environment_sampler,
        vec3f(u, v, w) + step * 2.0,
        0.0,
    );
    let mask = textureSampleLevel(
        probe_grid_map,
        environment_sampler,
        vec3f(u, v, w) + step * 3.0,
        0.0,
    );
    let c0 = stage0.xyz;
    let c1 = vec3f(stage0.w, stage1.x, stage1.y);
    let c2 = vec3f(stage1.z, stage1.w, stage2.x);
    let c3 = vec3f(stage2.y, stage2.z, stage2.w);
    var bounce = c0 * 0.886227;
    bounce += c1 * (2.0 * 0.511664 * normal.y);
    bounce += c2 * (2.0 * 0.511664 * normal.z);
    bounce += c3 * (2.0 * 0.511664 * normal.x);
    // The live environment's light, times the sky that the probes see. The environment already
    // carries the frame's exposure, so the sky takes the grid's intensity alone, where the baked
    // bounce takes the intensity times the exposure. The visibility counts the share of the whole
    // sphere that reaches the sky, and the environment's irradiance covers the hemisphere around
    // the surface; a sky above the horizon fills half the sphere, so the share is weighted by the
    // surface's own tilt toward it. The weight fades as the sky wraps around the probe, where
    // every normal takes the environment's own light.
    let tilt = min(1.0, 2.0 * (1.0 - mask.y));
    let sky = environment * saturate(mask.y * (1.0 + normal.y * tilt));
    let light = bounce * grid.params.x + sky * grid.params.z;
    // A probe that geometry encloses lends no light, so the walls around it do not leak.
    return light * saturate(mask.x);
}
