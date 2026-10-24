// A cloud cut into chunks, each of them in the order that a coarser level keeps: a chunk's first
// splats cover the most surface, so a prefix of the list stands in for the whole chunk from farther
// away. The draw chooses a prefix for each chunk by its distance, and the engine then sorts and
// culls the rows that the prefixes fill.
//
// The cut follows a grid in space, so a chunk holds nearby splats. That keeps a chunk's depth
// spread small, which is what makes one distance stand for all of its splats, and it gives the
// budget a set of independent pieces to leave out when a scene has more splats than draw.
import type { SplatData } from './format';

/** The splats that a chunk holds, at about. The cut keeps chunks within 4 times this. */
const CHUNK_SPLATS = 25_000;

/** The grid cells that one axis may have, so a scene far out never makes tiny cells. */
const MOST_CELLS_PER_AXIS = 16;

/**
 * One chunk of a cloud, with its splats in the order that a coarser level keeps.
 *
 * @category api/splats
 */
export interface SplatChunk {
	/** The center of the splats' bounds, in meters. */
	readonly center: readonly [number, number, number];
	/** The distance from the center to the farthest splat, in meters. */
	readonly radius: number;
	/** The number of splats. */
	readonly count: number;
	/** The centers, 3 floats each, most important first. */
	readonly positions: Float32Array;
	/** The rotations as unit quaternions, 4 floats each. */
	readonly rotations: Float32Array;
	/** The principal standard deviations, 3 floats each. */
	readonly scales: Float32Array;
	/** Linear RGBA colors, 4 floats each. */
	readonly colors: Float32Array;
}

/**
 * A cloud cut into chunks, and the splits that its levels take.
 *
 * @category api/splats
 */
export interface SplatChunks {
	/** The chunks that the cut made. */
	readonly chunks: readonly SplatChunk[];
	/** The number of splats, which the chunks together hold. */
	readonly total: number;
}

/**
 * Hands the thread back between chunks, so a large cloud never holds up a frame.
 *
 * @category api/splats
 */
export type Yielder = () => Promise<void>;

/**
 * How a cloud is cut, and what the caller sees as it is.
 *
 * @category api/splats
 */
export interface ChunkOptions {
	/** Runs between chunks, which lets the caller hand the thread back. */
	readonly yieldTo?: Yielder;
	/** Sees each chunk as it is ready, so a draw can take the cloud one chunk at a time. */
	readonly onChunk?: (chunk: SplatChunk) => void;
	/** The splats that a chunk holds, at about. The default is 25,000. */
	readonly splatsPerChunk?: number;
}

/**
 * Cuts a cloud into chunks of nearby splats, each ordered so that its first splats cover the most
 * surface. `yieldTo` runs between chunks, and `onChunk` sees each chunk as it is ready: a draw that
 * takes them one by one appears coarse to fine, and a large cloud never holds up a frame.
 *
 * @category api/splats
 */
export async function chunkSplats(
	data: SplatData,
	options: ChunkOptions = {},
): Promise<SplatChunks> {
	const { count } = data;
	if (count === 0) return { chunks: [], total: 0 };
	const { yieldTo, onChunk } = options;
	const bounds = boundsOf(data);
	const cellSplats = Math.min(count, options.splatsPerChunk ?? CHUNK_SPLATS);
	// Enough cells on a side that a cell holds about one chunk's load.
	const perAxis = Math.max(
		1,
		Math.min(MOST_CELLS_PER_AXIS, Math.ceil((count / cellSplats) ** (1 / 3))),
	);
	const cells = perAxis ** 3;
	const extent = [0, 1, 2].map((k) => (bounds.max[k] as number) - (bounds.min[k] as number));
	const scale = [0, 1, 2].map(
		(k) => ((perAxis - 1) / Math.max(extent[k] as number, 1e-9)) as number,
	);
	const cellOf = (i: number): number => {
		const position = data.positions;
		const x = Math.min(
			perAxis - 1,
			Math.floor(((position[i * 3] as number) - (bounds.min[0] as number)) * (scale[0] as number)),
		);
		const y = Math.min(
			perAxis - 1,
			Math.floor(
				((position[i * 3 + 1] as number) - (bounds.min[1] as number)) * (scale[1] as number),
			),
		);
		const z = Math.min(
			perAxis - 1,
			Math.floor(
				((position[i * 3 + 2] as number) - (bounds.min[2] as number)) * (scale[2] as number),
			),
		);
		return x + perAxis * (y + perAxis * z);
	};
	// A counting sort puts each splat in its cell, so the cut costs one pass over the cloud.
	const totals = new Uint32Array(cells + 1);
	for (let i = 0; i < count; i++) {
		const cell = cellOf(i) + 1;
		totals[cell] = (totals[cell] as number) + 1;
	}
	for (let c = 0; c < cells; c++) totals[c + 1] = (totals[c + 1] as number) + (totals[c] as number);
	const starts = totals.slice();
	const place = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		const cell = cellOf(i);
		const at = starts[cell] as number;
		place[at] = i;
		starts[cell] = at + 1;
	}
	const chunks: SplatChunk[] = [];
	for (let c = 0; c < cells; c++) {
		const first = totals[c] as number;
		const last = totals[c + 1] as number;
		if (last === first) continue;
		const chunk = chunkOf(data, place.subarray(first, last));
		chunks.push(chunk);
		onChunk?.(chunk);
		await yieldTo?.();
	}
	// A level's prefix is more useful the more of a chunk it keeps, so the biggest chunks draw
	// first when the budget cannot hold them all.
	return { chunks, total: count };
}

/** The cloud's bounds, and the center that the cut works with. */
function boundsOf(data: SplatData): {
	min: [number, number, number];
	max: [number, number, number];
} {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const { positions, count } = data;
	for (let i = 0; i < count; i++)
		for (let k = 0; k < 3; k++) {
			const value = positions[i * 3 + k] as number;
			if (value < (min[k] as number)) min[k] = value;
			if (value > (max[k] as number)) max[k] = value;
		}
	return { min, max };
}

/** One chunk's splats, most important first, and the bounds that its splats make. */
function chunkOf(data: SplatData, which: Uint32Array): SplatChunk {
	const count = which.length;
	const weight = new Float32Array(count);
	for (let k = 0; k < count; k++) {
		const i = which[k] as number;
		const volume =
			(data.scales[i * 3] as number) *
			(data.scales[i * 3 + 1] as number) *
			(data.scales[i * 3 + 2] as number);
		// A splat's importance is the surface that it covers, so its volume, weighted by its opacity.
		weight[k] = volume * Math.max(data.colors[i * 4 + 3] as number, 0);
	}
	const order = new Uint32Array(count);
	for (let k = 0; k < count; k++) order[k] = k;
	order.sort((a, b) => (weight[b] as number) - (weight[a] as number));
	const positions = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const scales = new Float32Array(count * 3);
	const colors = new Float32Array(count * 4);
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (let k = 0; k < count; k++) {
		const i = which[order[k] as number] as number;
		positions.set(data.positions.subarray(i * 3, i * 3 + 3), k * 3);
		rotations.set(data.rotations.subarray(i * 4, i * 4 + 4), k * 4);
		scales.set(data.scales.subarray(i * 3, i * 3 + 3), k * 3);
		colors.set(data.colors.subarray(i * 4, i * 4 + 4), k * 4);
		for (let axis = 0; axis < 3; axis++) {
			const value = data.positions[i * 3 + axis] as number;
			if (value < (min[axis] as number)) min[axis] = value;
			if (value > (max[axis] as number)) max[axis] = value;
		}
	}
	const center: [number, number, number] = [
		((min[0] as number) + (max[0] as number)) / 2,
		((min[1] as number) + (max[1] as number)) / 2,
		((min[2] as number) + (max[2] as number)) / 2,
	];
	let radius = 0;
	for (let k = 0; k < count; k++) {
		const dx = (positions[k * 3] as number) - center[0];
		const dy = (positions[k * 3 + 1] as number) - center[1];
		const dz = (positions[k * 3 + 2] as number) - center[2];
		radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
	}
	return { center, radius, count, positions, rotations, scales, colors };
}
