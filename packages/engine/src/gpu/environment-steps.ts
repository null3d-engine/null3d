// The draws that make an environment map on the GPU (D-19), as both backends run them: their order,
// what each reads and fills, and its uniform values. The asset tool makes the same maps on the CPU,
// and these steps follow its own. The room starts with a trace of the room at full size and a
// blur; a panorama starts with its light mapped onto the cube. Then come a chain of halved levels
// and one filtered level for each roughness. A backend runs every step in one submit, so the map
// is whole before any frame reads it (D-66).
//
// A sky map runs in stages instead (D-118), which the engine core spreads over frames: its first
// stage draws the sky into every level of the chain, each level from the sky itself, so no draw
// waits for another's texels. Each later stage filters one level of the map, and the last copies
// the finished levels into the map.

/** The blur of three.js's examples' `pmremGenerator.fromScene(room, 0.04)`, in radians. */
const ROOM_SIGMA = 0.04;

/**
 * The filter's directions per texel at level 1. Each smaller level takes twice as many, up to the
 * most.
 */
const FIRST_SAMPLES = 512;
const MOST_SAMPLES = 8192;

/** The fewest and the most directions a side that a cube texel averages of a panorama. */
const FEWEST_PANORAMA_SAMPLES = 2;
const MOST_PANORAMA_SAMPLES = 8;

/** Bytes of one step's uniform values, as the shader's `Step` holds them. */
export const STEP_BYTES = 32;

/** Bytes of the sky's settings, as the shader's `SkySettings` holds them. */
export const SKY_BYTES = 64;

/** How a sky map filters: the directions of each texel that the filter and the chain take. */
export interface SkyFilter {
	/** The filter's directions per texel at level 1. Each smaller level takes twice as many. */
	readonly samples: number;
	/** The most directions a side that a texel of the chain averages of the sky. */
	readonly chainSamples: number;
}

/**
 * The sky map's filter. The sky has no sun disc and no sharp light, so a quarter of the directions
 * that a file's map takes keep each level within half a step of 255 of a far finer filter, on
 * average. The chain's directions barely change the light (D-118).
 */
export const SKY_FILTER: SkyFilter = { samples: 128, chainSamples: 2 };

/**
 * Where a map's light comes from: the built-in room, or a panorama of `width` by `height` texels
 * whose texels hold the light divided by `gain`.
 */
export type MapSource =
	| 'room'
	| { readonly width: number; readonly height: number; readonly gain: number };

/** Where a sky map's draws put their texels: a level of its chain, or a level of the map. */
export type SkyInto = 'chain' | 'target';

/**
 * The textures of a generation: `traced`, the traced room at full size; `chain`, the room or the
 * panorama on the cube and its levels down to one texel; and `target`, the environment map.
 */
export type StepTexture = 'traced' | 'chain' | 'target';

/** What a step reads: a cube texture of the generation, the panorama, or the sky's settings. */
export type StepSource = 'traced' | 'chain' | 'panorama' | 'sky';

/**
 * One draw: a level, with the shader's pipeline and the textures it reads and fills. Its six faces
 * lie side by side in the target, from +X to -Z, so one draw runs every face's texels at once.
 */
export interface Step {
	readonly pipeline: 'trace' | 'blur' | 'half' | 'prefilter' | 'panorama' | 'sky';
	readonly level: number;
	/** The texels across a side of each face at the level. */
	readonly size: number;
	/**
	 * The prefilter's directions per texel, the panorama's directions a side of each texel, or 0
	 * for the other pipelines.
	 */
	readonly samples: number;
	/** The blur's sigma, the source level that `half` reads, or the prefilter's roughness. */
	readonly value: number;
	/** The factor of the light that the draw stores. */
	readonly gain: number;
	readonly source: StepSource;
	/** The first row of the level in the target that the draw fills, which only a sky's chain uses. */
	readonly row: number;
	/** The textures that take the draw's texels at the level. */
	readonly into: readonly StepTexture[];
}

/** The levels of a chain from faces `size` texels wide down to one texel. */
export function chainLevels(size: number): number {
	return Math.log2(size) + 1;
}

/**
 * How many directions a side a cube texel averages of a panorama `width` texels wide, so that each
 * texel covers the panorama's texels under it, as the asset tool counts them.
 */
export function panoramaSamples(width: number, size: number): number {
	const samples = Math.ceil(width / (4 * size)) + 1;
	return Math.min(Math.max(samples, FEWEST_PANORAMA_SAMPLES), MOST_PANORAMA_SAMPLES);
}

/**
 * The steps that fill an environment map with faces `size` texels wide and `levels` mip levels
 * from `source`, in order, and the uniform values of each, at the start of a slot of `stride`
 * bytes. Each step reads only levels that earlier steps filled.
 *
 * A panorama's chain holds its light divided by its gain, as its texels do, so a sun beyond the
 * largest shared-exponent value keeps its light. The steps that write the map multiply the gain
 * back in, and the map's texels then stop at that largest value, as the tool's do.
 */
export function environmentSteps(
	source: MapSource,
	size: number,
	levels: number,
	stride: number,
): [Step[], ArrayBuffer] {
	const gain = source === 'room' ? 1 : source.gain;
	const top: StepTexture[] = gain === 1 ? ['chain', 'target'] : ['chain'];
	const base = { level: 0, size, samples: 0, value: 0, gain: 1, row: 0 };
	const steps: Step[] = [];
	if (source === 'room')
		steps.push(
			{ ...base, pipeline: 'trace', source: 'traced', into: ['traced'] },
			{ ...base, pipeline: 'blur', value: ROOM_SIGMA, source: 'traced', into: top },
		);
	else {
		const panorama = {
			...base,
			pipeline: 'panorama',
			samples: panoramaSamples(source.width, size),
			source: 'panorama',
		} as const;
		steps.push({ ...panorama, into: top });
		if (gain !== 1) steps.push({ ...panorama, gain, into: ['target'] });
	}
	for (let level = 1; level < chainLevels(size); level++)
		steps.push({
			pipeline: 'half',
			level,
			size: size >> level,
			samples: 0,
			value: level - 1,
			gain: 1,
			row: 0,
			source: 'chain',
			into: ['chain'],
		});
	for (let level = 1; level < levels; level++)
		steps.push({
			pipeline: 'prefilter',
			level,
			size: size >> level,
			samples: Math.min(FIRST_SAMPLES << (level - 1), MOST_SAMPLES),
			// Level i of n holds perceptual roughness 1 - sqrt(1 - i / (n - 1)), as the tool's do.
			value: 1 - Math.sqrt(1 - level / (levels - 1)),
			gain,
			row: 0,
			source: 'chain',
			into: ['target'],
		});
	return [steps, stepValues(steps, size, stride)];
}

/** The uniform values of each step, at the start of a slot of `stride` bytes. */
function stepValues(steps: readonly Step[], size: number, stride: number): ArrayBuffer {
	const buffer = new ArrayBuffer(steps.length * stride);
	const words = new Uint32Array(buffer);
	const floats = new Float32Array(buffer);
	steps.forEach((step, k) => {
		const at = (k * stride) / 4;
		words.set([step.size, step.samples, size, step.row], at);
		floats[at + 4] = step.value;
		floats[at + 5] = step.gain;
	});
	return buffer;
}

/**
 * The draws of a sky map with faces `size` texels wide and `levels` mip levels, filtered as `filter`
 * says, and the uniform
 * values of each, at the start of a slot of `stride` bytes. The draws of the chain come first, one
 * for each of its levels, each into its own rows of the target, one level under another, so one
 * render pass draws them all. Then comes one filtered level of the map for each level from 1 on. Stage 0 of
 * the map runs the chain's draws, whose level 0 is the map's level 0 too; stage `k` runs the
 * filter of level `k`. Each step's `into` names what takes its texels.
 */
export function skySteps(
	size: number,
	levels: number,
	stride: number,
	filter: SkyFilter = SKY_FILTER,
): [Step[], ArrayBuffer] {
	const steps: Step[] = [];
	let row = 0;
	for (let level = 0; level < chainLevels(size); level++) {
		steps.push({
			pipeline: 'sky',
			level,
			size: size >> level,
			samples: Math.min(1 << level, filter.chainSamples),
			value: 0,
			gain: 1,
			row,
			source: 'sky',
			into: level === 0 ? ['chain', 'target'] : ['chain'],
		});
		row += size >> level;
	}
	for (let level = 1; level < levels; level++)
		steps.push({
			pipeline: 'prefilter',
			level,
			size: size >> level,
			samples: Math.min(filter.samples << (level - 1), MOST_SAMPLES),
			value: 1 - Math.sqrt(1 - level / (levels - 1)),
			gain: 1,
			row: 0,
			source: 'chain',
			into: ['target'],
		});
	return [steps, stepValues(steps, size, stride)];
}

/** The rows of the target that a sky map's draws fill: every level of its chain, one under another. */
export function skyRows(size: number): number {
	return 2 * size - 1;
}

/**
 * The byte offset of each level of a map with faces `size` texels wide in a buffer that holds the
 * levels one after another, each level's rows of six faces side by side, every row `rowBytes` of
 * its level long. The last entry is the buffer's size.
 */
export function levelOffsets(
	size: number,
	levels: number,
	rowBytes: (size: number) => number,
): number[] {
	const offsets = [0];
	for (let level = 0; level < levels; level++) {
		const side = size >> level;
		offsets.push((offsets[level] as number) + rowBytes(side) * side);
	}
	return offsets;
}
