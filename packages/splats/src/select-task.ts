// The task that chooses which splats draw, which the engine runs in a job worker beside the frames.
// The sketch writes each chunk's centre, radius and four level counts into a shared buffer with the
// camera and the budget, and the task writes the count that each chunk draws: a coarsest prefix for
// every chunk the budget reaches, then a finer prefix for the nearest chunks, up to the level that
// their distance asks for. Sorting the chunks by distance takes the work off the sketch's thread.
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

/**
 * The scratch of the last call's chunk count. A worker keeps the module between tasks, so the
 * arrays are made once and reused: a call that runs in every frame allocates nothing.
 */
let scratch = {
	chunks: -1,
	distances: new Float32Array(0),
	levels: new Uint8Array(0),
	order: [] as number[],
};

/** Orders two chunk indices by their distance from the camera, nearest first. */
function byDistance(a: number, b: number): number {
	return (scratch.distances[a] as number) - (scratch.distances[b] as number);
}

/**
 * Chooses each chunk's count, writes them after the chunks, and answers that it filled the buffer.
 * The sketch's thread reads the counts from the same buffer, so no count crosses a message.
 */
export function run(input: unknown): { output: boolean } {
	const { view } = input as { view: Float32Array };
	const chunks = view[CHUNK_COUNT] as number;
	if (chunks !== scratch.chunks) {
		scratch = {
			chunks,
			distances: new Float32Array(chunks),
			levels: new Uint8Array(chunks),
			order: new Array<number>(chunks),
		};
	}
	const { distances, levels, order } = scratch;
	const budget = view[BUDGET] as number;
	const eyeX = view[EYE] as number;
	const eyeY = view[EYE + 1] as number;
	const eyeZ = view[EYE + 2] as number;
	for (let i = 0; i < chunks; i++) {
		const at = HEADER + i * STRIDE;
		const dx = (view[at] as number) - eyeX;
		const dy = (view[at + 1] as number) - eyeY;
		const dz = (view[at + 2] as number) - eyeZ;
		const radius = view[at + 3] as number;
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		distances[i] = distance > radius ? distance - radius : 0;
		levels[i] = levelOf(distance, radius);
		order[i] = i;
	}
	order.sort(byDistance);
	const countsAt = HEADER + chunks * STRIDE;
	for (let i = 0; i < chunks; i++) view[countsAt + i] = 0;
	let left = budget;
	let total = 0;
	// The base level: each chunk, nearest first, keeps its coarsest prefix while the budget lasts.
	// A budget too small for every level then thins the whole cloud rather than dropping its far
	// parts, and a stream still fetches only the chunks that the budget reaches.
	for (const i of order) {
		if (left <= 0) break;
		const base = view[HEADER + i * STRIDE + 4 + (LEVELS - 1)] as number;
		const chosen = base < left ? base : left;
		view[countsAt + i] = chosen;
		left -= chosen;
		total += chosen;
	}
	// The rest of the budget refines the nearest chunks first, up to the level that each one's
	// distance asks for, so a near chunk is denser than a far one of the same size.
	for (const i of order) {
		if (left <= 0) break;
		const at = HEADER + i * STRIDE;
		const target = view[at + 4 + (levels[i] as number)] as number;
		const chosen = view[countsAt + i] as number;
		if (chosen >= target) continue;
		const rest = target - chosen;
		const more = rest < left ? rest : left;
		view[countsAt + i] = chosen + more;
		left -= more;
		total += more;
	}
	view[TOTAL] = total;
	return { output: true };
}
