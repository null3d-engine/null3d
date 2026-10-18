import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { PickRead0 } from '../shared/slot';
import { CoreMemory } from './memory';
import { type PickHit, ScenePicks } from './picks';
import type { QueryTargets } from './queries';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Where the fake core keeps the pick ring's results, in bytes. */
const RESULTS = 64;
/** The object that a key names in the fake scene. */
const OBJECT = { name: 'a box' };
/** The batch that a row's key names in the fake scene. */
const BATCH = { name: 'a batch' };
/** The object or batch of a row that a batch's key names. */
const BATCH_ID = 5;

/** A core whose pick calls a test scripts, with the ring's results in a memory of its own. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const requested: { x: number; y: number; ring: number; slot: number }[] = [];
	let id = 0;
	let row = 0xffffffff;
	let covers = 1;
	const glue = {
		requestPick(x: number, y: number, ring: number, slot: number): number {
			requested.push({ x, y, ring, slot });
			return 0;
		},
		pickResultAddress: () => RESULTS,
		pickCoversScene: () => covers,
		pickTargetId: () => id,
		pickTargetRow: () => row,
	} as unknown as CoreGlue;
	const core = new CoreMemory(glue, memory);
	const results = new Uint32Array(memory.buffer, RESULTS, 4 * 4);
	return {
		core,
		requested,
		results,
		name(idOf: number, rowOf: number) {
			id = idOf;
			row = rowOf;
		},
		setKey(ring: number, value: number) {
			results[ring * 4] = value;
		},
		cover(on: boolean) {
			covers = on ? 1 : 0;
		},
	};
}

function fakeTargets(): QueryTargets {
	return {
		objectAt: (slot) => (slot === 3 ? (OBJECT as never) : undefined),
		batchAt: (id) => (id === BATCH_ID ? (BATCH as never) : undefined),
		writeCamera: () => {},
		writeRayCamera: () => {},
	} as QueryTargets;
}

/** The picks with the fake scene's targets and no ray fallback. */
function fakePicks(core: CoreMemory, byRay: (x: number, y: number) => PickHit | null = () => null) {
	const slots = new Int32Array(41);
	const picks = new ScenePicks(core, fakeTargets(), byRay);
	picks.attach(slots);
	return { picks, slots };
}

/** Raises the read's slot at `ring`, then polls: the job's promise settles on the next turn. */
async function answer(picks: ScenePicks, slots: Int32Array, ring: number) {
	Atomics.store(slots, PickRead0 + ring, 1);
	picks.poll(slots);
	await Promise.resolve();
}

describe('a pick', () => {
	test('answers through its promise when the ray fails before the loop starts', async () => {
		const core = fakeCore();
		const picks = new ScenePicks(core.core, fakeTargets(), () => {
			throw new Error('no camera');
		});
		// No slots are attached, so the pick answers by ray. A ray that throws rejects the promise
		// rather than throwing out of the call.
		await expect(picks.pick(1, 2)).rejects.toThrow('no camera');
	});

	test('asks the core for the next frame and answers the object that the ids name', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const answerPromise = picks.pick(12, 34);
		expect(core.requested).toEqual([{ x: 12, y: 34, ring: 0, slot: PickRead0 }]);
		core.setKey(0, 77);
		core.name(3, 0xffffffff);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual({ object: OBJECT as never, instance: -1 });
	});

	test('names the row of the batch that its key gives', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const answerPromise = picks.pick(1, 2);
		core.name(BATCH_ID, 4);
		core.setKey(0, 9);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual({ object: BATCH as never, instance: 4 });
	});

	test('answers null where no object owns the pixel, and for a key that names nothing', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const miss = picks.pick(1, 2);
		await answer(picks, slots, 0);
		expect(await miss).toBeNull();
		const unknown = picks.pick(3, 4);
		core.name(999, 0);
		core.setKey(1, 12);
		await answer(picks, slots, 1);
		expect(await unknown).toBeNull();
	});

	test('keeps one read in flight and answers the picks in their order', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const first = picks.pick(1, 2);
		const second = picks.pick(3, 4);
		expect(core.requested).toHaveLength(1);
		core.name(3, 0xffffffff);
		core.setKey(0, 1);
		await answer(picks, slots, 0);
		expect(await first).toEqual({ object: OBJECT as never, instance: -1 });
		expect(core.requested).toHaveLength(2);
		expect(core.requested[1]).toEqual({ x: 3, y: 4, ring: 1, slot: PickRead0 + 1 });
		core.name(3, 0xffffffff);
		core.setKey(1, 2);
		await answer(picks, slots, 1);
		expect(await second).toEqual({ object: OBJECT as never, instance: -1 });
	});

	test('answers with a raycast where the id target holds no ids of the scene', async () => {
		const core = fakeCore();
		const ray = { object: BATCH as never, instance: 2 };
		const { picks, slots } = fakePicks(core.core, () => ray);
		const answerPromise = picks.pick(5, 6);
		core.cover(false);
		Atomics.store(slots, PickRead0, 1);
		picks.poll(slots);
		expect(await answerPromise).toEqual(ray);
	});

	test('fails the picks that wait when the engine stops', async () => {
		const core = fakeCore();
		const { picks } = fakePicks(core.core);
		const first = picks.pick(1, 2);
		const second = picks.pick(3, 4);
		picks.stop();
		await expect(first).rejects.toThrow('stopped');
		await expect(second).rejects.toThrow('stopped');
		await expect(picks.pick(5, 6)).rejects.toThrow('stopped');
	});
});
