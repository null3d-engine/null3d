// The draws that make an environment map on the GPU (D-19), as both backends run them: their order,
// what each reads and fills, and its uniform values. The asset tool makes the same map on the CPU,
// and these steps follow its own: a trace of the room at full size, a blur, a chain of halved
// levels of the blurred room, and one filtered level for each roughness. A backend runs every step
// in one submit, so the map is whole before any frame reads it (D-66).

/** The blur of three.js's examples' `pmremGenerator.fromScene(room, 0.04)`, in radians. */
const ROOM_SIGMA = 0.04;

/**
 * The filter's directions per texel at level 1. Each smaller level takes twice as many, up to the
 * most.
 */
const FIRST_SAMPLES = 512;
const MOST_SAMPLES = 8192;

/** Bytes of one step's uniform values, as the shader's `Step` holds them. */
export const STEP_BYTES = 32;

/**
 * The textures of a generation: `traced`, the traced room at full size; `chain`, the blurred room
 * and its levels down to one texel; and `target`, the environment map.
 */
export type StepTexture = 'traced' | 'chain' | 'target';

/**
 * One draw: a level, with the shader's pipeline and the textures it reads and fills. Its six faces
 * lie side by side in the target, from +X to -Z, so one draw runs every face's texels at once.
 */
export interface Step {
	readonly pipeline: 'trace' | 'blur' | 'half' | 'prefilter';
	readonly level: number;
	/** The texels across a side of each face at the level. */
	readonly size: number;
	/** The prefilter's directions per texel, or 0 for the other pipelines. */
	readonly samples: number;
	/** The blur's sigma, the source level that `half` reads, or the prefilter's roughness. */
	readonly value: number;
	readonly source: 'traced' | 'chain';
	/** The textures that take the draw's texels at the level. */
	readonly into: readonly StepTexture[];
}

/** The levels of a chain from faces `size` texels wide down to one texel. */
export function chainLevels(size: number): number {
	return Math.log2(size) + 1;
}

/**
 * The steps that fill an environment map of the room with faces `size` texels wide and `levels`
 * mip levels, in order, and the uniform values of each, at the start of a slot of `stride` bytes.
 * Each step reads only levels that earlier steps filled.
 */
export function roomSteps(size: number, levels: number, stride: number): [Step[], ArrayBuffer] {
	const top: StepTexture[] = ['chain', 'target'];
	const steps: Step[] = [
		{ pipeline: 'trace', level: 0, size, samples: 0, value: 0, source: 'traced', into: ['traced'] },
		{
			pipeline: 'blur',
			level: 0,
			size,
			samples: 0,
			value: ROOM_SIGMA,
			source: 'traced',
			into: top,
		},
	];
	for (let level = 1; level < chainLevels(size); level++)
		steps.push({
			pipeline: 'half',
			level,
			size: size >> level,
			samples: 0,
			value: level - 1,
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
	});
	return [steps, buffer];
}
