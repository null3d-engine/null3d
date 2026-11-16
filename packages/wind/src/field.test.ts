import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Task } from '@null3d/engine';
import {
	analyticVelocity,
	createPushRing,
	createReading,
	defaultFieldState,
	type FieldState,
} from './analytic';
import { WindProbes } from './field';
import {
	ASK_NUMBERS,
	ASK_PUSH_RADIUS,
	ASK_TIME,
	fillRequest,
	MAX_PLACES,
	POINTS,
} from './field-layout';
import { run } from './field-task';

/** What the add-on's WebAssembly exports. */
interface FieldExports {
	readonly memory: WebAssembly.Memory;
	request(length: number): number;
	probe(): number;
	response(): number;
	response_length(): number;
}

/** The module that the add-on's task runs, or an error that says how to build it. */
function moduleOf(): WebAssembly.Module {
	let bytes: Buffer;
	try {
		bytes = readFileSync(new URL('../dist/wind.wasm', import.meta.url));
	} catch {
		throw new Error(
			"the wind add-on's WebAssembly is missing. Run `bun run build`, which writes it, and run this test again.",
		);
	}
	return new WebAssembly.Module(new Uint8Array(bytes));
}

/** The field with a gust and a swirl, or the steady field alone. */
const state = (over: Partial<FieldState> = {}): FieldState => ({
	...defaultFieldState(),
	...over,
});

/** The numbers that a frame gives the ask: the push's width and the sketch time. */
function askNumbers(settings: FieldState, time: number): Float64Array {
	const numbers = new Float64Array(ASK_NUMBERS);
	numbers[ASK_PUSH_RADIUS] = settings.pushRadius;
	numbers[ASK_TIME] = time;
	return numbers;
}

/**
 * The air that the module gives at each place, through the layout that the add-on's task fills.
 * `ring` holds one slot after another: the place across the ground, the strength and the birth time.
 */
function moduleAir(
	settings: FieldState,
	ring: Float32Array,
	time: number,
	places: Float32Array,
): Float32Array {
	const exports = new WebAssembly.Instance(moduleOf(), {}).exports as unknown as FieldExports;
	const floats = POINTS + places.length;
	const request = new Float32Array(floats);
	fillRequest(request, places, createReading(settings), ring, askNumbers(settings, time));
	const at = exports.request(floats * 4);
	if (at === 0) throw new Error('the module took no request');
	new Float32Array(exports.memory.buffer, at, floats).set(request);
	expect(exports.probe()).toBe(0);
	return new Float32Array(
		exports.memory.buffer.slice(exports.response(), exports.response() + exports.response_length()),
	);
}

/** The air that the add-on's TypeScript mirror gives at each place. */
function mirrorAir(
	settings: FieldState,
	pushes: readonly { x: number; z: number; strength: number; born: number }[],
	time: number,
	places: Float32Array,
): Float32Array {
	const out = new Float32Array(places.length);
	const one: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < places.length; i += 3) {
		analyticVelocity(
			settings,
			pushes,
			places[i] as number,
			places[i + 1] as number,
			places[i + 2] as number,
			time,
			one,
		);
		out[i] = one[0];
		out[i + 1] = one[1];
		out[i + 2] = one[2];
	}
	return out;
}

/** A ring of slots, in the request's order, from a page's pushes. */
function ringOf(
	time: number,
	pushes: readonly (readonly [number, number, number])[],
	gust: readonly [number, number, number] | undefined,
): { ring: Float32Array; slots: ReturnType<typeof createPushRing>['slots'] } {
	const slots = createPushRing();
	for (const [x, z, strength] of pushes) slots.add(x, z, strength, time, false);
	if (gust) slots.add(gust[0], gust[1], gust[2], time, true);
	const ring = new Float32Array(16);
	for (let i = 0; i < 4; i++) {
		const slot = slots.slots[i];
		if (slot) {
			ring[i * 4] = slot.x;
			ring[i * 4 + 1] = slot.z;
			ring[i * 4 + 2] = slot.strength;
			ring[i * 4 + 3] = slot.born;
		}
	}
	return { ring, slots: slots.slots };
}

describe('the field in WebAssembly', () => {
	test('gives the air that the add-on TypeScript form gives', () => {
		const settings = state();
		const time = 2.5;
		const places = new Float32Array([
			-12, 1, 8, 0, 4, 0, 3.5, 0.25, -6, 40, 30, 12, -20, 2, 14, 7, 9, -3,
		]);
		const { ring, slots } = ringOf(
			time,
			[
				[2, -1, 2.5],
				[-8, 3, -1.5],
			],
			[-16, 2, 3.5],
		);
		const fromWasm = moduleAir(settings, ring, time, places);
		const fromTs = mirrorAir(settings, slots, time, places);
		expect(fromWasm.length).toBe(places.length);
		for (let i = 0; i < places.length; i++)
			expect(Math.abs((fromWasm[i] as number) - (fromTs[i] as number))).toBeLessThan(1e-4);
	});

	test('gives the steady field when a page sends no push or gust', () => {
		const settings = state({ gustStrength: 0, swirl: 0, heading: 0.7 });
		const places = new Float32Array([5, 100, 2, -5, 0, 2, 0, 1, 0]);
		const ring = new Float32Array(16);
		const fromWasm = moduleAir(settings, ring, 3, places);
		const fromTs = mirrorAir(settings, createPushRing().slots, 3, places);
		for (let i = 0; i < places.length; i++)
			expect(Math.abs((fromWasm[i] as number) - (fromTs[i] as number))).toBeLessThan(1e-4);
	});

	test('takes the most places that one ask names', () => {
		const settings = state();
		const places = new Float32Array(3 * MAX_PLACES);
		for (let i = 0; i < places.length; i += 3) {
			places[i] = (i % 41) - 20;
			places[i + 1] = (i % 7) - 3;
			places[i + 2] = (i % 29) - 14;
		}
		const ring = new Float32Array(16);
		const answer = moduleAir(settings, ring, 1, places);
		expect(answer.length).toBe(places.length);
		expect(answer.some((value) => value !== 0)).toBe(true);
	});

	test('fills the answer that the worker gives back', () => {
		// The task's own module, with the compiled module that the engine hands a worker.
		const module = moduleOf();
		const request = new Float32Array(POINTS + 6);
		const answer = new Float32Array(6);
		const places = request.subarray(POINTS);
		places.set([2, 3, -4, -6, 0.5, 7]);
		const settings = state();
		const time = 1.25;
		const { ring, slots } = ringOf(time, [[1, 2, 3]], undefined);
		fillRequest(request, places, createReading(settings), ring, askNumbers(settings, time));
		const result = run({ request, answer }, () => module);
		expect(result).toBeDefined();
		if (!(result instanceof Promise)) {
			expect(result.output).toBe(answer);
			const mirror = mirrorAir(settings, slots, time, places);
			for (let i = 0; i < places.length; i++)
				expect(Math.abs((answer[i] as number) - (mirror[i] as number))).toBeLessThan(1e-4);
		}
	});
});

/** A worker that runs a task later, as the engine's worker does, on the buffer that it was sent. */
function deferringWorker(module: WebAssembly.Module): {
	send: (task: Task, input: unknown) => Promise<unknown>;
	flush(): void;
	readonly waiting: number;
} {
	const queue: (() => void)[] = [];
	return {
		send: (_task, input) =>
			new Promise((resolve) => {
				// The task reads `input` when the worker runs it, not when the page sends it, which is
				// what a shared request buffer does.
				queue.push(() => resolve(run(input, () => module)));
			}),
		flush(): void {
			(queue.shift() as () => void)();
		},
		get waiting(): number {
			return queue.length;
		},
	};
}

/** The air that the mirror gives at one place. */
function mirrorAt(settings: FieldState, time: number, place: readonly number[]): number[] {
	const out: [number, number, number] = [0, 0, 0];
	analyticVelocity(
		settings,
		createPushRing().slots,
		place[0] as number,
		place[1] as number,
		place[2] as number,
		time,
		out,
	);
	return out;
}

describe('the read path through the task', () => {
	test('drives the request, the task module and the answer as a worker does', async () => {
		const worker = deferringWorker(moduleOf());
		const probes = new WindProbes(worker.send);
		const settings = state();
		const points = new Float32Array([2, 3, -4]);
		const answer = new Float32Array(3);
		probes.ask(
			points,
			answer,
			createReading(settings),
			new Float32Array(16),
			askNumbers(settings, 1),
		);
		expect(worker.waiting).toBe(1);
		worker.flush();
		await Promise.resolve();
		const want = mirrorAt(settings, 1, [2, 3, -4]);
		for (let i = 0; i < 3; i++)
			expect(Math.abs((answer[i] as number) - (want[i] as number))).toBeLessThan(1e-4);
	});

	test('keeps the places of an ask that is on its way', async () => {
		// The engine hands a shared request buffer to the worker without copying it, so a second ask
		// may not write the bytes of the first. Two buffers hold the two asks apart.
		const worker = deferringWorker(moduleOf());
		const probes = new WindProbes(worker.send);
		const settings = state();
		const ring = new Float32Array(16);
		const firstPoints = new Float32Array([1, 2, 3]);
		const secondPoints = new Float32Array([-7, 0.5, 9]);
		const firstAnswer = new Float32Array(3);
		const secondAnswer = new Float32Array(3);
		probes.ask(firstPoints, firstAnswer, createReading(settings), ring, askNumbers(settings, 1));
		// The second call lands while the first answer is still on its way.
		probes.ask(secondPoints, secondAnswer, createReading(settings), ring, askNumbers(settings, 2));
		expect(worker.waiting).toBe(1);
		worker.flush();
		await Promise.resolve();
		const first = mirrorAt(settings, 1, [1, 2, 3]);
		for (let i = 0; i < 3; i++)
			expect(Math.abs((firstAnswer[i] as number) - (first[i] as number))).toBeLessThan(1e-4);
		// The ask that waited goes out with its own places, and its answer follows.
		expect(worker.waiting).toBe(1);
		worker.flush();
		await Promise.resolve();
		const second = mirrorAt(settings, 2, [-7, 0.5, 9]);
		for (let i = 0; i < 3; i++)
			expect(Math.abs((secondAnswer[i] as number) - (second[i] as number))).toBeLessThan(1e-4);
	});
});

describe('a third ask that overlaps', () => {
	test('replaces the queued ask, says so once, and leaves that answer array alone', async () => {
		const worker = deferringWorker(moduleOf());
		const probes = new WindProbes(worker.send);
		const settings = state();
		const ring = new Float32Array(16);
		const first = new Float32Array([1, 2, 3]);
		const second = new Float32Array([-7, 0.5, 9]);
		const third = new Float32Array([4, 0.25, -2]);
		const firstAnswer = new Float32Array(3);
		const secondAnswer = new Float32Array(3);
		const thirdAnswer = new Float32Array(3);
		const reported = spyOn(console, 'error').mockImplementation(() => {});
		try {
			probes.ask(first, firstAnswer, createReading(settings), ring, askNumbers(settings, 1));
			probes.ask(second, secondAnswer, createReading(settings), ring, askNumbers(settings, 2));
			// The third lands while the first answer is on its way and a second ask already waits.
			probes.ask(third, thirdAnswer, createReading(settings), ring, askNumbers(settings, 3));
			expect(reported).toHaveBeenCalledTimes(1);
			expect(String(reported.mock.calls[0]?.[0])).toContain('newest ask replaced it');
			expect(worker.waiting).toBe(1);
			worker.flush();
			await Promise.resolve();
			// The first answer is the first ask's air, and the queued ask went out with the third.
			const wantFirst = mirrorAt(settings, 1, [1, 2, 3]);
			for (let i = 0; i < 3; i++)
				expect(Math.abs((firstAnswer[i] as number) - (wantFirst[i] as number))).toBeLessThan(1e-4);
			worker.flush();
			await Promise.resolve();
			const wantThird = mirrorAt(settings, 3, [4, 0.25, -2]);
			for (let i = 0; i < 3; i++)
				expect(Math.abs((thirdAnswer[i] as number) - (wantThird[i] as number))).toBeLessThan(1e-4);
			// The ask that the third replaced is dropped, and its array keeps what it held.
			expect([...secondAnswer]).toEqual([0, 0, 0]);
		} finally {
			reported.mockRestore();
		}
	});
});
