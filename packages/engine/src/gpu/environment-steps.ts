// The draws that make an environment map on the GPU (D-19), as both backends run them: their order,
// what each reads and fills, and its uniform values. The asset tool makes the same maps on the CPU,
// and these steps follow its own. The room starts with a trace of the room at full size and a
// blur; a panorama starts with its light mapped onto the cube. Then come a chain of halved levels
// and one filtered level for each roughness. A backend runs every step in one submit, so the map
// is whole before any frame reads it (D-66).

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

/**
 * Where a map's light comes from: the built-in room, or a panorama of `width` by `height` texels
 * whose texels hold the light divided by `gain`.
 */
export type MapSource =
	| 'room'
	| { readonly width: number; readonly height: number; readonly gain: number };

/**
 * The textures of a generation: `traced`, the traced room at full size; `chain`, the room or the
 * panorama on the cube and its levels down to one texel; and `target`, the environment map.
 */
export type StepTexture = 'traced' | 'chain' | 'target';

/** What a step reads: a cube texture of the generation, or the panorama. */
export type StepSource = 'traced' | 'chain' | 'panorama';

/**
 * One draw: a level, with the shader's pipeline and the textures it reads and fills. Its six faces
 * lie side by side in the target, from +X to -Z, so one draw runs every face's texels at once.
 */
export interface Step {
	readonly pipeline: 'trace' | 'blur' | 'half' | 'prefilter' | 'panorama';
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
	const base = { level: 0, size, samples: 0, value: 0, gain: 1 };
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
			source: 'chain',
			into: ['target'],
		});
	const buffer = new ArrayBuffer(steps.length * stride);
	const words = new Uint32Array(buffer);
	const floats = new Float32Array(buffer);
	steps.forEach((step, k) => {
		const at = (k * stride) / 4;
		words.set([step.size, step.samples, size, 0], at);
		floats[at + 4] = step.value;
		floats[at + 5] = step.gain;
	});
	return [steps, buffer];
}
