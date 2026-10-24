// The selection task: the level that each chunk's distance asks for, the budget that lowers it, and
// the order in which the nearest chunks take the budget first. The test writes the buffer that the
// sketch writes, and reads the answer that the worker gives.
import { describe, expect, it } from 'bun:test';
import { BUDGET, CHUNK_COUNT, EYE, HEADER, run, STRIDE, TOTAL } from './select-task';

/** A buffer of three chunks: one at the camera, one 100 m away and one 1 km away. */
function buffer(counts: readonly (readonly [number, number, number, number])[]): Float32Array {
	const view = new Float32Array(HEADER + counts.length * STRIDE + counts.length);
	view[CHUNK_COUNT] = counts.length;
	counts.forEach((levels, i) => {
		const at = HEADER + i * STRIDE;
		view[at] = i === 0 ? 0 : i === 1 ? 100 : 1000;
		view[at + 1] = 0;
		view[at + 2] = 0;
		view[at + 3] = 1;
		levels.forEach((count, level) => {
			view[at + 4 + level] = count;
		});
	});
	return view;
}

/** The three chunks of the test: each 100 splats, halving at each level. */
const LEVELS = [
	[100, 50, 25, 13],
	[100, 50, 25, 13],
	[100, 50, 25, 13],
] as const;

/** The counts that the task left in the buffer, one for each chunk. */
function countsOf(view: Float32Array, chunks: number): number[] {
	const at = HEADER + chunks * STRIDE;
	return Array.from({ length: chunks }, (_, i) => view[at + i] as number);
}

describe('the splat selection task', () => {
	it('gives each chunk the level that its distance asks for', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 1000;
		const { output } = run({ view });
		expect(output).toBe(true);
		// The near chunk draws in full, and the far ones at their coarsest level.
		expect(countsOf(view, 3)).toEqual([100, 13, 13]);
		expect(view[TOTAL]).toBe(126);
	});

	it('lowers a level where the budget runs out, nearest first', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 120;
		run({ view });
		expect(countsOf(view, 3)).toEqual([100, 13, 7]);
		expect(view[TOTAL]).toBe(120);
	});

	it('takes a coarser level of the near chunk before the far chunks', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 60;
		run({ view });
		// The nearest chunk halves instead of leaving the far chunks nothing.
		expect(countsOf(view, 3)).toEqual([50, 10, 0]);
		expect(view[TOTAL]).toBe(60);
	});

	it('takes the camera into account', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 1000;
		view[EYE] = 100;
		run({ view });
		// The camera stands at the second chunk now.
		expect(countsOf(view, 3)).toEqual([13, 100, 13]);
	});

	it('reuses its scratch when the chunk count stays the same', () => {
		const first = buffer(LEVELS);
		first[BUDGET] = 1000;
		run({ view: first });
		const second = buffer(LEVELS);
		second[BUDGET] = 60;
		run({ view: second });
		expect(countsOf(second, 3)).toEqual([50, 10, 0]);
		expect(second[TOTAL]).toBe(60);
	});
});
