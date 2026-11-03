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
			levels: [0.5, 0.25, 0.125].map((share, k) => ({
				indices: new Uint32Array(Math.floor(triangles * share) * 3),
				error: 0.01 * 2 ** k,
			})),
			side: 1,
			ms: 0,
		};
	};
});

/** A geometry whose fake core makes meshes, levels and copies, and records what it is asked. */
function engine(options: { split?: boolean; format?: number } = {}) {
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
		updates: 0,
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
			vertices.set(id, vertices.get(base) ?? 0);
			return id;
		},
		createLevelCopy: () => {
			record.copies++;
			const id = next++;
			vertices.set(id, 3);
			return id;
		},
		meshPlanningArrays: (mesh: number) => {
			const words = new Uint32Array(memory.buffer, staging, 3);
			words.set([vertices.get(mesh) ?? 0, (triangles.get(mesh) ?? 0) * 3, options.format ?? 0]);
			return staging;
		},
		setMeshLevels: (base: number, count: number) => {
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

/** A stand-in for a material, of which the levels read whether it moves vertices. */
const material = (shapesVertices: boolean) => ({ shapesVertices }) as unknown as Material;

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

	test('copy the vertices of each level of a mesh that the engine split into parts', async () => {
		const { geometry, record } = engine({ split: true });
		const mesh = geometry.fromArrays(strip(70_000));
		expect(await mesh.buildLevels()).toHaveLength(3);
		expect(record.copies).toBe(3);
		expect(record.shared).toBe(0);
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
