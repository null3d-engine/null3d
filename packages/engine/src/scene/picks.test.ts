import { beforeEach, describe, expect, test } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { GpuEpoch, PickRead0 } from '../shared/slot';
import { CoreMemory } from './memory';
import { type PickHit, ScenePicks } from './picks';
import type { QueryTarget, QueryTargets } from './queries';

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
	let frame = -1;
	const glue = {
		requestPick(x: number, y: number, ring: number, slot: number): number {
			requested.push({ x, y, ring, slot });
			return 0;
		},
		pickResultAddress: () => RESULTS,
		pickCoversScene: () => covers,
		pickFrame: () => frame,
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
		frameAt(value: number) {
			frame = value;
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

/** The picks with the fake scene's targets and a ray callback, whose calls the tests read. */
function fakePicks(
	core: CoreMemory,
	byRay: (x: number, y: number, frame: number) => PickHit | null = () => null,
	calls: { x: number; y: number; frame: number }[] = [],
) {
	const slots = new Int32Array(41);
	const picks = new ScenePicks(core, fakeTargets(), (x, y, frame) => {
		calls.push({ x, y, frame });
		return byRay(x, y, frame);
	});
	picks.attach(slots);
	return { picks, slots, calls };
}

/** An answer that names a source and no texture coordinates. */
const noUv = (object: unknown, instance: number): PickHit => ({
	object: object as QueryTarget,
	instance,
	uv: [Number.NaN, Number.NaN],
	hasUv: false,
});

/** Raises the read's slot at `ring`, then polls: the job's promise settles on the next turn. */
async function answer(picks: ScenePicks, slots: Int32Array, ring: number) {
	Atomics.store(slots, PickRead0 + ring, 1);
	picks.poll(slots);
	await Promise.resolve();
}

/** A promise's outcome: a value, or the error it rejected with. */
type Outcome<T> = { value: T; error?: never } | { value?: never; error: unknown };

/** Waits for a promise to settle, and fails when it has not settled within `ms`. */
async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bound = new Promise<Outcome<T>>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`the pick did not settle within ${ms} ms`)), ms);
	});
	try {
		return await Promise.race([
			promise.then(
				(value): Outcome<T> => ({ value }),
				(error: unknown): Outcome<T> => ({ error }),
			),
			bound,
		]);
	} finally {
		clearTimeout(timer);
	}
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
		expect(await answerPromise).toEqual(noUv(OBJECT, -1));
	});

	test('names the row of the batch that its key gives', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const answerPromise = picks.pick(1, 2);
		core.name(BATCH_ID, 4);
		core.setKey(0, 9);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual(noUv(BATCH, 4));
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
		expect(await first).toEqual(noUv(OBJECT, -1));
		expect(core.requested).toHaveLength(2);
		expect(core.requested[1]).toEqual({ x: 3, y: 4, ring: 1, slot: PickRead0 + 1 });
		core.name(3, 0xffffffff);
		core.setKey(1, 2);
		await answer(picks, slots, 1);
		expect(await second).toEqual(noUv(OBJECT, -1));
	});

	test('rejects a pick that waits when the GPU is lost, and does not ask again', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const pick = picks.pick(12, 34);
		expect(core.requested).toHaveLength(1);
		// The device that recorded the read goes away before its copy lands: the read's slot stays
		// 0 and the GPU epoch rises.
		Atomics.store(slots, GpuEpoch, 1);
		picks.poll(slots);
		const outcome = await settlesWithin(pick, 1000);
		expect(outcome.error).toBeInstanceOf(EngineError);
		expect((outcome.error as EngineError).code).toBe('E1436');
		// The lost read cannot land, so the pick is rejected rather than asked again.
		expect(core.requested).toHaveLength(1);
	});

	test('answers the picks that wait behind the rejected one on the new device', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core);
		const lost = picks.pick(12, 34);
		const next = picks.pick(56, 78);
		expect(core.requested).toHaveLength(1);
		Atomics.store(slots, GpuEpoch, 1);
		picks.poll(slots);
		const outcome = await settlesWithin(lost, 1000);
		expect((outcome.error as EngineError).code).toBe('E1436');
		// Only the pick that the lost device recorded is rejected: the next one was still queued,
		// so the new device asks for it.
		expect(core.requested).toEqual([
			{ x: 12, y: 34, ring: 0, slot: PickRead0 },
			{ x: 56, y: 78, ring: 1, slot: PickRead0 + 1 },
		]);
		core.name(3, 0xffffffff);
		core.setKey(1, 77);
		await answer(picks, slots, 1);
		expect(await next).toEqual(noUv(OBJECT, -1));
	});

	test('gives the texture coordinates that a ray from the picked frame finds', async () => {
		const core = fakeCore();
		const calls: { x: number; y: number; frame: number }[] = [];
		const { picks, slots } = fakePicks(
			core.core,
			(_x, _y, frame) =>
				frame === 42
					? { object: OBJECT as never, instance: -1, uv: [0.25, 1.75], hasUv: true }
					: null,
			calls,
		);
		core.frameAt(42);
		const answerPromise = picks.pick(12, 34);
		core.name(3, 0xffffffff);
		core.setKey(0, 77);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual({
			object: OBJECT as never,
			instance: -1,
			uv: [0.25, 1.75],
			hasUv: true,
		});
		// The ray asks at the pick's own point, with the camera of the frame that recorded it.
		expect(calls).toEqual([{ x: 12, y: 34, frame: 42 }]);
	});

	test('reports no coordinates when the ray names another source than the pick', async () => {
		const core = fakeCore();
		// The ray meets the batch where the id target names the object: the object answer stays, and
		// the coordinates say that they are unknown rather than take the other source's.
		const { picks, slots } = fakePicks(core.core, () => ({
			object: BATCH as never,
			instance: 2,
			uv: [0.5, 0.5],
			hasUv: true,
		}));
		core.frameAt(9);
		core.name(3, 0xffffffff);
		core.setKey(0, 77);
		const answerPromise = picks.pick(1, 2);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual(noUv(OBJECT, -1));
	});

	test('reports no coordinates when the pick names no frame', async () => {
		const core = fakeCore();
		const calls: { x: number; y: number; frame: number }[] = [];
		const { picks, slots } = fakePicks(
			core.core,
			() => ({ object: OBJECT as never, instance: -1, uv: [0.5, 0.5], hasUv: true }),
			calls,
		);
		core.name(3, 0xffffffff);
		core.setKey(0, 77);
		const answerPromise = picks.pick(1, 2);
		await answer(picks, slots, 0);
		// A ray from a camera that did not draw the pixel would name another triangle.
		expect(await answerPromise).toEqual(noUv(OBJECT, -1));
		expect(calls).toEqual([]);
	});

	test('reports no coordinates for a source whose mesh has none', async () => {
		const core = fakeCore();
		const { picks, slots } = fakePicks(core.core, () => ({
			object: OBJECT as never,
			instance: -1,
			uv: [Number.NaN, Number.NaN],
			hasUv: false,
		}));
		core.frameAt(9);
		core.name(3, 0xffffffff);
		core.setKey(0, 77);
		const answerPromise = picks.pick(1, 2);
		await answer(picks, slots, 0);
		expect(await answerPromise).toEqual(noUv(OBJECT, -1));
	});

	test('answers with a raycast where the id target holds no ids of the scene', async () => {
		const core = fakeCore();
		const ray = {
			object: BATCH as never,
			instance: 2,
			uv: [0.1, 0.9],
			hasUv: true,
		};
		const calls: { x: number; y: number; frame: number }[] = [];
		const { picks, slots } = fakePicks(core.core, () => ray, calls);
		const answerPromise = picks.pick(5, 6);
		core.cover(false);
		Atomics.store(slots, PickRead0, 1);
		picks.poll(slots);
		expect(await answerPromise).toEqual(ray);
		// A ray answers with the camera as it stands, which names no frame.
		expect(calls).toEqual([{ x: 5, y: 6, frame: -1 }]);
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
