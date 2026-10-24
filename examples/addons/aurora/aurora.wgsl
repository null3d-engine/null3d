// The aurora: curtains of green and violet light that hang over the horizon, drawn as a sky layer
// over the core sky. The layer projects each fragment's view ray onto a plane in the sky, so the
// curtains keep their shape as the camera turns, and it hangs them from a height that wanders with
// the fractal noise, so they fold and drift as the sketch time grows. The core sky's cloud coverage
// and density hide the aurora, as clouds hide the stars.
//
// A ray below the horizon, or one nearly parallel to it, draws nothing: the projection would run
// away toward the horizon line.

#import null3d::noise::{fbm2}

/// The lowest direction's height that draws: half a degree over the horizon.
const HORIZON: f32 = 0.01;

/// The green of the aurora's foot, and the violet of its crown.
const GREEN: vec3f = vec3f(0.10, 0.92, 0.44);
const VIOLET: vec3f = vec3f(0.42, 0.24, 0.85);

fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    let direction = normalize(input.direction);
    let height = direction.y;
    if height <= HORIZON {
        return SkyLayer(vec3f(0.0), 0.0);
    }
    // The view ray meets the sky's plane at this distance across it, which stretches out toward
    // the horizon.
    let across = direction.xz / max(height, 0.06);
    let at = across * 0.5 + vec2f(input.time * 0.015, 0.0);

    // The curtain's foot wanders across the sky, and the curtain thins above and below it.
    let foot = 0.24 + 0.22 * fbm2(at, 3u);
    let away = (height - foot) / 0.16;
    let curtain = exp(-away * away);
    // Broad folds, then thin upright rays, so the curtain reads as light rather than a wash.
    let folds = clamp(0.5 + 0.5 * fbm2(at * vec2f(5.0, 2.0) + vec2f(input.time * 0.04, 0.0), 3u), 0.0, 1.0);
    let rays = 0.5 + 0.5 * fbm2(at * vec2f(30.0, 3.0) + vec2f(input.time * 0.12, 0.0), 2u);
    // The crown fades out: an aurora's light thins with height.
    let crown = 1.0 - smoothstep(foot, foot + 0.4, height);
    let light = curtain * crown * (0.35 + 0.65 * folds) * (0.7 + 0.3 * rays);

    // The air's clouds cover the aurora in the same places that they cover the stars.
    let clear = 1.0 - clamp(input.clouds.x * input.clouds.y * 2.5, 0.0, 1.0);
    let brightness = clamp(light * clear * 1.5, 0.0, 1.0);
    let color = mix(GREEN, VIOLET, smoothstep(foot + 0.05, foot + 0.3, height));
    return SkyLayer(color * 2.6 * brightness, brightness);
}
