import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	analyticVelocity,
	createPushRing,
	createReading,
	defaultFieldState,
	type FieldState,
} from './analytic';
import { fillRequest, MAX_PLACES, POINTS } from './field-layout';
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
	fillRequest(request, places, createReading(settings), settings.pushRadius, time, ring);
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
		fillRequest(request, places, createReading(settings), settings.pushRadius, time, ring);
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
