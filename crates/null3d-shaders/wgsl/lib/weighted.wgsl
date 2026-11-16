#define_import_path null3d::weighted

// Weighted blended transparency, the method of McGuire and Bavoil (2013), with the weight that
// three.js's OITPassNode gives by default (the paper's equation 9). A surface of the weighted
// blending writes two sums, which both add in their targets, so surfaces draw in any order:
//
// - the first target sums the fragment's premultiplied color and its alpha, each times a weight
//   that falls with the fragment's depth along the view, so near surfaces count for more;
// - the second sums -log2(1 - alpha). Two to the power of minus the sum is the product of
//   1 - alpha over the surfaces, the share of the scene behind them that shows through. The paper
//   multiplies 1 - alpha in its target instead, which needs a blend of its own; the sum blends as
//   the first target does, which compatibility mode requires.
//
// The composite (weighted.wgsl) divides the first sum by its alpha and blends the average color
// over the scene by the share that the surfaces cover.

#import null3d::mesh::{view_depth}

/// The two sums that a weighted surface adds into the targets of the weighted layer.
struct WeightedFragment {
    @location(0) sum: vec4f,
    @location(1) cover: vec4f,
}

/// The paper's weights times this: only the ratio of the weights shows, and the smaller weights
/// keep bright HDR colors of many layers within the range of 16-bit floats.
const WEIGHT_SCALE: f32 = 1.0 / 32.0;
/// The most alpha that the coverage counts, so a fully opaque fragment adds a finite amount.
const MOST_ALPHA: f32 = 0.9995;

/// The sums that a fragment of premultiplied `color` adds, at `relative` from the camera.
fn weighted_fragment(color: vec4f, relative: vec3f) -> WeightedFragment {
    let alpha = clamp(color.a, 0.0, 1.0);
    let z = max(view_depth(relative), 0.0) / 200.0;
    let z2 = z * z;
    let weight = alpha * clamp(0.03 / (1e-5 + z2 * z2), 1e-2, 3e3) * WEIGHT_SCALE;
    let cover = -log2(1.0 - min(alpha, MOST_ALPHA));
    return WeightedFragment(vec4f(color.rgb, alpha) * weight, vec4f(cover, 0.0, 0.0, 0.0));
}
