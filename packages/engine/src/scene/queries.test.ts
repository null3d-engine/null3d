import { beforeEach, describe, expect, test } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import type { OverlapHit, RaycastHit } from './queries';
import { Material, MeshGeometry } from './resources';
import { InstanceBatch, NO_ROW_VALUES, Scene } from './scene';
import type { SpriteBatch } from './sprites';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Object slots in the fake core. */
const CAPACITY = 7;
const RING = 16;
/** Where the fake core keeps each array in its memory, in bytes. */
const AT = {
	positions: 0,
	rotations: 128,
	scales: 256,
	radii: 384,
	centers: 448,
	dirty: 576,
	records: 1024,
	write: 1536,
	read: 1540,
	batch: 2048,
	input: 8192,
	rays: 8448,
	hits: 16384,
	movedHits: 32768,
};
/** The hit records that the fake core's hit array holds before it grows. */
const HIT_CAPACITY = 4;

/** A hit that the fake core writes: an object's slot or a batch's id and row, and the rest. */
interface Scripted {
	slot?: number;
	batch?: number;
	row?: number;
	distance?: number;
	triangle?: number;
	point?: number[];
	normal?: number[];
}

/**
 * A core with the scene's arrays, the command ring and the query arrays in a memory of its own.
 * Each query returns the hits that a test scripted, and records what it read.
 */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let next = 1;
	// The second batch takes the first one's slot, with the next generation.
	const batchIds = [1, 1 + (1 << C.HANDLE_SLOT_BITS)];
	let failure = { code: 0, details: [0, 0] };
	let failNext = 0;
	let hitsAt = AT.hits;
	let hitCapacity = HIT_CAPACITY;
	let rayCapacity = 0;
	let script: (Scripted | null)[] = [];
	const calls: { name: string; kind: number; layers: number; input: number[]; rays?: number[] }[] =
		[];
	const f64 = (at: number, length: number) => new Float64Array(memory.buffer, at, length);
	const fields: Record<number, number> = {
		[C.SCENE_FIELD_POSITIONS]: AT.positions,
		[C.SCENE_FIELD_ROTATIONS]: AT.rotations,
		[C.SCENE_FIELD_SCALES]: AT.scales,
		[C.SCENE_FIELD_LOCAL_RADII]: AT.radii,
		[C.SCENE_FIELD_LOCAL_CENTERS]: AT.centers,
		[C.SCENE_FIELD_DIRTY_WORDS]: AT.dirty,
	};
	const ring: Record<number, number> = {
		[C.RING_FIELD_RECORDS]: AT.records,
		[C.RING_FIELD_CAPACITY]: RING,
		[C.RING_FIELD_WRITE_INDEX]: AT.write,
		[C.RING_FIELD_READ_INDEX]: AT.read,
	};
	/** Writes the scripted hits as records, growing the hit array as the core does. */
	const write = (hits: (Scripted | null)[]) => {
		if (hits.length > hitCapacity) {
			hitsAt = AT.movedHits;
			hitCapacity = hits.length;
		}
		const records = f64(hitsAt, hitCapacity * C.QUERY_HIT_FLOATS);
		hits.forEach((hit, i) => {
			const r = records.subarray(i * C.QUERY_HIT_FLOATS, (i + 1) * C.QUERY_HIT_FLOATS);
			r.fill(0);
			r[C.QUERY_HIT_ROW] = -1;
			r[C.QUERY_HIT_TRIANGLE] = -1;
			r[C.QUERY_HIT_DISTANCE] = -1;
			if (!hit) return;
			r[C.QUERY_HIT_SLOT] = hit.slot ?? 0;
			r[C.QUERY_HIT_BATCH] = hit.batch ?? 0;
			r[C.QUERY_HIT_ROW] = hit.row ?? -1;
			r[C.QUERY_HIT_TRIANGLE] = hit.triangle ?? 0;
			r[C.QUERY_HIT_DISTANCE] = hit.distance ?? 0;
			r.set(hit.point ?? [0, 0, 0], C.QUERY_HIT_POINT);
			r.set(hit.normal ?? [0, 0, 0], C.QUERY_HIT_NORMAL);
		});
		return hits.filter((hit) => hit !== null).length;
	};
	/** Runs a scripted query: the failure that a test asked for, or the scripted hits. */
	const query = (name: string, kind: number, layers: number, count?: number) => {
		calls.push({
			name,
			kind,
			layers,
			input: [...f64(AT.input, C.QUERY_INPUT_FLOATS)],
			rays: count === undefined ? undefined : [...f64(AT.rays, count * C.QUERY_RAY_FLOATS)],
		});
		if (failNext !== 0) {
			failure = { code: failNext, details: [64, 0] };
			failNext = 0;
			return C.QUERY_FAILED;
		}
		const found = write(script);
		const single = name === 'raycast' && (kind === C.QUERY_CLOSEST || kind === C.QUERY_ANY);
		return single ? Math.min(found, 1) : found;
	};
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => fields[field],
		commandRing: (field: number) => ring[field],
		reserveObject: () => next++,
		createBatch: () => batchIds.shift() ?? 0,
		batchArrays: () => AT.batch,
		setBatchActiveCount: () => 0,
		setBatchLayers: () => 0,
		destroyBatch: () => 0,
		queryArrays: (field: number) =>
			({
				[C.QUERY_INPUT]: AT.input,
				[C.QUERY_HITS]: hitsAt,
				[C.QUERY_HIT_CAPACITY]: hitCapacity,
				[C.QUERY_RAYS]: AT.rays,
			})[field] ?? 0,
		reserveRays: (count: number) => {
			rayCapacity = Math.max(rayCapacity, count);
			if (count > hitCapacity) {
				hitsAt = AT.movedHits;
				hitCapacity = count;
			}
			return 0;
		},
		raycast: (kind: number, layers: number) => query('raycast', kind, layers),
		raycastBatch: (count: number, layers: number) => {
			if (count > rayCapacity) throw new Error('the batch has no room for its rays');
			return query('raycastBatch', C.QUERY_CLOSEST, layers, count);
		},
		overlap: (kind: number, layers: number) => query('overlap', kind, layers),
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 3 }, false);
	const box = new MeshGeometry(1, 0.87, core);
	const paint = new Material(1, core, 'materials.standard.set');
	return {
		scene,
		box,
		paint,
		calls,
		/** The hits that the next queries return, in order; null is a miss for a batch's ray. */
		script(hits: (Scripted | null)[]) {
			script = hits;
		},
		/** Makes the next query fail with a core error code. */
		failWith(code: number) {
			failNext = code;
		},
	};
}

/** A hit object, as a sketch creates one. */
const newHit = (): RaycastHit => ({
	object: null,
	instance: -1,
	point: [0, 0, 0],
	normal: [0, 0, 0],
	distance: 0,
	triangle: -1,
});

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('raycasts', () => {
	test('raycast writes the ray and its options, and copies the closest hit', () => {
		const { scene, box, paint, calls, script } = fakeCore();
		scene.createMesh({ mesh: box, material: paint });
		const target = scene.createMesh({ mesh: box, material: paint });
		script([
			{ slot: target.slot, distance: 4.5, triangle: 7, point: [1, 2, 3], normal: [0, 0, 1] },
		]);
		const hit = newHit();
		expect(scene.raycast([1, 2, 7.5], [0, 0, -2], { maxDistance: 10, layers: 0b110 }, hit)).toBe(
			true,
		);
		expect(hit).toEqual({
			object: target,
			instance: -1,
			point: [1, 2, 3],
			normal: [0, 0, 1],
			distance: 4.5,
			triangle: 7,
		});
		const [call] = calls;
		expect(call?.kind).toBe(C.QUERY_CLOSEST);
		expect(call?.layers).toBe(0b110);
		expect(call?.input.slice(0, 7)).toEqual([1, 2, 7.5, 0, 0, -2, 10]);
	});

	test('the default options test layer 0 with no far limit', () => {
		const { scene, calls } = fakeCore();
		scene.raycastAny([0, 0, 0], [1, 0, 0]);
		expect(calls[0]?.layers).toBe(C.LAYERS_DEFAULT);
		expect(calls[0]?.input[C.QUERY_INPUT_LIMIT]).toBe(Infinity);
		// Layer 31 crosses as an unsigned mask.
		scene.raycastAny([0, 0, 0], [1, 0, 0], { layers: 1 << 31 });
		expect(calls[1]?.layers).toBe(2 ** 31);
	});

	test('a miss returns false and clears the hit object, and a row of a batch names its batch', () => {
		const { scene, box, paint, script } = fakeCore();
		const batch = scene.createInstances(box, 10, { material: paint });
		const hit = newHit();
		script([{ batch: batch.id, row: 6, distance: 2 }]);
		expect(scene.raycast([0, 0, 0], [0, 1, 0], undefined, hit)).toBe(true);
		expect(hit.object).toBe(batch);
		expect(hit.instance).toBe(6);
		script([]);
		expect(scene.raycast([0, 0, 0], [0, 1, 0], undefined, hit)).toBe(false);
		expect(hit.object).toBeNull();
		// A batch destroyed since is not named.
		batch.destroy();
		const reborn = scene.createInstances(box, 10, { material: paint });
		script([{ batch: batch.id, row: 1, distance: 2 }]);
		scene.raycast([0, 0, 0], [0, 1, 0], undefined, hit);
		expect(hit.object).toBeNull();
		expect(reborn.id).not.toBe(batch.id);
	});

	test("a row of any core batch of a model's batch names the batch", () => {
		const { scene, script } = fakeCore();
		// A model of two meshes makes one batch of two core batches that share their rows.
		const model = new InstanceBatch(scene, 5, 4, NO_ROW_VALUES, [6]);
		(scene as unknown as { rememberBatch(batch: InstanceBatch): void }).rememberBatch(model);
		const hit = newHit();
		for (const part of [5, 6]) {
			script([{ batch: part, row: 3, distance: 1 }]);
			scene.raycast([0, 0, 0], [0, 1, 0], undefined, hit);
			expect([hit.object, hit.instance]).toEqual([model, 3]);
		}
	});

	test('a row of a sprite, point or line batch names that batch', () => {
		const { scene, script } = fakeCore();
		const rows = new InstanceBatch(scene, 5, 4);
		(scene as unknown as { rememberBatch(batch: InstanceBatch): void }).rememberBatch(rows);
		const sprites = { kind: 'sprites' } as unknown as SpriteBatch;
		rows.face = sprites;
		const hit = newHit();
		script([{ batch: 5, row: 2, distance: 1, triangle: -1 }]);
		scene.raycast([0, 0, 0], [0, 1, 0], undefined, hit);
		expect([hit.object, hit.instance, hit.triangle]).toEqual([sprites, 2, -1]);
	});

	test('a raycast writes its thresholds, or none, and no camera without an active one', () => {
		const { scene, calls } = fakeCore();
		scene.raycastAny([0, 0, 0], [1, 0, 0], { pointThreshold: 0.25, lineThreshold: 2 });
		scene.raycastAny([0, 0, 0], [1, 0, 0]);
		const read = (k: number, at: number) => calls[k]?.input[at];
		expect([read(0, C.QUERY_INPUT_POINT_THRESHOLD), read(0, C.QUERY_INPUT_LINE_THRESHOLD)]).toEqual(
			[0.25, 2],
		);
		expect([read(1, C.QUERY_INPUT_POINT_THRESHOLD), read(1, C.QUERY_INPUT_LINE_THRESHOLD)]).toEqual(
			[-1, -1],
		);
		expect(read(1, C.QUERY_INPUT_CAMERA)).toBe(C.QUERY_CAMERA_NONE);
		// A batch of rays takes the same options.
		scene.raycastBatch(
			[0, 0, 0, 1, 0, 0],
			{ lineThreshold: 0.5 },
			{
				distances: new Float32Array(1),
			},
		);
		expect(read(2, C.QUERY_INPUT_LINE_THRESHOLD)).toBe(0.5);
	});

	test('raycastAny returns whether the ray hit anything', () => {
		const { scene, box, paint, calls, script } = fakeCore();
		const target = scene.createMesh({ mesh: box, material: paint });
		script([{ slot: target.slot }]);
		expect(scene.raycastAny([0, 0, 0], [0, 0, -1])).toBe(true);
		script([]);
		expect(scene.raycastAny([0, 0, 0], [0, 0, -1])).toBe(false);
		expect(calls.map((call) => call.kind)).toEqual([C.QUERY_ANY, C.QUERY_ANY]);
	});

	test('raycastAll fills the list, adds hit objects as it grows, and follows the moved hit array', () => {
		const { scene, box, paint, script } = fakeCore();
		const [a, b] = [scene.createMesh({ mesh: box, material: paint }), scene.createGroup()];
		const hits: RaycastHit[] = [newHit()];
		const first = hits[0];
		script([
			{ slot: a.slot, distance: 1, triangle: 2 },
			{ slot: a.slot, distance: 3, triangle: 5 },
		]);
		expect(scene.raycastAll([0, 0, 0], [1, 0, 0], {}, hits)).toBe(2);
		expect(hits).toHaveLength(2);
		expect(hits[0]).toBe(first as RaycastHit);
		expect(hits.map((hit) => [hit.distance, hit.triangle])).toEqual([
			[1, 2],
			[3, 5],
		]);
		// More hits than the core's hit array held: it moved, and the scene reads the new one.
		const many = Array.from({ length: HIT_CAPACITY + 3 }, (_, i) => ({
			slot: a.slot,
			distance: i,
		}));
		script(many);
		expect(scene.raycastAll([0, 0, 0], [1, 0, 0], {}, hits)).toBe(many.length);
		expect(hits.map((hit) => hit.distance)).toEqual(many.map((hit) => hit.distance));
		// Fewer hits leave the later entries as they were.
		script([{ slot: a.slot, distance: 9 }]);
		expect(scene.raycastAll([0, 0, 0], [1, 0, 0], {}, hits)).toBe(1);
		expect(hits[0]?.distance).toBe(9);
		expect(hits[1]?.distance).toBe(1);
		expect(b).toBeDefined();
	});
});

describe('batches of rays', () => {
	test('raycastBatch copies the rays in and each ray’s hit out, into the arrays given', () => {
		const { scene, box, paint, calls, script } = fakeCore();
		const target = scene.createMesh({ mesh: box, material: paint });
		const batch = scene.createInstances(box, 4, { material: paint });
		const rays = new Float64Array([0, 0, 0, 0, 0, -1, 5, 0, 0, 0, -1, 0, 9, 9, 9, 1, 0, 0]);
		script([
			{ slot: target.slot, distance: 2, point: [0, 0, -2], normal: [0, 0, 1] },
			{ batch: batch.id, row: 3, distance: 0.5, point: [5, -0.5, 0], normal: [0, 1, 0] },
			null,
		]);
		const out = {
			distances: new Float32Array(3),
			objects: [] as (object | null)[],
			instances: new Int32Array(3),
			points: new Float64Array(9),
			normals: new Float32Array(9),
		};
		out.objects.length = 3;
		const found = scene.raycastBatch(rays, { maxDistance: 50 }, out as never);
		expect(found).toBe(2);
		expect(calls[0]?.rays).toEqual([...rays]);
		expect(calls[0]?.input[C.QUERY_INPUT_LIMIT]).toBe(50);
		expect([...out.distances]).toEqual([2, 0.5, -1]);
		expect(out.objects).toEqual([target, batch, null]);
		expect([...out.instances]).toEqual([-1, 3, -1]);
		expect([...out.points]).toEqual([0, 0, -2, 5, -0.5, 0, 0, 0, 0]);
		expect([...out.normals]).toEqual([0, 0, 1, 0, 1, 0, 0, 0, 0]);
		// Only the distances are required.
		const distances = new Float64Array(3);
		scene.raycastBatch(rays, undefined, { distances });
		expect([...distances]).toEqual([2, 0.5, -1]);
	});
});

describe('overlap queries', () => {
	test('overlapSphere and overlapBox write their volume and list the objects found', () => {
		const { scene, box, paint, calls, script } = fakeCore();
		const a = scene.createMesh({ mesh: box, material: paint });
		const batch = scene.createInstances(box, 3, { material: paint });
		script([{ slot: a.slot }, { batch: batch.id, row: 2 }]);
		const out: OverlapHit[] = [];
		expect(scene.overlapSphere([1, 2, 3], 4, { layers: 2 }, out)).toBe(2);
		expect(out.map((hit) => [hit.object, hit.instance])).toEqual([
			[a, -1],
			[batch, 2],
		]);
		expect(calls[0]?.kind).toBe(C.QUERY_SPHERE);
		expect(calls[0]?.layers).toBe(2);
		expect(calls[0]?.input.slice(0, 3)).toEqual([1, 2, 3]);
		expect(calls[0]?.input[C.QUERY_INPUT_LIMIT]).toBe(4);
		expect(scene.overlapBox([-1, -2, -3], [1, 2, 3], undefined, out)).toBe(2);
		expect(calls[1]?.kind).toBe(C.QUERY_BOX);
		expect(calls[1]?.layers).toBe(C.LAYERS_DEFAULT);
		expect(calls[1]?.input.slice(0, 6)).toEqual([-1, -2, -3, 1, 2, 3]);
	});
});

describe('query errors', () => {
	const hit = newHit();
	const cases: [string, (scene: Scene) => void, string, string][] = [
		[
			'an origin that is not finite',
			(s) => s.raycast([0, Number.NaN, 0], [0, 0, -1], undefined, hit),
			'E1203',
			'raycast() got NaN for y of the origin.',
		],
		[
			'an origin past the range of 32-bit floats',
			(s) => s.raycast([1e39, 0, 0], [0, 0, -1], undefined, hit),
			'E1108',
			'raycast() got 1e+39 for x of the origin: pass a number from -3.4e38 to 3.4e38',
		],
		[
			'a direction that is not finite',
			(s) => s.raycastAny([0, 0, 0], [0, Number.NaN, 0]),
			'E1203',
			'raycastAny() got NaN for y of the direction.',
		],
		[
			'a direction of length 0',
			(s) => s.raycastAny([0, 0, 0], [0, 0, 0]),
			'E1108',
			'raycastAny() got a direction of length 0',
		],
		[
			'a negative far limit',
			(s) => s.raycastAll([0, 0, 0], [1, 0, 0], { maxDistance: -1 }, []),
			'E1108',
			'raycastAll() got -1 for maxDistance',
		],
		[
			'a negative point threshold',
			(s) => s.raycast([0, 0, 0], [1, 0, 0], { pointThreshold: -0.5 }, hit),
			'E1108',
			'raycast() got -0.5 for pointThreshold',
		],
		[
			'a line threshold that is not a number',
			(s) => s.raycastAny([0, 0, 0], [1, 0, 0], { lineThreshold: Number.NaN }),
			'E1108',
			'raycastAny() got NaN for lineThreshold',
		],
		[
			'a mask that is not 32 bits',
			(s) => s.raycast([0, 0, 0], [1, 0, 0], { layers: 2 ** 33 }, hit),
			'E1207',
			'raycast() got 8589934592',
		],
		[
			'rays that are not six numbers each',
			(s) => s.raycastBatch(new Float64Array(7), undefined, { distances: new Float32Array(2) }),
			'E1108',
			'raycastBatch() got 7 numbers for its rays',
		],
		[
			'rays with a value that is not finite',
			(s) =>
				s.raycastBatch([0, 0, 0, 0, Infinity, 0], undefined, { distances: new Float32Array(1) }),
			'E1203',
			'raycastBatch() got Infinity for index 4 of its rays.',
		],
		[
			'a ray of a batch with a direction of length 0',
			(s) =>
				s.raycastBatch([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], undefined, {
					distances: new Float32Array(2),
				}),
			'E1108',
			'raycastBatch() got a direction of length 0 for ray 1',
		],
		[
			'a ray of a batch whose origin is past the range of 32-bit floats',
			(s) =>
				s.raycastBatch([0, 0, 0, 0, 0, 1, 0, -1e39, 0, 0, 0, 1], undefined, {
					distances: new Float32Array(2),
				}),
			'E1108',
			'raycastBatch() got -1e+39 for index 7 of its rays: pass a number from -3.4e38 to 3.4e38',
		],
		[
			'an output array too short for the rays',
			(s) =>
				s.raycastBatch(new Float64Array(12).fill(1), undefined, {
					distances: new Float32Array(2),
					points: new Float32Array(3),
				}),
			'E1108',
			'raycastBatch() got points of length 3, but its rays need 6.',
		],
		[
			'a negative radius',
			(s) => s.overlapSphere([0, 0, 0], -2, undefined, []),
			'E1108',
			'overlapSphere() got -2 for radius',
		],
		[
			'an infinite radius',
			(s) => s.overlapSphere([0, 0, 0], Infinity, undefined, []),
			'E1108',
			'overlapSphere() got Infinity for radius',
		],
		[
			'a radius past the range of 32-bit floats',
			(s) => s.overlapSphere([0, 0, 0], 1e39, undefined, []),
			'E1108',
			'overlapSphere() got 1e+39 for radius: pass a number from 0 to 3.4e38.',
		],
		[
			'a center past the range of 32-bit floats',
			(s) => s.overlapSphere([0, 0, -1e39], 1, undefined, []),
			'E1108',
			'overlapSphere() got -1e+39 for z of the center',
		],
		[
			'a box that reaches infinity',
			(s) => s.overlapBox([-Infinity, 0, 0], [1, 1, 1], undefined, []),
			'E1203',
			'overlapBox() got -Infinity for x of the lowest corner.',
		],
		[
			'a box past the range of 32-bit floats',
			(s) => s.overlapBox([0, 0, 0], [1, 1e39, 1], undefined, []),
			'E1108',
			'overlapBox() got 1e+39 for y of the highest corner',
		],
		[
			'a box whose corners are swapped',
			(s) => s.overlapBox([0, 2, 0], [1, 1, 1], undefined, []),
			'E1108',
			'overlapBox() got a lowest corner above the highest on y',
		],
	];
	for (const [name, call, code, message] of cases)
		test(`${name} throws ${code}`, () => {
			const { scene, calls } = fakeCore();
			const error = thrown(() => call(scene));
			expect(error.code as string).toBe(code);
			expect(error.message).toContain(message);
			// The check runs before the core sees the query.
			expect(calls).toHaveLength(0);
		});

	test('directions of any finite size, and points at the edge of 32-bit floats, reach the core', () => {
		const { scene, calls } = fakeCore();
		scene.raycast([0, 0, 0], [0, -1e-200, 0], undefined, hit);
		scene.raycastAny([0, 0, 0], [1e300, 0, 0]);
		scene.raycastBatch([3.4e38, 0, 0, 0, 0, -1e-300], undefined, {
			distances: new Float32Array(1),
		});
		scene.overlapSphere([-3.4e38, 0, 0], 3.4e38, undefined, []);
		scene.overlapBox([-3.4e38, 0, 0], [3.4e38, 1, 1], undefined, []);
		expect(calls.map((call) => call.name)).toEqual([
			'raycast',
			'raycast',
			'raycastBatch',
			'overlap',
			'overlap',
		]);
		expect(calls[0]?.input.slice(3, 6)).toEqual([0, -1e-200, 0]);
	});

	test("the core's failure throws its error, with the call's name", () => {
		const { scene, failWith } = fakeCore();
		failWith(1109);
		const error = thrown(() => scene.raycast([0, 0, 0], [1, 0, 0], undefined, hit));
		expect(error.code).toBe('E1109');
		expect(error.message).toContain('raycast()');
	});
});
