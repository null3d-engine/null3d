// A batch's bounding radius is its own. A vertex shader that carries rows far from their origins,
// such as traffic along a lane, widens it for that batch alone, and another batch on the same mesh
// keeps the mesh's own radius.
import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { withCallValues } from './fake-call-values';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';
import { Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 15;
const RING = 64;
/** Where the fake core keeps its arrays in memory: the scene's fields, then the ring. */
const AT = { fields: 0, records: 2048, write: 4096, read: 4100 };

/** A core that hands out slots, keeps the command ring in memory, and records each bound it sets. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let slot = 0;
	let batch = 0;
	const bounds: [number, number][] = [];
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => AT.fields + field * 256,
		commandRing: (field: number) => [AT.records, RING, AT.write, AT.read][field] as number,
		reserveObject: () => ++slot,
		createBatch: () => ++batch,
		batchArrays: () => 0,
		setBatchActiveCount: () => 0,
		setBatchBounds: (id: number, radius: number) => {
			bounds.push([id, radius]);
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(withCallValues(glue, memory) as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 1 }, false);
	const box = new MeshGeometry(1, 1, core);
	const paint = new Material(1, core, 'materials.standard');
	return { scene, bounds, box, paint };
}

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('a batch bound', () => {
	test('gives every row of its own batch the radius it is set to', () => {
		const { scene, bounds, box, paint } = fakeCore();
		const lanes = scene.createInstances(box, 10, { material: paint });
		scene.createInstances(box, 4, { material: paint });
		lanes.setBoundingRadius(2400);
		// One call, for the batch that asked for it: the other keeps the mesh's own radius.
		expect(bounds).toHaveLength(1);
		expect(bounds[0]?.[1]).toBe(2400);
	});

	test('refuses a radius of 0 or below, or one that is not a finite number', () => {
		const { scene, bounds, box, paint } = fakeCore();
		const lanes = scene.createInstances(box, 10, { material: paint });
		for (const radius of [0, -1]) {
			expect(thrown(() => lanes.setBoundingRadius(radius)).code).toBe('E1108');
		}
		// A value that is not a finite number fails the engine's own check, as every radius does.
		for (const radius of [Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(thrown(() => lanes.setBoundingRadius(radius)).code).toBe('E1203');
		}
		expect(bounds).toEqual([]);
	});
});
