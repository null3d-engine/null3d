// The selection task: a coarsest prefix for every chunk the budget reaches, then a finer one for the
// nearest chunks, up to the level that their distance asks for. The test writes the buffer that the
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

	it('keeps every chunk when the budget covers their coarsest level', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 39;
		run({ view });
		// Each chunk keeps an eighth of itself, so the whole cloud draws thinly.
		expect(countsOf(view, 3)).toEqual([13, 13, 13]);
		expect(view[TOTAL]).toBe(39);
	});

	it('spends what is left on the nearest chunk', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 120;
		run({ view });
		// The bases take 39, and the nearest chunk takes the remaining 81 of its full count.
		expect(countsOf(view, 3)).toEqual([94, 13, 13]);
		expect(view[TOTAL]).toBe(120);
	});

	it('keeps every chunk even when the budget is short', () => {
		const view = buffer(LEVELS);
		view[BUDGET] = 60;
		run({ view });
		// The far chunks keep their eighth instead of losing every splat to the near one.
		expect(countsOf(view, 3)).toEqual([34, 13, 13]);
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
		expect(countsOf(second, 3)).toEqual([34, 13, 13]);
		expect(second[TOTAL]).toBe(60);
	});
});
