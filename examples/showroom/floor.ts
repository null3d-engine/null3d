// The two floors of the showroom scene: the studio's polished mirror and the street's wet asphalt.
// Both read the one planar reflection pass that mirrors the scene across the ground, so the mirror
// shows the car from underneath and the street carries the lamps, the neon and the windows. A
// surface function returns the floor's own shade and hands the engine the reflected picture, which
// it blends in at an angle as a real surface does.

/**
 * The studio's mirror floor: dark polished stone that reflects almost all of the picture, with a
 * faint grain in its light so that it reads as a surface rather than a hole.
 */
export const MIRROR_FLOOR = /* wgsl */ `
#import null3d::noise::fbm2
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let grain = fbm2(p * 1.4, 3u);
    s.baseColor *= 0.16 + 0.06 * grain;
    s.roughness = 0.035;
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 0.94);
    return s;
}
`;

/**
 * The street's wet asphalt: rough dark stone between smooth puddles, whose water carries the
 * reflection and darkens the stone under it. The puddles come from broad noise, so they never
 * repeat along the street.
 */
export const WET_ROAD = /* wgsl */ `
#import null3d::noise::fbm2
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    // A broad noise lays the puddles, and a fine one gives the dry asphalt its grit.
    let wet = smoothstep(0.1, 0.28, fbm2(p * 0.18, 4u));
    let grit = fbm2(p * 2.2, 3u);
    s.baseColor *= mix(0.5 + 0.3 * grit, 0.2, wet);
    s.roughness = mix(0.6 + 0.2 * grit, 0.04, wet);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, wet * 0.9);
    return s;
}
`;
