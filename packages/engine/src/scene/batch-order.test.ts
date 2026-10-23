// The render order of an instance batch: the call that sets it reaches the core, and a number
// that is not finite is refused before anything changes. The test uses a stand-in core, so it
// reads no GPU and ships nothing.
import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { withCallValues } from './fake-call-values';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';
import { Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

const CAPACITY = 15;
const RING = 64;
const AT = { fields: 0, records: 2048, write: 4096, read: 4100 };

/** A core that hands out slots and records each batch order it is given. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let slot = 0;
	const orders: [number, number][] = [];
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => AT.fields + field * 256,
		commandRing: (field: number) => [AT.records, RING, AT.write, AT.read][field] as number,
		reserveObject: () => ++slot,
		createBatch: () => 7,
		setBatchActiveCount: () => 0,
		setBatchRenderOrder: (batch: number, order: number) => {
			orders.push([batch, order]);
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(withCallValues(glue, memory) as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 1 }, false);
	const box = new MeshGeometry(1, 1, core);
	const paint = new Material(1, core, 'materials.standard');
	return { scene, orders, box, paint };
}

describe('a batch render order', () => {
	test('reaches the core, and a lower order is kept as it is', () => {
		const { scene, orders, box, paint } = fakeCore();
		const lanes = scene.createInstances(box, 10, { material: paint });
		lanes.setRenderOrder(-1);
		lanes.setRenderOrder(2.5);
		expect(orders).toEqual([
			[7, -1],
			[7, 2.5],
		]);
	});

	test('a number that is not finite throws E1203 before anything changes', () => {
		const { scene, orders, box, paint } = fakeCore();
		const lanes = scene.createInstances(box, 10, { material: paint });
		for (const order of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			let code = '';
			try {
				lanes.setRenderOrder(order);
			} catch (error) {
				code = (error as { code?: string }).code ?? '';
			}
			expect(code).toBe('E1203');
		}
		expect(orders).toEqual([]);
	});
});
