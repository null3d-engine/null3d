// The built selection module against the TypeScript reference: several views of several clouds,
// compared count for count. The crate is the shipped port, and `select-reference.ts` is the
// TypeScript that it replaces, so a change to either side that moves a count fails here. The module
// comes from `bun run build`, and CI's build job hands it to the unit tests. A checkout without
// that build skips and says why; CI fails with the same words, so a broken upload cannot leave the
// parity check silently unrun.
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

/** A cloud's buffer of `chunks` chunks of `perChunk` splats, spread over a box 100 m on a side. */
function buffer(chunks: number, perChunk: number, seed: number): Float32Array {
	const view = new Float32Array(HEADER + chunks * STRIDE + chunks);
	view[CHUNK_COUNT] = chunks;
	view[CLOUD_RADIUS] = 100;
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

/** The counts that a call wrote, as numbers. */
function countsOf(view: Float32Array, chunks: number): number[] {
	const at = HEADER + chunks * STRIDE;
	return Array.from({ length: chunks }, (_, i) => view[at + i] as number);
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
			const view = buffer(testCase.chunks, testCase.perChunk, testCase.seed);
			view[BUDGET] = testCase.budget;
			view[EYE] = testCase.eye[0];
			view[EYE + 1] = testCase.eye[1];
			view[EYE + 2] = testCase.eye[2];
			const reference = new Float32Array(view);
			const expected = runSelection(reference);
			const input: SelectInput = {
				id: index + 1,
				version: 0,
				chunks: testCase.chunks,
				budget: testCase.budget,
				eyeX: testCase.eye[0],
				eyeY: testCase.eye[1],
				eyeZ: testCase.eye[2],
				view,
			};
			const answer = run(input, () => module).output;
			// Without shared memory, the worker answers with a copy of the counts.
			const counts = answer.counts as Float32Array;
			expect(countsOf(view, testCase.chunks).every((value) => value === 0)).toBe(true);
			expect(Array.from(counts)).toEqual(countsOf(reference, testCase.chunks));
			expect(answer.total).toBe(expected);
			expect(reference[TOTAL]).toBe(expected);
		});
	});
});
