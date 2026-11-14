// The wet surface of the weather add-on. The block between its markers is the one that a scene's
// own material copies into its own WGSL, because the shader build resolves only the engine's
// library: a shader cannot import another shader. `wet.test.ts` compares every copy with this file
// and fails when a copy is edited alone. The wind add-on keeps its sampling block the same way.
//
// This file is also a complete material: a plain wet ground that `createWetGround` makes, so the
// shared block is compiled by the build and the add-on has a default surface to show.
//
// A reader that copies the block declares, outside the markers:
//
//   #import null3d::noise::{value2}
//   #import null3d::reflection::{reflection_uv}
//
//   var wetMirror: texture_2d<f32>;
//
//   struct Uniforms { ..., wet0: vec4f, wet1: vec4f, wet2: vec4f }
//
// and ends its surface function with
// `return wet_surface(s, input, depth, material.wet0, material.wet1, material.wet2);`.
// `createWetSurface` in index.ts gives the three vectors and the mirror texture: a planar
// reflection pass's texture, or a black stand-in where the scene takes its reflection from the
// screen.
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

var wetMirror: texture_2d<f32>;

struct Uniforms { wet0: vec4f, wet1: vec4f, wet2: vec4f }

// <wet-surface>
/// The water depth at a place from two octaves of value noise, for a scene with no puddle map. The
/// scale is the width of the largest puddles in meters, and the result runs from 0 for dry ground
/// to 1 for deep water.
fn wet_noise_depth(p: vec2f, scale: f32) -> f32 {
    let large = value2(p / max(scale, 1e-3));
    let small = value2(p / max(scale * 0.37, 1e-3) + 13.0);
    return large * 0.68 + small * 0.32;
}

/// Adds water to a surface. The state is the scene's surface, which this returns wetted; the depth
/// is the scene's own water depth, from a map or from wet_noise_depth, where 0 is dry ground. The
/// vectors carry the look:
/// wet0 = (puddle coverage, edge softness, ripple cell in meters, ripples a second),
/// wet1 = (darken, planar mirror share, wet roughness, ripple strength),
/// wet2 = (time, rain, grain scale, dry asphalt's share of the planar mirror).
/// The surface faces up, as a road or a floor does.
fn wet_surface(
    state: Surface,
    input: SurfaceInput,
    depth: f32,
    wet0: vec4f,
    wet1: vec4f,
    wet2: vec4f,
) -> Surface {
    var s = state;
    let p = input.worldPosition.xz;
    let rain = clamp(wet2.y, 0.0, 1.0);
    let edge = 1.0 - wet0.x;
    let water = smoothstep(edge, edge + max(wet0.y, 1e-4), depth) * rain;
    // The asphalt between the puddles keeps its grain, but rain has darkened and smoothed it, and
    // it shows a share of the planar mirror that its grain breaks into streaks.
    let road = (1.0 - water) * clamp(wet2.w, 0.0, 1.0) * rain;
    if (water <= 0.0 && road <= 0.0) {
        return s;
    }

    // Rain rings: one drop at a time in each cell, its place and its moment from the cell's hash.
    // The cell is wet0.z meters across, and its ring grows and fades over a second or so.
    let cell = floor(p / max(wet0.z, 1e-3));
    let jitter = (vec2f(value2(cell), value2(cell + 17.0)) - 0.5) * 0.35;
    let at = fract(p / max(wet0.z, 1e-3)) - 0.5 - jitter;
    let phase = fract(wet2.x * wet0.w + value2(cell + 3.0));
    let radius = phase * 0.42;
    let d = (length(at) - radius) / 0.07;
    let ring = exp(-d * d) * (1.0 - phase) * water;
    let tilt = normalize(at + vec2f(1e-4, 1e-4)) * ring * wet1.w;

    // The planar mirror, where the scene gave one. The branch is on a uniform, so the sample is
    // uniform; the texture coordinates are not, which textureSampleLevel allows.
    var mirrored = vec3f(0.0);
    if (wet1.y > 0.0) {
        // The asphalt's grain moves each pixel's sample across the mirror, so each reflected light
        // leaves a short broken streak on the wet road, while a puddle stays a clean mirror.
        let grain = vec2f(value2(p * wet2.z), value2(p * wet2.z + 29.0)) - 0.5;
        let smear = grain * vec2f(0.004, 0.3) * (1.0 - water);
        let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
        mirrored = textureSampleLevel(
            wetMirror,
            wetMirrorSampler,
            reflection_uv(clip, tilt * 0.08 + smear),
            0.0,
        ).rgb;
    }

    // Water darkens the surface and smooths it, and the rings bend its normal. Light from the
    // mirror direction takes the place of the environment's reflection where the water shows.
    s.baseColor = s.baseColor * mix(1.0, wet1.x, water);
    s.roughness = mix(s.roughness, wet1.z, water);
    s.normal = normalize(mix(s.normal, vec3f(tilt.x, 1.0, tilt.y), water));
    s.reflection = vec4f(mirrored, clamp(wet1.y, 0.0, 1.0) * (water + road));
    return s;
}
// </wet-surface>

/// The plain wet ground of `createWetGround`: the standard look under the add-on's water.
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let depth = wet_noise_depth(input.worldPosition.xz, 18.0);
    return wet_surface(s, input, depth, material.wet0, material.wet1, material.wet2);
}
