import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bumpyGrid, type LevelArrays, planningWords } from '../../../../tests/lib/level-meshes.ts';
import { nodeLevels } from '../../../../tests/lib/level-plans.ts';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import {
	installedMeshoptWasm,
	MESHOPT_MODULES,
	MESHOPT_VENDOR,
} from '../../../../tools/lib/meshopt-wasm.ts';
import {
	GROUP_LIST_MIN_TRIANGLES,
	GROUP_TRIANGLES,
	PIECE_LIST_MIN_TRIANGLES,
} from '../../levels/pieces.js';
import { groupsSplit, type PiecesData } from './gltf-parse';
import { CLUSTERIZER_MODULE, ENCODER_MODULE, SIMPLIFIER_MODULE } from './level-words';
import { type LevelsTaskOutput, run } from './levels-task';

/**
 * Separate quads of `size` meters in a `count` x `count` grid, each with vertices of its own, as a
 * kit builds a wall or a tree its leaf cards. `gap` 0 lays them edge to edge as a wall's panels.
 */
function quads(count: number, size: number, gap: number): LevelArrays {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let y = 0; y < count; y++)
		for (let x = 0; x < count; x++) {
			const [left, bottom] = [x * (size + gap), y * (size + gap)];
			const first = positions.length / 3;
			for (const [u, v] of [
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 1],
			] as const) {
				positions.push(left + u * size, bottom + v * size, 0);
				normals.push(0, 0, 1);
				uvs.push(u, v);
			}
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		indices: new Uint32Array(indices),
	};
}

/** The vendored modules that the engine's task runs, compiled as the loader compiles them. */
function vendoredModules(): (name: string) => WebAssembly.Module {
	const modules = new Map([
		[
			SIMPLIFIER_MODULE,
			new WebAssembly.Module(readFileSync(join(MESHOPT_VENDOR, 'meshopt_simplifier.wasm'))),
		],
		[
			ENCODER_MODULE,
			new WebAssembly.Module(readFileSync(join(MESHOPT_VENDOR, 'meshopt_encoder.wasm'))),
		],
		[
			CLUSTERIZER_MODULE,
			new WebAssembly.Module(readFileSync(join(MESHOPT_VENDOR, 'meshopt_clusterizer.wasm'))),
		],
	]);
	return (name) => modules.get(name) as WebAssembly.Module;
}

/** The levels that the engine's task gives for the same mesh. */
async function taskLevels(
	arrays: LevelArrays,
	cards: boolean,
	maxLevels: number,
	skipFlat = false,
) {
	const result = await run(
		{ words: planningWords(arrays), cards, maxLevels, skipFlat, parts: 1, basePieces: true },
		vendoredModules(),
	);
	return result.output as LevelsTaskOutput;
}

describe("meshoptimizer's modules that the level planner runs", () => {
	test('are the modules of the meshoptimizer package that the engine pins', () => {
		for (const { file } of MESHOPT_MODULES)
			expect(
				Buffer.from(installedMeshoptWasm(file)).equals(readFileSync(join(MESHOPT_VENDOR, file))),
			).toBe(true);
	});
});

describe('the level planner on a job worker', () => {
	const meshes: [string, LevelArrays, boolean][] = [
		['a bumpy grid with texture coordinates', bumpyGrid(48), false],
		['separate cards', quads(12, 0.1, 0.05), true],
		['the panels of a wall', quads(24, 0.5, 0), false],
	];
	for (const [name, arrays, cards] of meshes)
		test(`gives the levels that the asset tool's planner gives: ${name}`, async () => {
			const expected = await nodeLevels(arrays, cards, 7);
			const { levels } = await taskLevels(arrays, cards, 7);
			expect(levels.length).toBe(expected.length);
			levels.forEach((level, k) => {
				const want = expected[k];
				expect(Array.from(level.indices)).toEqual(Array.from(want?.indices[0] ?? []));
				expect(level.error).toBe(want?.error as number);
				expect(level.positions ? Array.from(level.positions) : undefined).toEqual(
					want?.positions[0] ? Array.from(want.positions[0]) : undefined,
				);
			});
		});

	test('halves a bumpy grid of 4,608 triangles until its locked border holds it', async () => {
		const { levels } = await taskLevels(bumpyGrid(48), false, 7);
		const triangles = levels.map((level) => level.indices.length / 3);
		expect(levels.length).toBeGreaterThanOrEqual(4);
		expect(triangles[0]).toBeLessThanOrEqual(4608 * 0.75);
		// The grid's open border of 192 edges stays, as it does in the asset tool, so the last
		// level keeps about one triangle for each border edge.
		expect(triangles.at(-1)).toBeLessThan(4608 / 16);
		for (let k = 1; k < levels.length; k++)
			expect((levels[k] as { error: number }).error).toBeGreaterThan(
				(levels[k - 1] as { error: number }).error,
			);
	});

	test('names only the mesh’s own vertices, so the base keeps its order', async () => {
		const grid = bumpyGrid(32);
		const { levels } = await taskLevels(grid, false, 7);
		const vertices = grid.positions.length / 3;
		for (const level of levels)
			for (const index of level.indices) expect(index).toBeLessThan(vertices);
	});

	test('keeps every panel of a wall of separate quads unless it asks for cards', async () => {
		const wall = quads(24, 0.5, 0);
		const { levels } = await taskLevels(wall, false, 7);
		// No level thins the quads as cards: each level that it makes keeps whole panels' worth of
		// surface, so a wall gets no holes from the card step.
		for (const level of levels) expect(level.positions).toBeUndefined();
		const cards = await taskLevels(wall, true, 7);
		expect(cards.levels.length).toBeGreaterThan(0);
		expect(cards.levels[0]?.positions).toBeDefined();
	});

	test('plans nothing for a flat mesh when the automatic default asks', async () => {
		const flat = bumpyGrid(48);
		for (let v = 0; v < flat.positions.length / 3; v++) flat.positions[v * 3 + 1] = 0;
		expect((await taskLevels(flat, false, 7, true)).levels).toEqual([]);
		expect((await taskLevels(flat, false, 7, false)).levels.length).toBeGreaterThan(0);
	});

	test(
		'gives a large mesh and each large level pieces and groups over the same triangles',
		async () => {
			const grid = bumpyGrid(200);
			const output = await taskLevels(grid, false, 7);
			const expected = await nodeLevels(grid, false, 7);
			// Each triangle from its least corner, which keeps the turn of its corners: a group's
			// own order may start a triangle at another corner.
			const keys = (indices: Uint32Array) => {
				const out: string[] = [];
				for (let t = 0; t < indices.length; t += 3) {
					const corners = [indices[t], indices[t + 1], indices[t + 2]] as number[];
					const least = corners.indexOf(Math.min(...corners));
					out.push([0, 1, 2].map((k) => corners[(least + k) % 3]).join(','));
				}
				return out.sort();
			};
			// The groups of a large list split its pieces, each of up to the most triangles, with
			// two vectors of bounds each.
			const expectGroups = (pieces: PiecesData, triangles: number) => {
				const grouped = triangles >= GROUP_LIST_MIN_TRIANGLES;
				expect(pieces.groups !== undefined).toBe(grouped);
				if (!pieces.groups) return;
				expect(groupsSplit(pieces.groups, pieces.triangles)).toBe(true);
				expect(Math.max(...pieces.groups)).toBeLessThanOrEqual(GROUP_TRIANGLES);
				expect(pieces.groupBounds?.length).toBe(pieces.groups.length * 8);
			};
			const total = (counts: Uint32Array) => counts.reduce((sum, count) => sum + count, 0);
			expect(output.pieces).toBeDefined();
			const { pieces } = output as Required<LevelsTaskOutput>;
			expect(total(pieces.triangles)).toBe(grid.indices.length / 3);
			expect(keys(pieces.indices)).toEqual(keys(grid.indices));
			expectGroups(pieces, grid.indices.length / 3);
			output.levels.forEach((level, k) => {
				const want = expected[k]?.indices[0] as Uint32Array;
				// A level keeps the planner's triangles, in the order of its pieces where it has them.
				expect(keys(level.indices)).toEqual(keys(want));
				const large = level.indices.length / 3 >= PIECE_LIST_MIN_TRIANGLES;
				expect(level.pieces !== undefined).toBe(large);
				if (level.pieces) {
					expect(total(level.pieces.triangles)).toBe(level.indices.length / 3);
					expectGroups(level.pieces, level.indices.length / 3);
				} else expect(Array.from(level.indices)).toEqual(Array.from(want));
			});
			expect(output.levels[0]?.pieces).toBeDefined();
		},
		scaledBudget(60_000),
	);

	test('stops at the level cap it is given', async () => {
		expect((await taskLevels(bumpyGrid(48), false, 2)).levels.length).toBe(2);
	});
});
