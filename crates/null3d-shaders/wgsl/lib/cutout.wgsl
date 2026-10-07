#define_import_path null3d::cutout

#import null3d::noise::{lattice, to_unit}

// The two ways besides the plain cutoff in which the masked builds (ALPHA_MASK) of the mesh and
// sprite templates test a fragment's alpha. Each has a permutation bit of its own, so the plain
// mask's builds carry none of this code, and the builds of each load on first use.
//
// - Alpha to coverage (ALPHA_COVERAGE) fades the alpha from 0 at the cutoff to 1 over about a
//   pixel, as three.js's `alphaToCoverage` fades it, and writes the faded alpha. MSAA turns it into
//   the share of the pixel's samples that the fragment covers, so cut edges smooth as polygon
//   edges do. A multisampled target without alpha, such as WebGPU's rg11b10ufloat scene color,
//   cannot turn alpha into coverage. There the SAMPLE_MASK builds write the coverage through
//   `sample_mask` themselves (`masked_fragment`).
// - The alpha hash (ALPHA_HASH) keeps a fragment when its alpha reaches a threshold from a hash of
//   its place on the mesh, three.js's `alphaHash` (Wyman and McGuire's hashed alpha test). The
//   alpha then sets the share of the surface that draws, and the pattern stays on the mesh as it
//   moves. Each cell's hash is integer math, so every GPU draws the same pattern.
//
// Both read derivatives, so the templates call them in uniform control flow, before the test
// discards.

/// The narrowest fade, in alpha, for an alpha that does not change across the pixel.
const MIN_FADE: f32 = 1e-4;
/// The hash's cells per unit of position change across a pixel, three.js's `ALPHA_HASH_SCALE`.
const ALPHA_HASH_SCALE: f32 = 0.05;

/// How much of the pixel a fragment of alpha to coverage covers, from 0, where the caller discards
/// it, to 1: its `alpha` faded over `fade`, the alpha's change across the pixel, from `cutoff` up,
/// as three.js fades it.
fn alpha_coverage(alpha: f32, fade: f32, cutoff: f32) -> f32 {
    return smoothstep(cutoff, cutoff + max(fade, MIN_FADE), alpha);
}

/// A hash from 0 to 1 of a cell of the mesh's space, given by its whole coordinates. three.js
/// hashes the sines of the coordinates and scales them up, so each GPU's sine, which differs in its
/// last bits, draws its own pattern. The integer hash of `null3d::noise` gives every GPU the same
/// value.
fn hash_cell(cell: vec3f) -> f32 {
    return to_unit(lattice(vec3i(cell)).x);
}

/// The alpha below which the alpha hash discards a fragment at `position`, in the mesh's own
/// space, as three.js's `getAlphaHashThreshold` gives it, with `hash_cell`: the hash of the
/// position in cells of two sizes near the pixel's size, a power of two apart, blended by where the
/// pixel lies between them, then spread evenly from 0 to 1. It reads derivatives, so it runs in uniform control flow.
fn alpha_hash_threshold(position: vec3f) -> f32 {
    let change = max(length(dpdx(position)), length(dpdy(position)));
    let pixel_scale = 1.0 / (ALPHA_HASH_SCALE * change);
    let scale_log = log2(pixel_scale);
    let scales = vec2f(exp2(floor(scale_log)), exp2(ceil(scale_log)));
    let hashes = vec2f(
        hash_cell(floor(scales.x * position)),
        hash_cell(floor(scales.y * position)),
    );
    let blend = fract(scale_log);
    let x = (1.0 - blend) * hashes.x + blend * hashes.y;
    let a = min(blend, 1.0 - blend);
    let low = x * x / (2.0 * a * (1.0 - a));
    let middle = (x - 0.5 * a) / (1.0 - a);
    let high = 1.0 - (1.0 - x) * (1.0 - x) / (2.0 * a * (1.0 - a));
    let threshold = select(high, select(middle, low, x < a), x < 1.0 - a);
    return clamp(threshold, 1.0e-6, 1.0);
}

#ifdef SAMPLE_MASK
/// What a fragment of alpha to coverage writes where it covers the pixel's samples itself.
struct MaskedFragment {
    @location(0) color: vec4f,
    @builtin(sample_mask) mask: u32,
}

/// The samples of the pixel that a coverage takes, of 4: the share rounded, with the samples far
/// apart taken first, so two samples lie on a diagonal of the pixel.
fn coverage_mask(coverage: f32) -> u32 {
    let masks = vec4u(0x1u, 0x9u, 0xbu, 0xfu);
    let taken = u32(round(clamp(coverage, 0.0, 1.0) * 4.0));
    return select(0u, masks[max(taken, 1u) - 1u], taken > 0u);
}

/// A fragment of `color` with its coverage in its alpha, as the templates write it: the samples
/// that the coverage takes, in full color.
fn masked_fragment(color: vec4f) -> MaskedFragment {
    return MaskedFragment(vec4f(color.rgb, 1.0), coverage_mask(color.a));
}
#endif
