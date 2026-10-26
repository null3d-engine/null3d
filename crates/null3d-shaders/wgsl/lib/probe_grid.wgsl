#define_import_path null3d::probe_grid
#import null3d::globals::{ProbeGrid}
#import null3d::tables::{environment_sampler}

// The scene's light probe grid (D-146): a grid of irradiance probes, each holding L1 spherical
// harmonics of the light that surfaces send back. The probes sit in one RGBA16F 3D texture at
// binding 10 of the frame's group: four sub-volumes along z, each with one padding slice at either
// end, so a filtered read never blends across sub-volumes. The first three hold a probe's four RGB
// coefficients; the fourth holds how much sky it sees in red and its weight in the filter in alpha.
// A surface reads four texels, one per sub-volume, and hardware trilinear filtering blends the
// eight probes around it. The sample point moves half a probe spacing along the surface's normal,
// which keeps a probe's light from crossing a wall at once (D-146).
//
// A probe carries no weight where the bake found it inside geometry or in a gap narrower than the
// grid's spacing, so its light cannot leak into the space around it. The coefficients travel
// premultiplied by that weight, and the sampling divides by the filtered weight, which gives the
// valid probes around the surface their share again (D-179 ruling 12, Unity 6's adaptive probe
// volumes do the same).
//
// The probes hold no sky light. The share of the sky that reaches each probe multiplies the live
// environment's light instead, so a sky that changes with the time of day needs no new bake.

@group(0) @binding(10) var probe_grid_map: texture_3d<f32>;

/// True while the scene sets a light probe grid. An intensity of 0 keeps the grid in place, so the
/// grid's light fades to nothing instead of the environment returning.
fn has_probe_grid(grid: ProbeGrid) -> bool {
    return grid.origin.w > 0.5;
}

/// The irradiance that the scene's probe grid gives a surface at world position `world`, whose
/// unit normal is `normal`, times the grid's intensity. `environment` is the environment's own
/// irradiance at that normal, which the grid takes the place of: the sky term is that light times
/// the share of the sky that reaches the probes near the surface. Zero where the scene sets no
/// grid, and `environment` itself where no valid probe surrounds the surface.
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
    // L1y and L1z, stage 2 the rest of L1z and L1x, and stage 3 the mask and the sky's share.
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
    // Every probe around the surface carries no weight: nothing was baked for its space, so the
    // environment's own light takes the grid's place rather than no light at all.
    if (mask.a < 0.001) {
        return environment;
    }
    let share = 1.0 / mask.a;
    let c0 = stage0.xyz;
    let c1 = vec3f(stage0.w, stage1.x, stage1.y);
    let c2 = vec3f(stage1.z, stage1.w, stage2.x);
    let c3 = vec3f(stage2.y, stage2.z, stage2.w);
    var bounce = c0 * 0.886227;
    bounce += c1 * (2.0 * 0.511664 * normal.y);
    bounce += c2 * (2.0 * 0.511664 * normal.z);
    bounce += c3 * (2.0 * 0.511664 * normal.x);
    // The bounce was baked with the sky of its time, so it takes the sky's brightness now against
    // that one, and a day cycle dims it with the sky.
    let sky = mask.r * share;
    return (bounce * (share * grid.params.z) + sky * environment) * grid.params.x;
}
