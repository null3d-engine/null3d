// The run-time levels of a mesh made in code: when a mesh plans them, what it does with the plan's
// answer, and what ends or drops them. The scene notes each draw of a mesh with `drawnWith`, which
// these tests call as createMesh and createInstances do. A fake core records the calls, and a stand-in for the
// planner's start answers each plan with levels of its own, so the tests need no job worker; the
// planner itself is tested in levels-task.test.ts.
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { ARRAYS_PROBLEM_LEVEL_BASE } from '../generated/core';
import { VERTEX_ATTRIBUTES } from '../generated/gpu';
import type { CoreGlue } from '../shared/core';
import type { LevelsTaskInput, LevelsTaskOutput } from './levels-task';
import { CoreMemory } from './memory';
import {
	AUTOMATIC_COPY_TRIANGLES,
	AUTOMATIC_DRAWN_TRIANGLES,
	AUTOMATIC_LEVEL_TRIANGLES,
	Geometry,
	type Material,
	type MeshArrays,
	type MeshGeometry,
} from './resources';

/** The plans that reached the planner's start, and the answer that each one gets. */
const asked: LevelsTaskInput[] = [];
let answer: (input: LevelsTaskInput) => LevelsTaskOutput = () => ({ levels: [], side: 1, ms: 0 });

mock.module('./mesh-levels', () => ({
	planLevels: async (input: LevelsTaskInput) => {
		asked.push(input);
		return answer(input);
	},
}));

beforeEach(() => {
	setErrorFixes(ERROR_FIXES);
	asked.length = 0;
	answer = (input) => {
		const words = new Uint32Array(input.words);
		const triangles = (words[1] as number) / 3;
		// Three levels that halve the first triangles, with errors that grow.
		return {
			levels: [0.5, 0.25, 0.125].slice(0, input.maxLevels).map((share, k) => ({
				indices: new Uint32Array(Math.floor(triangles * share) * 3),
				error: 0.01 * 2 ** k,
			})),
			side: 1,
			ms: 0,
		};
	};
});

/** A geometry whose fake core makes meshes, levels and copies, and records what it is asked. */
function engine(options: { split?: boolean; format?: number; parts?: number } = {}) {
	const memory = new WebAssembly.Memory({ initial: 64 });
	const staging = 4096;
	const vertices = new Map<number, number>();
	const triangles = new Map<number, number>();
	const record = {
		levels: new Map<number, number[]>(),
		values: new Map<number, number[]>(),
		destroyed: [] as number[],
		copies: 0,
		shared: 0,
		split: 0,
		reads: [] as number[],
		updates: 0,
		/** The sets of levels that the scene took. */
		handOvers: 0,
		/** The flags word of each set of levels: fading bits low, measured bits high. */
		flags: [] as number[],
		/** The ids of the level meshes that the plan made, in the order that it made them. */
		made: [] as number[],
		/** The pieces that each mesh took: over a list of its own, its own list, or at its making. */
		pieceLists: [] as { mesh: number; count: number; indices: number }[],
		pieces: [] as { mesh: number; count: number }[],
		splitPieces: [] as number[],
	};
	let next = 1;
	let failed = 0;
	const glue = {
		meshArrays: () => staging,
		createMeshFromArrays: (count: number, indices: number) => {
			const id = next++;
			vertices.set(id, count);
			triangles.set(id, (indices || count) / 3);
			return id;
		},
		createLevelMesh: (base: number) => {
			if (options.split) {
				failed = 1206;
				return 0;
			}
			record.shared++;
			const id = next++;
			record.made.push(id);
			vertices.set(id, vertices.get(base) ?? 0);
			return id;
		},
		createSplitLevel: (base: number, count: number) => {
			record.split++;
			record.splitPieces.push(count);
			const id = next++;
			record.made.push(id);
			vertices.set(id, vertices.get(base) ?? 0);
			return id;
		},
		createLevelCopy: () => {
			record.copies++;
			const id = next++;
			record.made.push(id);
			vertices.set(id, 3);
			return id;
		},
		meshPlanningPart: (mesh: number, part: number) => {
			record.reads.push(part);
			// The mesh's part count, vertex count, index count and format, then a part of no
			// vertices and no triangles: the planner's stand-in reads only the counts.
			const words = new Uint32Array(memory.buffer, staging, 6);
			const parts = options.parts ?? 1;
			words.set([
				parts,
				vertices.get(mesh) ?? 0,
				(triangles.get(mesh) ?? 0) * 3,
				options.format ?? 0,
				0,
				0,
			]);
			return staging;
		},
		setMeshPieceList: (mesh: number, count: number, _groups: number, indices: number) => {
			record.pieceLists.push({ mesh, count, indices });
			return 1;
		},
		setMeshPieces: (mesh: number, count: number) => {
			record.pieces.push({ mesh, count });
			return 1;
		},
		setMeshLevels: (base: number, count: number, flags: number) => {
			record.handOvers++;
			record.flags.push(flags);
			record.levels.set(base, [...new Uint32Array(memory.buffer, staging, count)]);
			record.values.set(base, [...new Float32Array(memory.buffer, staging + 4 * count, count)]);
			return 0;
		},
		destroyMeshes: (count: number) => {
			record.destroyed.push(...new Uint32Array(memory.buffer, staging, count));
			return 0;
		},
		updateVertices: () => {
			record.updates++;
			return 0;
		},
		meshRadius: () => 1,
		meshCenter: () => 0,
		meshVertexCount: (mesh: number) => vertices.get(mesh) ?? 0,
		meshFormat: () => options.format ?? 0,
		lastErrorCode: () => failed,
		lastErrorDetail: () => (failed ? ARRAYS_PROBLEM_LEVEL_BASE : 0),
	} as unknown as CoreGlue;
	const geometry = new Geometry(new CoreMemory(glue, memory));
	return { geometry, record };
}

/** The arrays of a strip of `triangles` triangles, with indices. */
function strip(triangles: number, extra: Partial<MeshArrays> = {}): MeshArrays {
	const vertices = triangles + 2;
	const positions = new Float32Array(vertices * 3);
	for (let v = 0; v < vertices; v++) positions.set([v >> 1, v & 1, 0], v * 3);
	const indices = new Uint32Array(triangles * 3);
	for (let t = 0; t < triangles; t++) indices.set([t, t + 1, t + 2], t * 3);
	return { positions, computeNormals: true, indices, ...extra };
}

/** The microtasks and the planner's answer settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stand-in for a material, of which the levels read whether it moves vertices and whether it
 * draws the base level alone, as a blended one does.
 */
const material = (shapesVertices: boolean, wholeOnly = false) =>
	({ shapesVertices, wholeOnly }) as unknown as Material;

/** Notes that the scene draws `copies` of `mesh` with a plain material, as createMesh does. */
const draw = (mesh: MeshGeometry, copies = 1) => mesh.drawnWith(material(false), copies, 'test');

describe('the automatic levels of a mesh made in code', () => {
	test(`plan when a mesh of ${AUTOMATIC_LEVEL_TRIANGLES} triangles first draws, and switch at once`, async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(AUTOMATIC_LEVEL_TRIANGLES));
		await settled();
		// A mesh that no object draws plans nothing.
		expect(asked).toHaveLength(0);
		draw(mesh);
		const levels = await mesh.buildLevels();
		expect(asked).toHaveLength(1);
		expect(asked[0]?.skipFlat).toBe(true);
		expect(asked[0]?.cards).toBe(false);
		expect(levels).toHaveLength(3);
		expect(levels.every((level) => level.fade === false && level.error !== undefined)).toBe(true);
		expect(record.levels.get(mesh.id)).toEqual(levels.map((level) => level.mesh.id));
		expect(record.shared).toBe(3);
		// More copies start no second plan.
		draw(mesh, 100);
		await settled();
		expect(asked).toHaveLength(1);
	});

	test('plan nothing for a smaller mesh drawn a few times, unless its arrays ask', async () => {
		const { geometry } = engine();
		const small = geometry.fromArrays(strip(AUTOMATIC_LEVEL_TRIANGLES - 1));
		draw(small, 10);
		await settled();
		expect(asked).toHaveLength(0);
		expect(small.levels).toEqual([]);
		const asking = geometry.fromArrays(strip(500, { levels: true }));
		expect(await asking.buildLevels()).toHaveLength(3);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.skipFlat).toBe(false);
	});

	test(`plan for a smaller mesh once its copies hold ${AUTOMATIC_DRAWN_TRIANGLES} triangles`, async () => {
		const { geometry } = engine();
		const pebble = geometry.fromArrays(strip(960));
		draw(pebble, 60);
		await settled();
		expect(asked).toHaveLength(0);
		draw(pebble, Math.ceil(AUTOMATIC_DRAWN_TRIANGLES / 960) - 60);
		expect(await pebble.buildLevels()).toHaveLength(3);
		expect(asked).toHaveLength(1);
		// A mesh under the least triangles for copies plans nothing, however many copies draw.
		const rock = geometry.fromArrays(strip(AUTOMATIC_COPY_TRIANGLES - 1));
		draw(rock, 100_000);
		await settled();
		expect(asked).toHaveLength(1);
	});

	test('plan nothing for arrays that say levels: false', async () => {
		const { geometry } = engine();
		const mesh = geometry.fromArrays(strip(20_000, { levels: false }));
		draw(mesh);
		await settled();
		expect(asked).toHaveLength(0);
		expect(mesh.levels).toEqual([]);
	});

	test('pass the cards option to the planner', async () => {
		const { geometry } = engine();
		const mesh = geometry.fromArrays(strip(100, { levels: { cards: true } }));
		await mesh.buildLevels({ cards: true });
		expect(asked).toHaveLength(1);
		expect(asked[0]?.cards).toBe(true);
	});

	test('give way to levels set by hand before the mesh draws, with no plan run', async () => {
		const { geometry } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		const far = geometry.fromArrays(strip(10, { levels: false }));
		mesh.setLevels([{ mesh: far, distance: 50 }]);
		draw(mesh);
		await settled();
		expect(asked).toHaveLength(0);
		expect(mesh.levels.map((level) => level.mesh)).toEqual([far]);
	});

	test('give way to levels set by hand while the plan runs', async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		draw(mesh);
		const plan = mesh.buildLevels();
		await Promise.resolve();
		const far = geometry.fromArrays(strip(10, { levels: false }));
		mesh.setLevels([{ mesh: far, distance: 50 }]);
		expect((await plan).map((level) => level.mesh)).toEqual([far]);
		expect(record.shared).toBe(0);
	});

	test('take the planned levels away at the first vertex update, and plan again when asked', async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		draw(mesh);
		const planned = await mesh.buildLevels();
		const ids = planned.map((level) => level.mesh.id);
		mesh.updateVertices('positions', new Float32Array(20_002 * 3));
		expect(mesh.levels).toEqual([]);
		expect(record.levels.get(mesh.id)).toEqual([]);
		expect(record.destroyed).toEqual(ids);
		// A later update finds nothing to drop and calls the core once; later draws plan nothing.
		mesh.updateVertices('positions', new Float32Array(20_002 * 3));
		expect(record.updates).toBe(2);
		draw(mesh);
		await settled();
		expect(asked).toHaveLength(1);
		expect(await mesh.buildLevels()).toHaveLength(3);
	});

	test('mark planned levels as measured so a raised threshold fades their switch', async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		draw(mesh);
		const planned = await mesh.buildLevels();
		// The plan takes no fade bit and marks every lower level as a measured error, in the high
		// half of the flags word, so the engine fades the level once the threshold shows it.
		expect(record.flags.at(-1)).toBe(((1 << (planned.length + 1)) - 2) << 16);
		// A level set by hand names no measured bit.
		const level = planned[0];
		if (!level) throw new Error('the plan made no level');
		mesh.setLevels([{ mesh: level.mesh, distance: 50 }]);
		expect(record.flags.at(-1)).toBe(0b10);
	});

	test('drop the automatic levels of a mesh that a material draws with moved vertices', async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		draw(mesh);
		await mesh.buildLevels();
		mesh.drawnWith(material(true), 1, 'test');
		expect(mesh.levels).toEqual([]);
		expect(record.destroyed).toHaveLength(3);
	});

	test('never plan for a mesh that a material with moved vertices draws first', async () => {
		const { geometry } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		mesh.drawnWith(material(true), 1, 'test');
		draw(mesh);
		await settled();
		expect(asked).toHaveLength(0);
		expect(mesh.levels).toEqual([]);
	});

	test('plan nothing for a mesh that only blended materials draw, until another draws it', async () => {
		const { geometry } = engine();
		const glass = geometry.fromArrays(strip(20_000));
		glass.drawnWith(material(false, true), 1, 'test');
		const pebble = geometry.fromArrays(strip(960));
		pebble.drawnWith(material(false, true), 1_000, 'test');
		await settled();
		expect(asked).toHaveLength(0);
		draw(glass);
		expect(await glass.buildLevels()).toHaveLength(3);
		// The blended copies of the small mesh never counted toward its copies.
		draw(pebble, 10);
		await settled();
		expect(asked).toHaveLength(1);
	});

	test('share the vertices of a mesh that the engine split into parts, part by part', async () => {
		const { geometry, record } = engine({ split: true });
		const mesh = geometry.fromArrays(strip(70_000));
		expect(await mesh.buildLevels()).toHaveLength(3);
		expect(record.split).toBe(3);
		expect(record.copies).toBe(0);
		expect(record.shared).toBe(0);
	});

	test('give a large mesh its pieces after its levels, and each large level its own', async () => {
		answer = (input) => {
			const triangles = new Uint32Array(input.words)[1] as number;
			const pieces = (count: number) => ({
				triangles: new Uint32Array(count).fill(1),
				bounds: new Float32Array(count * 8),
			});
			return {
				levels: [
					{ indices: new Uint32Array(triangles / 2), error: 0.01, pieces: pieces(8) },
					{ indices: new Uint32Array(triangles / 4), error: 0.02 },
				],
				pieces: { ...pieces(12), indices: new Uint32Array(triangles) },
				side: 1,
				ms: 0,
			};
		};
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(70_000));
		expect(await mesh.buildLevels()).toHaveLength(2);
		const [finest] = mesh.levels;
		expect(record.pieces).toEqual([{ mesh: finest?.mesh.id as number, count: 8 }]);
		expect(record.pieceLists).toEqual([{ mesh: mesh.id, count: 12, indices: 210_000 }]);
		// A plan for the mesh's new shape gives it pieces again, in place of the old ones.
		mesh.updateVertices('positions', new Float32Array(70_002 * 3));
		await mesh.buildLevels();
		expect(record.pieceLists).toHaveLength(2);
		expect(record.pieces).toHaveLength(2);
		// A split mesh's levels take their pieces as they are made, and keep their order.
		const split = engine({ split: true });
		const parts = split.geometry.fromArrays(strip(70_000));
		await parts.buildLevels();
		expect(split.record.splitPieces).toEqual([0, 8]);
		expect(split.record.pieceLists).toHaveLength(1);
		// A mesh that many copies draw asks for its levels' pieces alone, since its own would
		// cost a copy of its indices for the few copies near the camera.
		expect(asked.map((input) => input.basePieces)).toEqual([true, true, true]);
		const rocks = geometry.fromArrays(strip(70_000));
		draw(rocks, 400);
		await settled();
		expect(asked.at(-1)?.basePieces).toBe(false);
	});

	test('sort a mesh that asks for pieces alone at its first draw that takes them, by space', async () => {
		const { geometry } = engine();
		const cell = geometry.fromArrays(strip(40_000, { levels: 'pieces' }));
		const small = geometry.fromArrays(strip(20_000, { levels: 'pieces' }));
		// A blended material draws the mesh whole and sorted, so it plans nothing yet.
		cell.drawnWith(material(false, true), 1, 'test');
		draw(small);
		await settled();
		expect(asked).toHaveLength(0);
		draw(cell);
		draw(cell);
		await settled();
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ maxLevels: 0, spacePieces: true, basePieces: true });
		expect(cell.levels).toHaveLength(0);
	});

	test('make the levels one a frame and give the scene the whole set once', async () => {
		const { geometry, record } = engine();
		const pace = { frame: 1, held: false };
		geometry.users = { userOf: () => undefined, pace };
		const mesh = geometry.fromArrays(strip(20_000));
		const plan = mesh.buildLevels();
		// The next frame reads the mesh, then the plan answers and makes the coarsest level.
		pace.frame++;
		for (let k = 0; k < 20 && record.shared === 0; k++) await settled();
		expect(record.shared).toBe(1);
		// The scene takes no level until the plan ends, so its draw tables rebuild once.
		expect(mesh.levels).toHaveLength(0);
		expect(record.handOvers).toBe(0);
		// Each next frame makes the next level, and the scene keeps the set that it has.
		pace.frame++;
		for (let k = 0; k < 20 && record.shared === 1; k++) await settled();
		expect(record.shared).toBe(2);
		expect(mesh.levels).toHaveLength(0);
		expect(record.handOvers).toBe(0);
		pace.frame++;
		const levels = await plan;
		expect(levels).toHaveLength(3);
		expect(record.handOvers).toBe(1);
		expect(record.levels.get(mesh.id)).toEqual(levels.map((level) => level.mesh.id));
		// A held frame waits for the plan, which hands over every level at once.
		pace.held = true;
		const held = geometry.fromArrays(strip(20_000));
		expect(await held.buildLevels()).toHaveLength(3);
	});

	test('read a mesh of many parts from the core one part a frame before it plans', async () => {
		const { geometry, record } = engine({ parts: 3 });
		const pace = { frame: 1, held: false };
		geometry.users = { userOf: () => undefined, pace };
		const mesh = geometry.fromArrays(strip(20_000));
		const plan = mesh.buildLevels();
		// Not even the frame that asks for the plan reads the mesh.
		expect(record.reads).toEqual([]);
		await settled();
		expect(record.reads).toEqual([]);
		pace.frame++;
		for (let k = 0; k < 20 && record.reads.length < 1; k++) await settled();
		expect(record.reads).toEqual([0]);
		expect(asked).toHaveLength(0);
		pace.frame++;
		for (let k = 0; k < 20 && record.reads.length < 2; k++) await settled();
		expect(record.reads).toEqual([0, 1]);
		pace.frame++;
		for (let k = 0; k < 20 && asked.length === 0; k++) await settled();
		expect(record.reads).toEqual([0, 1, 2]);
		expect(asked).toHaveLength(1);
		pace.frame += 3;
		const timer = setInterval(() => pace.frame++, 1);
		expect(await plan).toHaveLength(3);
		clearInterval(timer);
	});

	test('free the levels made so far when levels set by hand end the plan', async () => {
		const { geometry, record } = engine();
		const pace = { frame: 1, held: false };
		geometry.users = { userOf: () => undefined, pace };
		const mesh = geometry.fromArrays(strip(20_000));
		const plan = mesh.buildLevels();
		pace.frame++;
		for (let k = 0; k < 20 && record.made.length === 0; k++) await settled();
		expect(record.made).toHaveLength(1);
		const first = record.made[0] as number;
		const far = geometry.fromArrays(strip(10, { levels: false }));
		mesh.setLevels([{ mesh: far, distance: 50 }]);
		pace.frame++;
		expect((await plan).map((level) => level.mesh)).toEqual([far]);
		expect(record.destroyed).toContain(first);
	});

	test('give a level that the simplifier found exact an error above 0, and keep errors growing', async () => {
		const { geometry, record } = engine();
		answer = () => ({
			levels: [0, 0, 0.5].map((error) => ({ indices: new Uint32Array(3), error })),
			side: 2,
			ms: 0,
		});
		const mesh = geometry.fromArrays(strip(20_000));
		const levels = await mesh.buildLevels();
		const errors = levels.map((level) => level.error as number);
		expect(errors[0]).toBeGreaterThan(0);
		expect(errors[1]).toBeGreaterThan(errors[0] as number);
		expect(errors[2]).toBe(0.5);
		expect(record.values.get(mesh.id)?.every((value) => value > 0)).toBe(true);
	});

	test('free the planned levels when the mesh goes', async () => {
		const { geometry, record } = engine();
		const mesh = geometry.fromArrays(strip(20_000));
		const levels = await mesh.buildLevels();
		const ids = [mesh, ...levels.map((level) => level.mesh)].map((m: MeshGeometry) => m.id);
		mesh.destroy();
		expect(record.destroyed).toEqual(ids);
		expect(levels.every((level) => !level.mesh.live)).toBe(true);
	});
});

describe('the facing pieces of a smaller mesh that many copies draw', () => {
	/** Pieces of `counts` triangles each, as a file holds them. */
	const filePieces = (...counts: number[]) => ({
		triangles: Uint32Array.from(counts),
		bounds: new Float32Array(counts.length * 8),
	});
	/** A mesh of `triangles` triangles whose far level is set by hand, as a file's or a kit's. */
	const withFarLevel = (geometry: Geometry, triangles: number, levels = true) => {
		const mesh = geometry.fromArrays(strip(triangles, levels ? {} : { levels: false }));
		const far = geometry.fromArrays(strip(10, { levels: false }));
		mesh.setLevels([{ mesh: far, distance: 50 }]);
		return mesh;
	};

	test('plan for a mesh with levels set by hand once its copies pay, with no levels', async () => {
		const { geometry } = engine();
		const walls = withFarLevel(geometry, 2000);
		// 10 copies of 2,000 triangles hold too few together.
		draw(walls, 10);
		await settled();
		expect(asked).toHaveLength(0);
		draw(walls, 30);
		await settled();
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			maxLevels: 0,
			spacePieces: false,
			basePieces: true,
			copies: 40,
		});
		// The mesh plans its pieces once.
		draw(walls, 100);
		await settled();
		expect(asked).toHaveLength(1);
		// `levels: false` and a material that draws both faces plan none.
		draw(withFarLevel(geometry, 2000, false), 100);
		const both = { shapesVertices: false, wholeOnly: false, facesBoth: true } as Material;
		withFarLevel(geometry, 2000).drawnWith(both, 100, 'test');
		await settled();
		expect(asked).toHaveLength(1);
	});

	test("hold a file's pieces of a smaller list until its copies pay, and give a large list's at once", async () => {
		const { geometry, record } = engine();
		const house = geometry.fromArrays(strip(2000, { levels: false }));
		house.fromFileWith(filePieces(1000, 1000), 'test');
		const finer = geometry.fromArrays(strip(1500, { levels: false }));
		finer.fromFileWith(filePieces(800, 700), 'test');
		house.setLevels([{ mesh: finer, distance: 50 }]);
		expect(record.pieces).toEqual([]);
		// 10 copies pay for neither list; 40 pay for the house's 2,000 triangles, and 50 for the
		// level's 1,500.
		draw(house, 10);
		expect(record.pieces).toEqual([]);
		draw(house, 30);
		expect(record.pieces).toEqual([{ mesh: house.id, count: 2 }]);
		draw(house, 10);
		expect(record.pieces).toEqual([
			{ mesh: house.id, count: 2 },
			{ mesh: finer.id, count: 2 },
		]);
		// The file holds the pieces, so no plan runs.
		await settled();
		expect(asked).toHaveLength(0);
		const large = geometry.fromArrays(strip(40_000, { levels: false }));
		large.fromFileWith(filePieces(20_000, 20_000), 'test');
		expect(record.pieces.at(-1)).toEqual({ mesh: large.id, count: 2 });
	});

	test("give a file's held pieces to a mesh whose material draws both faces", async () => {
		const { geometry, record } = engine();
		const rock = geometry.fromArrays(strip(2000, { levels: false }));
		rock.fromFileWith(filePieces(1000, 1000), 'test');
		const both = { shapesVertices: false, wholeOnly: false, facesBoth: true } as Material;
		rock.drawnWith(both, 40, 'test');
		await settled();
		// The copies pay for the list, whose pieces cull the view's frustum alone; a material that
		// draws both faces plans no facing pieces, which its cones would never drop.
		expect(record.pieces).toEqual([{ mesh: rock.id, count: 2 }]);
		expect(asked).toHaveLength(0);
	});

	test("plan the pieces of a file's smaller list that holds none once its copies pay", async () => {
		const { geometry } = engine();
		const pebble = geometry.fromArrays(strip(2000, { levels: false }));
		pebble.fromFileWith(undefined, 'test');
		draw(pebble, 40);
		await settled();
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ maxLevels: 0, spacePieces: false, copies: 40 });
	});
});

describe('meshes whose shape poses or moves', () => {
	const joints = VERTEX_ATTRIBUTES[6]?.[0] ?? 0;
	test('plan no automatic levels, and refuse a plan with E1221', async () => {
		const { geometry } = engine({ format: joints });
		const mesh = geometry.fromArrays(strip(20_000));
		draw(mesh);
		await settled();
		expect(asked).toHaveLength(0);
		const failure = await mesh.buildLevels().catch((error: EngineError) => error);
		expect((failure as EngineError).code).toBe('E1221');
	});
});
