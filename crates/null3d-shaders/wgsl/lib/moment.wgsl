#define_import_path null3d::moment

// Order-independent transparency from a store of four depth moments (decision record D-261).
//
// Each fragment of the moment pass adds four power moments of its own optical depth: the depth's
// total, then that total times the warped depth, its square and its cube, all relative to the
// fragment's total. The store adds them with no weight, so the order of the draws does not matter.
//
// The colour pass draws the same surfaces again and reads the store. The four moments fit two
// atoms of optical depth in the warped depth, and the fit gives the transmittance from the eye to
// any depth: the share of light that survives the surfaces in front of it. A fragment's colour
// then joins the colour sum weighted by the transmittance at its own depth, times the share it
// covers.
//
// The composite reads both targets and blends the summed colour over the scene by the share that
// the total optical depth covers. The moment store's total optical depth is also the coverage
// that the anti-aliasing step smooths the layer's edges under.

#import null3d::mesh::{frame, view_depth}

/// The most alpha that a fragment's optical depth counts, so a fully opaque fragment adds a finite
/// amount, as the weighted layer's coverage clamps it.
const MOST_ALPHA: f32 = 0.9995;
/// The least spread of the fitted atoms, below which the fit puts every atom at the mean depth: a
/// store of one surface has none.
const LEAST_SPREAD: f32 = 1e-6;

/// The optical depth of a fragment of `alpha`: minus the natural logarithm of the share that shows
/// through it.
fn optical_depth(alpha: f32) -> f32 {
    return -log(1.0 - min(clamp(alpha, 0.0, 1.0), MOST_ALPHA));
}

/// The warped depth of a position relative to the camera: 0 at the near plane and 1 at the far
/// plane, through the logarithm between them.
fn warped_depth(relative: vec3f) -> f32 {
    let z = max(view_depth(relative), 1e-6);
    let range = frame.camera_range;
    let near = max(range.x, 1e-6);
    let far = max(range.y, near + 1e-6);
    return clamp(log(z / near) / log(far / near), 0.0, 1.0);
}

/// The transmittance from the eye to `u`, from the moments `b`: the share of light that survives
/// the surfaces in front of it. The fit places two atoms of optical depth in the warped depth, and
/// each atom absorbs its share of the total from its own depth on.
fn transmittance(b: vec4f, u: f32) -> f32 {
    if b.x <= 0.0 {
        return 1.0;
    }
    let mean = b.y / b.x;
    let second = b.z / b.x;
    let third = b.w / b.x;
    let spread = second - mean * mean;
    // One surface, or several at one depth, has no spread: every atom sits at the mean depth.
    if spread < LEAST_SPREAD {
        return exp(-b.x * select(0.0, 1.0, u > clamp(mean, 0.0, 1.0)));
    }
    let a0 = (mean * third - second * second) / spread;
    let a1 = (mean * second - third) / spread;
    let root = sqrt(max(a1 * a1 - 4.0 * a0, 0.0));
    let low = clamp((-a1 - root) * 0.5, 0.0, 1.0);
    let high = clamp((-a1 + root) * 0.5, 0.0, 1.0);
    // The two atoms met, so the fit puts them both at the mean depth.
    if high - low < LEAST_SPREAD {
        return exp(-b.x * select(0.0, 1.0, u > clamp(mean, 0.0, 1.0)));
    }
    let near_share = clamp((high - mean) / (high - low), 0.0, 1.0);
    let far_share = 1.0 - near_share;
    let absorbed = select(0.0, near_share, u > low) + select(0.0, far_share, u > high);
    return exp(-b.x * absorbed);
}

/// The share of the scene that the moments `b` cover: one minus the transmittance through every
/// surface that they store.
fn coverage(b: vec4f) -> f32 {
    return 1.0 - exp(-max(b.x, 0.0));
}

/// The four moments that a fragment of `alpha` adds, at `relative` from the camera.
fn moment_fragment(alpha: f32, relative: vec3f) -> vec4f {
    let u = warped_depth(relative);
    let tau = optical_depth(alpha);
    return vec4f(tau, tau * u, tau * u * u, tau * u * u * u);
}

/// The colour sum that a fragment adds at `relative`, from the premultiplied `color` that its
/// shading gives and the moments `b`: its colour and the share it covers, each times the
/// transmittance at its own depth.
fn moment_colour_fragment(color: vec4f, relative: vec3f, b: vec4f) -> vec4f {
    let alpha = min(clamp(color.a, 0.0, 1.0), MOST_ALPHA);
    let weight = transmittance(b, warped_depth(relative));
    return vec4f(color.rgb * weight, alpha * weight);
}
