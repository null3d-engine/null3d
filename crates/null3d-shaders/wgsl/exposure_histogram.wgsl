// The automatic exposure's histogram path: two compute steps on WebGPU.
//
// `histogram` reads one filtered tap at each sample of a grid over the color's drawn corner, 128
// samples on its short side. Each sample adds its center weight, in 256ths, to the bin of its
// stops, first in workgroup memory, then in the histogram buffer. Integer sums keep the result the
// same in every run, whatever order the workgroups run in.
//
// `adapt` runs once. It meters the bins (null3d::exposure), moves the stored exposure toward the
// result, writes the new exposure to the state buffer and to the texel that the final pass reads,
// and empties the bins for the next frame.

#import null3d::exposure::{Settings, BINS, adapted, bin_of, center_weight, meter, stops}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;
@group(0) @binding(3) var<storage, read_write> histogram: array<atomic<u32>, 128>;
@group(0) @binding(4) var<storage, read_write> state: vec4f;
@group(0) @binding(5) var exposure_texel: texture_storage_2d<rgba32float, write>;

/// The invocations of a workgroup each way: 64 in all, half the bins.
const SIDE: u32 = 8u;

var<workgroup> local_bins: array<atomic<u32>, 128>;

@compute @workgroup_size(8, 8)
fn histogram_main(
    @builtin(global_invocation_id) id: vec3u,
    @builtin(local_invocation_index) index: u32,
) {
    atomicStore(&local_bins[index], 0u);
    atomicStore(&local_bins[index + SIDE * SIDE], 0u);
    workgroupBarrier();
    let grid = vec2u(settings.grid.xy);
    if all(id.xy < grid) {
        let sample = vec2f(id.xy) + 0.5;
        let at = clamp(
            sample * settings.map.xy + settings.map.zw,
            settings.bounds.xy,
            settings.bounds.zw,
        );
        let s = stops(textureSampleLevel(source, source_sampler, at, 0.0).rgb);
        let weight = center_weight(sample / settings.grid.xy, settings.grid.z, settings.shares.z);
        atomicAdd(&local_bins[bin_of(s)], max(u32(weight * 256.0 + 0.5), 1u));
    }
    workgroupBarrier();
    for (var bin = index; bin < BINS; bin += SIDE * SIDE) {
        let count = atomicLoad(&local_bins[bin]);
        if count > 0u {
            atomicAdd(&histogram[bin], count);
        }
    }
}

@compute @workgroup_size(1)
fn adapt_main() {
    var bins: array<f32, 128>;
    for (var bin = 0u; bin < BINS; bin++) {
        bins[bin] = f32(atomicLoad(&histogram[bin]));
        atomicStore(&histogram[bin], 0u);
    }
    let metered = meter(&bins, settings.shares.x, settings.shares.y);
    let result = adapted(state.y, metered, settings);
    state = result;
    textureStore(exposure_texel, vec2i(0), result);
}
