#define_import_path null3d::exposure
#import null3d::color::{limit_hdr, luminance}

// The automatic exposure's meter, which both of its paths share: the histogram of compute shaders
// on WebGPU, and the downsample of full-screen steps (see `exposure.wgsl`).
//
// The meter reads the scene's brightness in stops: log2 of a luminance over middle gray, 0.18, in
// the color as the camera's exposure leaves it. It adds each sample's center weight to a bin of
// those stops, takes the weighted mean of the bins between two shares of the total weight, and
// clamps it to the eye's range. The stored exposure then moves toward it at the speed for a
// brighter or a darker scene, and the final pass multiplies the color by 2^(compensation -
// adapted stops).

/// The meter's settings, which the frame builder writes for every step.
struct Settings {
    /// xy: the color's texture coordinates per cell or sample of the grid. zw: those of the
    /// grid's first cell, before the corners' origins line up.
    map: vec4f,
    /// xy: the lowest texture coordinates of the color's drawn corner. zw: the highest.
    bounds: vec4f,
    /// xy: the grid's cells or samples across and down. z: the drawn corner's width over its
    /// height. w: unused.
    grid: vec4f,
    /// x and y: the shares of the total weight that the mean starts and ends at, 0 and 1 for the
    /// mean of everything. z: the center weight, from 0 to 1. w: unused.
    shares: vec4f,
    /// x and y: the darkest and the brightest scene that the eye adapts to, in stops. z: the
    /// compensation in stops. w: unused.
    limits: vec4f,
    /// x: the speed in stops per second while the scene grows brighter. y: while it grows darker.
    /// z: the seconds since the frame before. w: 1 to take the metered stops at once.
    adapt: vec4f,
}

/// Middle gray: the luminance that the meter's 0 stops shows as.
const KEY: f32 = 0.18;
/// The lowest and the highest stops that the bins hold.
const LOWEST: f32 = -16.0;
const HIGHEST: f32 = 16.0;
/// The bins of the histogram, each a quarter of a stop.
const BINS: u32 = 128u;
/// The bins per stop.
const PER_STOP: f32 = 4.0;

/// The stops of linear color `c` over middle gray, within the bins' range. Black takes the lowest.
fn stops(c: vec3f) -> f32 {
    let l = luminance(limit_hdr(max(c, vec3f(0.0))));
    return clamp(log2(max(l, 1e-10) / KEY), LOWEST, HIGHEST);
}

/// The bin of `s` stops.
fn bin_of(s: f32) -> u32 {
    return min(u32((s - LOWEST) * PER_STOP), BINS - 1u);
}

/// The stops at the center of bin `bin`.
fn bin_stops(bin: u32) -> f32 {
    return (f32(bin) + 0.5) / PER_STOP + LOWEST;
}

/// The weight of a sample at `place`, from 0 to 1 across the image each way, on an image of
/// `aspect` width over height: 1 everywhere at a center weight of 0, and with a center weight
/// above 0 less away from the center, as `exp(-d²)` falls, `d` counted in half the short side.
fn center_weight(place: vec2f, aspect: f32, weight: f32) -> f32 {
    var p = (place - 0.5) * 2.0;
    if aspect >= 1.0 {
        p.x *= aspect;
    } else {
        p.y /= aspect;
    }
    return 1.0 - weight * (1.0 - exp(-dot(p, p)));
}

/// The weighted mean of the stops of `bins` between the shares `low` and `high` of their total
/// weight. The bins count from the darkest. With the shares 0 and 1 it is the mean of every bin.
fn meter(bins: ptr<function, array<f32, 128>>, low: f32, high: f32) -> f32 {
    var total = 0.0;
    for (var bin = 0u; bin < BINS; bin++) {
        total += (*bins)[bin];
    }
    let first = low * total;
    // The mean between two equal shares is the bin that holds them.
    let last = max(high * total, first + total * 0.0001);
    var start = 0.0;
    var sum = 0.0;
    var weight = 0.0;
    for (var bin = 0u; bin < BINS; bin++) {
        let w = (*bins)[bin];
        let overlap = max(min(start + w, last) - max(start, first), 0.0);
        sum += overlap * bin_stops(bin);
        weight += overlap;
        start += w;
    }
    return select(0.0, sum / weight, weight > 0.0);
}

/// The exposure after a frame whose meter read `metered` stops, from the `previous` adapted
/// stops: the factor that the final pass multiplies the color by, the adapted stops, the metered
/// stops, and 1. The adapted stops move toward the metered ones within the eye's range at the
/// speed for a brighter or a darker scene, and slow down within one stop of them. On the first
/// frame they take the metered stops at once.
fn adapted(previous: f32, metered: f32, settings: Settings) -> vec4f {
    let goal = clamp(metered, settings.limits.x, settings.limits.y);
    var stops_now = goal;
    if settings.adapt.w < 0.5 {
        let delta = goal - previous;
        let speed = select(settings.adapt.y, settings.adapt.x, delta > 0.0);
        let reach = speed * settings.adapt.z;
        stops_now = previous + delta * min(1.0, reach / max(abs(delta), 1.0));
    }
    return vec4f(exp2(settings.limits.z - stops_now), stops_now, metered, 1.0);
}
