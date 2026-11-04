// The built selection module against the TypeScript reference: several views of several clouds,
// compared count for count. The crate is the shipped port, and `select-reference.ts` is the
// TypeScript that it replaces, so a change to either side that moves a count fails here. The module
// comes from `bun run build`, and CI's build job hands it to the unit tests. A checkout without
// that build skips and says why; CI fails with the same words, so a broken upload cannot leave the
// parity check silently unrun.
//
// One cloud gives every chunk the same distance, so only a stable sort keeps the order that the
// reference keeps, and one runs over a `SharedArrayBuffer`, so the module writes its counts into
// the caller's buffer as a page with shared memory does.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSelection } from './select-reference';
import {
	BUDGET,
	CHUNK_COUNT,
	CLOUD_RADIUS,
	EYE,
	HEADER,
	run,
	type SelectInput,
	STRIDE,
	TOTAL,
} from './select-task';

const WASM = fileURLToPath(new URL('../dist/splats.wasm', import.meta.url));
const built = existsSync(WASM);
const inCI = Boolean(process.env.CI);
const missing = `the built splat module is missing at ${WASM}; run \`bun run build\` to run this test`;

if (!built && !inCI) console.warn(`${missing}.`);

// CI's build job uploads the module with the page's other WebAssembly, so a missing file there is
// a broken upload rather than a checkout that has not built yet.
test.skipIf(!inCI)('CI hands the unit tests the splat module', () => {
	if (!built)
		throw new Error(`${missing}. CI's build job uploads it with the page's other WebAssembly.`);
});

/** An integer hash, so the clouds are the same on every run. */
function hash(value: number): number {
	let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
	x ^= x >>> 13;
	x = Math.imul(x, 0xc2b2ae35);
	return (x ^ (x >>> 16)) >>> 0;
}

/** A buffer of `chunks` chunks and their counts, shared where `shared` says so. */
function emptyView(chunks: number, shared: boolean): Float32Array {
	const floats = HEADER + chunks * STRIDE + chunks;
	const buffer = shared ? new SharedArrayBuffer(floats * 4) : new ArrayBuffer(floats * 4);
	const view = new Float32Array(buffer);
	view[CHUNK_COUNT] = chunks;
	view[CLOUD_RADIUS] = 100;
	return view;
}

/** A cloud of `chunks` chunks of `perChunk` splats, spread over a box 100 m on a side. */
function buffer(chunks: number, perChunk: number, seed: number, shared = false): Float32Array {
	const view = emptyView(chunks, shared);
	for (let i = 0; i < chunks; i++) {
		const at = HEADER + i * STRIDE;
		for (let k = 0; k < 3; k++)
			view[at + k] = (hash(seed * 7919 + i * 31 + k) / 0xffffffff) * 200 - 100;
		view[at + 3] = (hash(seed * 104729 + i) / 0xffffffff) * 20 + 0.5;
		for (let level = 0; level < 4; level++)
			view[at + 4 + level] = Math.max(1, Math.ceil(perChunk / 2 ** level));
	}
	return view;
}

/**
 * A cloud whose chunks all lie at the camera, so every distance ties. Each chunk keeps a different
 * count, so which chunk the budget refines first tells the sort's order.
 */
function tiedBuffer(counts: readonly number[], shared = false): Float32Array {
	const view = emptyView(counts.length, shared);
	counts.forEach((count, i) => {
		const at = HEADER + i * STRIDE;
		for (let level = 0; level < 4; level++)
			view[at + 4 + level] = Math.max(1, Math.ceil(count / 2 ** level));
	});
	return view;
}

/** The counts that a call wrote, as numbers. */
function countsOf(view: Float32Array, chunks: number): number[] {
	const at = HEADER + chunks * STRIDE;
	return Array.from({ length: chunks }, (_, i) => view[at + i] as number);
}

/** Runs one view through the reference and the module, and compares every count and the total. */
function compare(
	module: WebAssembly.Module,
	view: Float32Array,
	chunks: number,
	budget: number,
	eye: readonly [number, number, number],
	id: number,
	shared: boolean,
	version = 0,
): void {
	view[BUDGET] = budget;
	view[EYE] = eye[0];
	view[EYE + 1] = eye[1];
	view[EYE + 2] = eye[2];
	const reference = new Float32Array(view);
	const expected = runSelection(reference);
	const input: SelectInput = {
		id,
		version,
		chunks,
		budget,
		eyeX: eye[0],
		eyeY: eye[1],
		eyeZ: eye[2],
		view,
	};
	const answer = run(input, () => module).output;
	if (shared) {
		// The module writes the counts into the caller's buffer, and answers no copy.
		expect(answer.counts).toBeUndefined();
		expect(countsOf(view, chunks)).toEqual(countsOf(reference, chunks));
	} else {
		// Without shared memory, the worker answers with a copy of the counts.
		const counts = answer.counts as Float32Array;
		expect(countsOf(view, chunks).every((value) => value === 0)).toBe(true);
		expect(Array.from(counts)).toEqual(countsOf(reference, chunks));
	}
	expect(answer.total).toBe(expected);
	expect(reference[TOTAL]).toBe(expected);
}

describe.skipIf(!built)('the built module against the TypeScript reference', () => {
	const cases = [
		{ chunks: 1, perChunk: 1000, budget: 0, eye: [0, 0, 0] as const, seed: 1 },
		{ chunks: 8, perChunk: 25_000, budget: 50_000, eye: [0, 0, 0] as const, seed: 2 },
		{ chunks: 27, perChunk: 25_000, budget: 250_000, eye: [30, 12, -40] as const, seed: 3 },
		{ chunks: 64, perChunk: 8_000, budget: 120_000, eye: [-100, 40, 70] as const, seed: 4 },
		{ chunks: 125, perChunk: 4_000, budget: 500_000, eye: [250, -60, 120] as const, seed: 5 },
		{ chunks: 40, perChunk: 25_000, budget: 39, eye: [10, 0, 10] as const, seed: 6 },
		{ chunks: 40, perChunk: 25_000, budget: 1_000_000, eye: [0, 0, 0] as const, seed: 7 },
	];

	test('gives the same counts and total for every view', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		cases.forEach((testCase, index) => {
			compare(
				module,
				buffer(testCase.chunks, testCase.perChunk, testCase.seed),
				testCase.chunks,
				testCase.budget,
				testCase.eye,
				index + 1,
				false,
			);
		});
	});

	test('gives the same counts when every distance ties', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		const counts = [1000, 500, 250, 125];
		// The base pass takes an eighth of each chunk, and the rest refines the first chunk in the
		// sorted order. An unstable sort could put another first, so the counts would differ.
		compare(module, tiedBuffer(counts), counts.length, 400, [0, 0, 0], 50, false);
	});

	test('writes the same counts into a shared buffer', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		compare(module, buffer(27, 25_000, 3, true), 27, 250_000, [30, 12, -40], 60, true);
		compare(module, tiedBuffer([1000, 500, 250], true), 3, 400, [0, 0, 0], 61, true);
	});

	test('keeps the chunk table across the frames that share a version', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		// A moved camera asks again with the same selector and version, so the worker keeps the
		// table it copied and reads no table from the caller.
		const view = buffer(27, 25_000, 11, true);
		compare(module, view, 27, 250_000, [30, 12, -40], 65, true, 1);
		compare(module, view, 27, 250_000, [-60, 5, 90], 65, true, 1);
	});

	test('keeps the arrays of a grown selector and frees a dropped one', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		// A cloud cut into more chunks keeps one selector, whose buffer grows.
		compare(module, buffer(3, 1000, 8, true), 3, 400, [0, 0, 0], 70, true, 1);
		compare(module, buffer(5, 1000, 9, true), 5, 400, [0, 0, 0], 70, true, 2);
		// A drop frees that selector's arrays, and a later cloud takes them for its own.
		expect(run({ op: 'drop', id: 70 }, () => module).output.total).toBe(0);
		compare(module, buffer(3, 1000, 10, true), 3, 400, [0, 0, 0], 71, true, 3);
	});
});
