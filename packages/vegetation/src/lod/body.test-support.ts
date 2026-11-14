// Test helpers for the rule that a plant is one body: the triangles one level draws, sampled into
// cells, and a fill from the trunk's foot through the cells that touch. A piece hangs free when a
// gap wider than about one cell stands between it and everything that leads to the foot. The fill
// reads the level's own meshes, never the skeleton or a plan, so it sees what a camera would.
// Only the tests import this file.
import type { PlantAsset, PlantPart, SpeciesKitData } from '../asset';
import { dequantisePosition } from './quantise';

/** What a fill of one level found. */
export interface BodyFill {
	/** The cells that hold wood. */
	readonly woodCells: number;
	/** The wood cells the fill from the foot did not reach. */
	readonly freeWood: number;
	/** The triangles of the level's parts that are not wood and that the fill was asked to read. */
	readonly leafTriangles: number;
	/** Those triangles with no cell the fill reached: a card or a leaf hanging free. */
	readonly freeLeaves: number;
	/** The shoot rows whose base stands farther than a cell from the wood the fill reached. */
	readonly freeRows: number;
}

/** A cell's key from its three indices, each within a span that holds any plant. */
const SPAN = 8192;
const keyOf = (x: number, y: number, z: number) =>
	((x + SPAN / 2) * SPAN + (y + SPAN / 2)) * SPAN + (z + SPAN / 2);

/**
 * Fills one level of a grown variant from its trunk's foot and counts what hangs free.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param level The level.
 * @param cell The cell's side in metres: the gap a piece may stand off by and still count as joined.
 * @param rows Whether the shoot rows' bases are checked against the wood, as at the nearest level.
 * @param names The parts read beside the wood: the cards and a merged plant's foliage by default.
 *   Extras hang from the shoots' own tips, which a card level does not draw, so they are left out.
 * @param leafReach The distance in metres from a card's point to a joined point within which the
 *   card joins, as the card level's own join allows. A card farther from all joined points hangs
 *   free. The wood always joins by touching cells alone.
 * @returns The counts.
 */
export function bodyFill(
	kit: SpeciesKitData,
	asset: PlantAsset,
	level: 0 | 1 | 2,
	cell: number,
	rows = false,
	names: readonly PlantPart['name'][] = ['cards', 'foliage'],
	leafReach = cell,
): BodyFill {
	const wood = new Set<number>();
	const leaves = new Set<number>();
	/** One point of each cell, which the card reach reads. */
	const points = new Map<number, [number, number, number]>();
	/** Each leaf triangle's cells. */
	const triangles: number[][] = [];
	const at = (p: ArrayLike<number>, i: number) =>
		keyOf(
			Math.floor((p[i] as number) / cell),
			Math.floor((p[i + 1] as number) / cell),
			Math.floor((p[i + 2] as number) / cell),
		);
	const point: [number, number, number] = [0, 0, 0];
	const sample = (part: PlantPart): void => {
		const arrays = part.arrays;
		const count = arrays.positions.length / 3;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			dequantisePosition(arrays.positions, i, kit.box, point);
			positions.set(point, i * 3);
		}
		const isWood = part.name === 'wood';
		const indices = arrays.indices;
		for (let t = 0; t < indices.length; t += 3) {
			const a = (indices[t] as number) * 3;
			const b = (indices[t + 1] as number) * 3;
			const c = (indices[t + 2] as number) * 3;
			// Points across the triangle no farther apart than half a cell, so no cell it crosses is
			// missed. A stalk is a line of two coincident edges, which the same points cover.
			let longest = 0;
			for (const [u, v] of [
				[a, b],
				[b, c],
				[c, a],
			] as const)
				longest = Math.max(
					longest,
					Math.hypot(
						(positions[u] as number) - (positions[v] as number),
						(positions[u + 1] as number) - (positions[v + 1] as number),
						(positions[u + 2] as number) - (positions[v + 2] as number),
					),
				);
			const steps = Math.max(1, Math.ceil(longest / (cell / 2)));
			const cells = isWood ? undefined : new Set<number>();
			for (let i = 0; i <= steps; i++)
				for (let j = 0; j <= steps - i; j++) {
					const wa = i / steps;
					const wb = j / steps;
					const wc = 1 - wa - wb;
					for (let k = 0; k < 3; k++)
						point[k] =
							wa * (positions[a + k] as number) +
							wb * (positions[b + k] as number) +
							wc * (positions[c + k] as number);
					const key = at(point, 0);
					if (!points.has(key))
						points.set(key, [point[0] as number, point[1] as number, point[2] as number]);
					if (isWood) wood.add(key);
					else {
						leaves.add(key);
						cells?.add(key);
					}
				}
			if (cells) triangles.push([...cells]);
		}
	};
	for (const part of asset.levels[level].parts)
		if (part.name === 'wood' || names.includes(part.name)) sample(part);
	// The foot: the lowest wood cells. The fill spreads through every cell that touches, corners
	// included.
	const reached = new Set<number>();
	const queue: number[] = [];
	let lowest = Number.POSITIVE_INFINITY;
	const heightOf = (key: number) => Math.floor(key / SPAN) % SPAN;
	for (const key of wood) lowest = Math.min(lowest, heightOf(key));
	for (const key of wood)
		if (heightOf(key) <= lowest + 1) {
			reached.add(key);
			queue.push(key);
		}
	const offsets: number[] = [];
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (let dz = -1; dz <= 1; dz++)
				if (dx !== 0 || dy !== 0 || dz !== 0) offsets.push((dx * SPAN + dy) * SPAN + dz);
	while (queue.length > 0) {
		const key = queue.pop() as number;
		for (const offset of offsets) {
			const next = key + offset;
			if (reached.has(next) || !(wood.has(next) || leaves.has(next))) continue;
			reached.add(next);
			queue.push(next);
		}
	}
	// A card joins where one of its points stands within the card level's own reach of a joined
	// point, or of another card that joined. A pass joins every card that reaches a joined point,
	// and the passes repeat until none joins, so a chain of cards joins too.
	if (leafReach > cell) {
		const square = leafReach * leafReach;
		const cells = new Map<string, number[]>();
		const cellOf = (p: ArrayLike<number>) =>
			`${Math.floor((p[0] as number) / leafReach)},${Math.floor((p[1] as number) / leafReach)},${Math.floor((p[2] as number) / leafReach)}`;
		const mark = (key: number): void => {
			reached.add(key);
			const bucket = cellOf(points.get(key) as [number, number, number]);
			const list = cells.get(bucket);
			if (list) list.push(key);
			else cells.set(bucket, [key]);
		};
		for (const key of reached) mark(key);
		let moved = true;
		while (moved) {
			moved = false;
			for (const key of leaves) {
				if (reached.has(key)) continue;
				const p = points.get(key) as [number, number, number];
				const bx = Math.floor((p[0] as number) / leafReach);
				const by = Math.floor((p[1] as number) / leafReach);
				const bz = Math.floor((p[2] as number) / leafReach);
				let joined = false;
				for (let dx = -1; dx <= 1 && !joined; dx++)
					for (let dy = -1; dy <= 1 && !joined; dy++)
						for (let dz = -1; dz <= 1 && !joined; dz++)
							for (const other of cells.get(`${bx + dx},${by + dy},${bz + dz}`) ?? []) {
								const q = points.get(other) as [number, number, number];
								const ex = (q[0] as number) - (p[0] as number);
								const ey = (q[1] as number) - (p[1] as number);
								const ez = (q[2] as number) - (p[2] as number);
								if (ex * ex + ey * ey + ez * ez <= square) {
									joined = true;
									break;
								}
							}
				if (joined) {
					mark(key);
					moved = true;
				}
			}
		}
	}
	let freeWood = 0;
	for (const key of wood) if (!reached.has(key)) freeWood++;
	let freeLeaves = 0;
	for (const cells of triangles) if (!cells.some((key) => reached.has(key))) freeLeaves++;
	let freeRows = 0;
	if (rows) {
		const shoots = asset.shoots;
		for (let r = 0; r < shoots.count; r++) {
			const key = at(shoots.position, r * 3);
			if (wood.has(key) && reached.has(key)) continue;
			if (!offsets.some((offset) => wood.has(key + offset) && reached.has(key + offset)))
				freeRows++;
		}
	}
	return {
		woodCells: wood.size,
		freeWood,
		leafTriangles: triangles.length,
		freeLeaves,
		freeRows,
	};
}
