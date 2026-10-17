#define_import_path null3d::probe_grid
#import null3d::globals::{ProbeGrid}
#import null3d::tables::{environment_sampler}

// The scene's light probe grid (D-146): a grid of irradiance probes, each holding L1 spherical
// harmonics of the light that reaches its point. The probes' four RGB coefficients sit in one
// RGBA16F 3D texture at binding 10 of the frame's group: three sub-volumes along z, one per
// `vec4f` of a probe, each with one padding slice at either end, so a filtered read never blends
// across sub-volumes. A surface reads three texels, one per sub-volume, and hardware trilinear
// filtering blends the eight probes around it. The sample point moves half a probe spacing along
// the surface's normal, which is the whole of the leak control: a probe inside a wall cannot bleed
// its light onto the far side (D-146, three.js's own rule).

@group(0) @binding(10) var probe_grid_map: texture_3d<f32>;

/// True while the scene sets a light probe grid. An intensity of 0 keeps the grid in place, so the
/// grid's light fades to nothing instead of the environment returning.
fn has_probe_grid(grid: ProbeGrid) -> bool {
    return grid.origin.w > 0.5;
}

/// The irradiance that the scene's probe grid gives a surface at world position `world`, whose
/// unit normal is `normal`, times the grid's intensity. Zero where the scene sets no grid.
fn probe_grid_irradiance(grid: ProbeGrid, world: vec3f, normal: vec3f) -> vec3f {
    if (!has_probe_grid(grid)) {
        return vec3f(0.0);
    }
    let counts = grid.counts.xyz;
    let spacing = 1.0 / grid.inverse_spacing.xyz;
    // The sample point moves half a spacing along the normal, then clamps into the grid.
    let at = clamp(
        (world + normal * (spacing * 0.5) - grid.origin.xyz) * grid.inverse_spacing.xyz,
        vec3f(0.0),
        counts - 1.0,
    );
    // Each sub-volume holds the grid's z plus one padding slice at either end.
    let stride = grid.counts.w;
    let depth = 3.0 * stride;
    let u = (at.x + 0.5) / counts.x;
    let v = (at.y + 0.5) / counts.y;
    let w = (at.z + 1.5) / depth;
    let step = vec3f(0.0, 0.0, stride / depth);
    // One filtered read per sub-volume: stage 0 holds L0's rgb and L1y's r, stage 1 the rest of
    // L1y and L1z, and stage 2 the rest of L1z and L1x.
    let stage0 = textureSampleLevel(probe_grid_map, environment_sampler, vec3f(u, v, w), 0.0);
    let stage1 = textureSampleLevel(probe_grid_map, environment_sampler, vec3f(u, v, w) + step, 0.0);
    let stage2 = textureSampleLevel(
        probe_grid_map,
        environment_sampler,
        vec3f(u, v, w) + step * 2.0,
        0.0,
    );
    let c0 = stage0.xyz;
    let c1 = vec3f(stage0.w, stage1.x, stage1.y);
    let c2 = vec3f(stage1.z, stage1.w, stage2.x);
    let c3 = vec3f(stage2.y, stage2.z, stage2.w);
    var result = c0 * 0.886227;
    result += c1 * (2.0 * 0.511664 * normal.y);
    result += c2 * (2.0 * 0.511664 * normal.z);
    result += c3 * (2.0 * 0.511664 * normal.x);
    return result * grid.params.x;
}
