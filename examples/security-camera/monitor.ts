// The monitor's surface: the pass's feed shown as a night camera shows it, raised and tinted gray,
// with scan lines, a brighter band that rolls down and a darker rim. Close up, the panel's red,
// green and blue stripes show, with a few dead cells among them.
export const monitor = /* wgsl */ `
#import null3d::noise::{random2}

var feed: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let light = dot(textureSample(feed, feedSampler, input.uv).rgb, vec3f(0.2126, 0.7152, 0.0722));
    let lines = 0.8 + 0.2 * sin(input.uv.y * 450.0 + frame.time * 6.0);
    let roll = 1.0 + 0.15 * smoothstep(0.9, 1.0, fract(input.uv.y * 0.5 - frame.time * 0.15));
    let rim = 1.0 - pow(length(input.uv - vec2f(0.5)) * 1.2, 4.0);
    let cell = floor(input.uv.x * 120.0);
    let stripe = fract(cell / 3.0);
    let mask = vec3f(step(stripe, 0.34), step(0.34, stripe) * step(stripe, 0.67), step(0.67, stripe));
    let near = 1.0 - smoothstep(0.006, 0.02, fwidth(input.uv.x));
    let dead = step(0.01, random2(floor(input.uv * vec2f(120.0, 80.0))));
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(0.8, 0.95, 1.0) * sqrt(light * 3.0) * lines * roll * rim * dead;
    s.emissive *= mix(vec3f(1.0), vec3f(0.96) + mask * 0.12, near);
    return s;
}
`;
