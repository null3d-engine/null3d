// The task that chooses which splats draw, which the engine runs in a job worker beside the frames.
// The sketch writes each chunk's centre, radius and four level counts into a shared buffer with the
// camera and the budget, and the task writes the count that each chunk draws: the level that its
// distance asks for, lowered where the budget runs out, and nothing for the chunks that the budget
// cannot reach. Sorting the chunks by distance takes the work off the sketch's thread.
//
// The module runs on its own in the worker, so it imports nothing.
//
// The buffer holds a header of `HEADER` floats, then `STRIDE` floats for each chunk, then one float
// for each chunk's chosen count.

/** The floats before the chunks: the count, the budget, the camera, and the answer's total. */
export const HEADER = 8;

/** The floats of each chunk: its centre, its radius and the counts of its four levels. */
export const STRIDE = 8;

/** The place of the chunk count in the header. */
export const CHUNK_COUNT = 0;
/** The place of the budget, the most splats that draw, in the header. */
export const BUDGET = 1;
/** The place of the camera's first number in the header. */
export const EYE = 2;
/** The place of the total that draws in the header. */
export const TOTAL = 6;

/** The number of detail levels of a chunk: every splat, then half, a quarter and an eighth. */
export const LEVELS = 4;

/** The level that a chunk draws at, from the distance to its nearest point and its radius. */
function levelOf(distance: number, radius: number): number {
	const near = Math.max(distance - radius, 0);
	const size = Math.max(radius, 1e-3);
	if (near <= size * 2) return 0;
	if (near <= size * 4) return 1;
	if (near <= size * 8) return 2;
	return LEVELS - 1;
}

/** Chooses each chunk's count, and answers them for the sketch's thread. */
export function run(input: unknown): { output: { counts: number[]; total: number } } {
	const { view } = input as { view: Float32Array };
	const chunks = view[CHUNK_COUNT] as number;
	const budget = view[BUDGET] as number;
	const eyeX = view[EYE] as number;
	const eyeY = view[EYE + 1] as number;
	const eyeZ = view[EYE + 2] as number;
	const counts = new Array<number>(chunks).fill(0);
	const levels = new Uint8Array(chunks);
	const distances = new Float32Array(chunks);
	const order = new Array<number>(chunks);
	for (let i = 0; i < chunks; i++) {
		const at = HEADER + i * STRIDE;
		const x = view[at] as number;
		const y = view[at + 1] as number;
		const z = view[at + 2] as number;
		const radius = view[at + 3] as number;
		const distance = Math.hypot(x - eyeX, y - eyeY, z - eyeZ);
		distances[i] = Math.max(distance - radius, 0);
		levels[i] = levelOf(distance, radius);
		order[i] = i;
	}
	order.sort((a, b) => (distances[a] as number) - (distances[b] as number));
	let left = budget;
	let total = 0;
	for (const i of order) {
		if (left <= 0) break;
		const at = HEADER + i * STRIDE;
		let level = levels[i] as number;
		// The level's count if it fits, else a coarser one; the coarsest takes what is left.
		while (level < LEVELS - 1 && (view[at + 4 + level] as number) > left) level++;
		const chosen = Math.min(view[at + 4 + level] as number, left);
		counts[i] = chosen;
		left -= chosen;
		total += chosen;
	}
	for (let i = 0; i < chunks; i++) view[HEADER + chunks * STRIDE + i] = counts[i] as number;
	view[TOTAL] = total;
	return { output: { counts, total } };
}
