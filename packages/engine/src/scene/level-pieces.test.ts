import { describe, expect, test } from 'bun:test';
import { bumpyGrid } from '../../../../tests/lib/level-meshes.ts';
import { PIECE_BOUNDS, PIECE_MAX } from '../../levels/pieces.js';
import { type ListPieces, planListPieces, triangleGroups } from './level-pieces';

/** Keeps the triangles' order: the vertex cache order changes no piece. */
const asGiven = (indices: Uint32Array) => indices;

/** The triangles of a list as sorted keys, to compare two lists' triangles whatever their order. */
function triangleKeys(indices: Uint32Array): string[] {
	const keys: string[] = [];
	for (let t = 0; t < indices.length; t += 3)
		keys.push(`${indices[t]},${indices[t + 1]},${indices[t + 2]}`);
	return keys.sort();
}

/**
 * The parts that hold each vertex when the triangles are cut, in order, into runs of at most
 * `limit` vertices, as the engine core splits a large mesh.
 */
function cutMasks(indices: Uint32Array, vertices: number, limit: number) {
	const masks = new Uint32Array(vertices);
	let part = 0;
	let used = new Set<number>();
	for (let t = 0; t < indices.length; t += 3) {
		const corners = [indices[t], indices[t + 1], indices[t + 2]] as number[];
		const fresh = corners.filter((v) => !used.has(v)).length;
		if (used.size + fresh > limit) {
			part++;
			used = new Set();
		}
		for (const v of corners) {
			used.add(v);
			masks[v] = (masks[v] as number) | (1 << part);
		}
	}
	return { masks, parts: part + 1 };
}

/** Checks that each piece's sphere holds every corner of its triangles. */
function expectSpheresHold(positions: Float32Array, pieces: ListPieces) {
	let first = 0;
	pieces.triangles.forEach((count, k) => {
		const [x, y, z, r] = pieces.bounds.subarray(k * PIECE_BOUNDS, k * PIECE_BOUNDS + 4);
		for (let i = first * 3; i < (first + count) * 3; i++) {
			const v = (pieces.indices[i] as number) * 3;
			const reach = Math.hypot(
				(positions[v] as number) - (x as number),
				(positions[v + 1] as number) - (y as number),
				(positions[v + 2] as number) - (z as number),
			);
			expect(reach).toBeLessThanOrEqual(r as number);
		}
		first += count;
	});
}

describe('the pieces of a mesh made in code', () => {
	test('sort a large list into pieces that hold each of its triangles once', () => {
		const grid = bumpyGrid(160);
		const pieces = planListPieces(grid.positions, grid.indices, undefined, asGiven);
		expect(pieces).toBeDefined();
		const { triangles, indices, bounds } = pieces as ListPieces;
		expect(triangles.length).toBeGreaterThanOrEqual(8);
		expect(triangles.length).toBeLessThanOrEqual(PIECE_MAX);
		expect(triangles.reduce((sum, count) => sum + count, 0)).toBe(grid.indices.length / 3);
		expect(bounds.length).toBe(triangles.length * PIECE_BOUNDS);
		expect(triangleKeys(indices)).toEqual(triangleKeys(grid.indices));
		expectSpheresHold(grid.positions, pieces as ListPieces);
	});

	test('split a list that faces one way by space, so each piece covers a patch of it', () => {
		const grid = bumpyGrid(160);
		const { bounds, triangles } = planListPieces(
			grid.positions,
			grid.indices,
			undefined,
			asGiven,
		) as ListPieces;
		// The grid is a meter across: patches of it are far smaller than the grid, while a group by
		// facing would spread over all of it.
		for (let k = 0; k < triangles.length; k++)
			expect(bounds[k * PIECE_BOUNDS + 3] as number).toBeLessThan(0.45);
	});

	test('give a list under the size that culls nothing no pieces', () => {
		const grid = bumpyGrid(100);
		expect(planListPieces(grid.positions, grid.indices, undefined, asGiven)).toBeUndefined();
	});

	test('keep the order in which the parts of a split mesh draw the list', () => {
		const grid = bumpyGrid(200);
		const split = cutMasks(grid.indices, grid.positions.length / 3, 12_000);
		expect(split.parts).toBeGreaterThan(2);
		const pieces = planListPieces(grid.positions, grid.indices, split, asGiven) as ListPieces;
		expect(pieces).toBeDefined();
		expect(pieces.triangles.length).toBeLessThanOrEqual(PIECE_MAX);
		expect(triangleKeys(pieces.indices)).toEqual(triangleKeys(grid.indices));
		const groups = triangleGroups(pieces.indices, split.masks, split.parts);
		for (let t = 1; t < groups.length; t++)
			expect(groups[t] as number).toBeGreaterThanOrEqual(groups[t - 1] as number);
		expectSpheresHold(grid.positions, pieces);
	});

	test('give each part a piece of its own when the parts outnumber the pieces', () => {
		const grid = bumpyGrid(200);
		const split = cutMasks(grid.indices, grid.positions.length / 3, 2_000);
		expect(split.parts).toBeGreaterThan(PIECE_MAX);
		const pieces = planListPieces(grid.positions, grid.indices, split, asGiven) as ListPieces;
		const groups = triangleGroups(pieces.indices, split.masks, split.parts);
		expect(pieces.triangles.length).toBe(new Set(groups).size);
		expect(triangleKeys(pieces.indices)).toEqual(triangleKeys(grid.indices));
		for (let t = 1; t < groups.length; t++)
			expect(groups[t] as number).toBeGreaterThanOrEqual(groups[t - 1] as number);
	});

	test('draw a triangle from the part where a corner first appears, once it holds all three', () => {
		const masks = Uint32Array.from([0b01, 0b11, 0b10, 0b11, 0b100]);
		const groups = triangleGroups(Uint32Array.from([0, 1, 3, 1, 3, 2, 0, 2, 4, 3, 1, 2]), masks, 3);
		// The first lies in part 0; the second's first corner appears first in part 0, which does
		// not hold its last, so it draws from part 1; no part holds all of the third; the fourth's
		// corners appear first in part 0, which lacks its last, then in part 1.
		expect(Array.from(groups)).toEqual([0, 1, 3, 1]);
	});
});
