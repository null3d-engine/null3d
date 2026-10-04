// The draws that make an environment map on the GPU (D-19), as both backends run them: their order,
// what each reads and fills, and its uniform values. The asset tool makes the same map on the CPU,
// and these steps follow its own: a trace of the room at full size, a blur, a chain of halved
// levels of the blurred room, and one filtered level for each roughness. The work splits into
// slices of about the same cost, one a frame, so the first use of an environment draws no long
// frame. A slice covers bands of rows of the steps' faces, in the steps' order.

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

/** Rows `y` to `y + rows` of every face of step `step`. */
export interface Band {
	readonly step: number;
	readonly y: number;
	readonly rows: number;
}

/**
 * The work of a texel of each pipeline, in units of about one texture read. The trace's 16 rays,
 * each against 13 boxes, cost about as much as 190 reads. The prefilter reads its directions, and
 * each read of a small level costs a fifth more. Measured on the Mac's GPU in Chrome, where the
 * slices then took 0.4 to 1.2 ms each, against 0.3 to 2.6 ms when every read counted as one.
 */
const TEXEL_COST = { trace: 190, blur: 169, half: 1 } as const;

/**
 * The fewest texels that a row counts as. A small level's rows run side by side on the GPU, but
 * each texel waits on a loop of thousands of reads, so a row of 48 texels costs about as much as one
 * of this many.
 */
const ROW_TEXELS = 400;

function texelCost(step: Step): number {
	return step.pipeline === 'prefilter' ? 1.2 * step.samples : TEXEL_COST[step.pipeline];
}

/** The modelled work of one row of a step's six faces, in units of about one texture read. */
export function rowCost(step: Step): number {
	return Math.max(6 * step.size, ROW_TEXELS) * texelCost(step);
}

/**
 * The bands of rows that each of `slices` slices draws, in order, so that each slice holds about
 * the same work. A slice may hold no band when the steps have fewer rows than slices.
 */
export function sliceBands(steps: readonly Step[], slices: number): Band[][] {
	const total = steps.reduce((sum, step) => sum + step.size * rowCost(step), 0);
	const plan: Band[][] = Array.from({ length: slices }, () => []);
	let done = 0;
	steps.forEach((step, k) => {
		for (let y = 0; y < step.size; y++) {
			const slice = Math.min(slices - 1, Math.floor((done * slices) / total));
			const bands = plan[slice] as Band[];
			const last = bands[bands.length - 1];
			if (last?.step === k && last.y + last.rows === y)
				bands[bands.length - 1] = { step: k, y: last.y, rows: last.rows + 1 };
			else bands.push({ step: k, y, rows: 1 });
			done += rowCost(step);
		}
	});
	return plan;
}
