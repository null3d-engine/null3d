// The draws that make a reflection probe's map from its six capture views (D-149), as both
// backends run them: `gather` copies each view's image into its layer of the chain, `half` makes
// the chain's smaller levels (on WebGPU; WebGL2's own mip filter makes them), and `prefilter` fills
// each level of the probe's octahedral map for its roughness. The sizes of a probe's maps never
// change between filters, so each draw's uniform values are the same in every filter, and a
// backend writes them once.

/** Bytes of one draw's uniform values, as the probe shader's `Step` holds them. */
export const PROBE_STEP_BYTES = 32;

/** The filter's directions per texel at level 1. Each smaller level takes twice as many. */
const FIRST_SAMPLES = 128;

/** The most directions per texel of any level. */
const MOST_SAMPLES = 1024;

/** A probe filter's draws, by place in its block of uniform values. */
export interface ProbeSteps {
	/** The place of the draw that copies a view's image, which every face shares. */
	readonly gather: number;
	/** The place of the draw that makes level `level` of layer `layer` of the chain. */
	half(layer: number, level: number): number;
	/** The place of the draw that fills level `level` of the probe's map. */
	prefilter(level: number): number;
	/** How many draws there are. */
	readonly count: number;
	/** Every draw's uniform values, at the start of a slot of the stride each. */
	readonly values: ArrayBuffer;
}

/**
 * The draws of a probe's filter for maps `size` texels across with `levels` mip levels, and a chain
 * of faces `chainSize` texels across with every level, with each draw's values at the start of a
 * slot of `stride` bytes. Level `i` of `n` holds perceptual roughness `1 - sqrt(1 - i / (n - 1))`,
 * as an environment map's levels do.
 */
export function probeSteps(
	size: number,
	levels: number,
	chainSize: number,
	stride: number,
): ProbeSteps {
	const chainLevels = Math.log2(chainSize) + 1;
	const halves = 6 * (chainLevels - 1);
	const count = 1 + halves + levels;
	const values = new ArrayBuffer(count * stride);
	const words = new Uint32Array(values);
	const floats = new Float32Array(values);
	const write = (place: number, layer: number, samples: number, out: number, roughness: number) => {
		const at = (place * stride) / 4;
		words.set([layer, samples, chainSize, out], at);
		floats[at + 4] = roughness;
	};
	const half = (layer: number, level: number) => 1 + layer * (chainLevels - 1) + level - 1;
	const prefilter = (level: number) => 1 + halves + level;
	write(0, 0, 0, chainSize, 0);
	for (let layer = 0; layer < 6; layer++)
		for (let level = 1; level < chainLevels; level++)
			write(half(layer, level), layer, 0, chainSize >> level, 0);
	for (let level = 0; level < levels; level++) {
		const roughness = level === 0 ? 0 : 1 - Math.sqrt(1 - level / (levels - 1));
		const samples = level === 0 ? 0 : Math.min(FIRST_SAMPLES << (level - 1), MOST_SAMPLES);
		write(prefilter(level), 0, samples, size >> level, roughness);
	}
	return { gather: 0, half, prefilter, count, values };
}
