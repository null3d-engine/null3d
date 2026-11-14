// The TypeScript reference of the selection: the same distances, levels, sort and budget passes
// that the add-on's WebAssembly module runs on the job workers. The unit tests and the parity test
// compare the module with this, so a change to one that the other misses fails.
//
// The buffer holds a header of `HEADER` floats, then `STRIDE` floats for each chunk, then one float
// for each chunk's chosen count. The layout comes from the task module, so the two cannot drift.
import {
	BUDGET,
	CHUNK_COUNT,
	CLOUD_RADIUS,
	EYE,
	HEADER,
	LEVELS,
	STRIDE,
	TOTAL,
} from './select-task';

/**
 * The level that a chunk draws at, from the distance to its nearest point and the cloud's size. The
 * distance is measured in the cloud's own radius, not the chunk's: a finer cut makes smaller chunks,
 * and measuring against them would let a smaller chunk pass for a farther one, so the same view
 * would draw fewer splats.
 */
export function levelOf(distance: number, radius: number, cloudRadius: number): number {
	const near = Math.max(distance - radius, 0);
	const size = Math.max(cloudRadius, 1e-3);
	if (near <= size * 2) return 0;
	if (near <= size * 4) return 1;
	if (near <= size * 8) return 2;
	return LEVELS - 1;
}

/** The scratch of the last call's chunk count. */
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
 * Chooses each chunk's count and writes them after the chunks. Answers the total that draws.
 * `view` is the whole buffer: the header, the chunks and the counts.
 */
export function runSelection(view: Float32Array): number {
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
	const cloudRadius = view[CLOUD_RADIUS] as number;
	for (let i = 0; i < chunks; i++) {
		const at = HEADER + i * STRIDE;
		const dx = (view[at] as number) - eyeX;
		const dy = (view[at + 1] as number) - eyeY;
		const dz = (view[at + 2] as number) - eyeZ;
		const radius = view[at + 3] as number;
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		distances[i] = distance > radius ? distance - radius : 0;
		levels[i] = levelOf(distance, radius, cloudRadius);
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
	return total;
}
