// The selection task: a coarsest prefix for every chunk the budget reaches, then a finer one for the
// nearest chunks, up to the level that their distance asks for. The test writes the buffer that the
// sketch writes, and reads the answer that the worker gives.
import { describe, expect, it } from 'bun:test';
import { BUDGET, CHUNK_COUNT, CLOUD_RADIUS, EYE, HEADER, run, STRIDE, TOTAL } from './select-task';

/** The cloud's size, in meters, that these chunks belong to. */
const CLOUD = 50;

/**
 * A buffer of three chunks: one at the camera, one 150 m away and one 1 km away. Each chunk is 100
 * splats of radius 1, halving at each level.
 */
function buffer(
	centre: readonly (readonly [number, number, number])[] = [
		[0, 0, 0],
		[150, 0, 0],
		[1000, 0, 0],
	],
	radii: readonly number[] = centre.map(() => 1),
): Float32Array {
	const view = new Float32Array(HEADER + centre.length * STRIDE + centre.length);
	view[CHUNK_COUNT] = centre.length;
	view[CLOUD_RADIUS] = CLOUD;
	centre.forEach((place, i) => {
		const at = HEADER + i * STRIDE;
		view[at] = place[0];
		view[at + 1] = place[1];
		view[at + 2] = place[2];
		view[at + 3] = radii[i] as number;
		view[at + 4] = 100;
		view[at + 5] = 50;
		view[at + 6] = 25;
		view[at + 7] = 13;
	});
	return view;
}

/** The counts that the task left in the buffer, one for each chunk. */
function countsOf(view: Float32Array, chunks: number): number[] {
	const at = HEADER + chunks * STRIDE;
	return Array.from({ length: chunks }, (_, i) => view[at + i] as number);
}

describe('the splat selection task', () => {
	it('gives each chunk the level that its distance asks for', () => {
		const view = buffer();
		view[BUDGET] = 1000;
		const { output } = run({ view });
		expect(output).toBe(true);
		// The near chunk draws in full, the next at half, and the far one at its coarsest level.
		expect(countsOf(view, 3)).toEqual([100, 50, 13]);
		expect(view[TOTAL]).toBe(163);
	});

	it('measures distance in the cloud rather than in the chunk', () => {
		// The same camera and place, with chunks a quarter of the size: a finer cut must choose the
		// same levels, so the view draws as many splats as the coarser cut did.
		const coarse = buffer();
		const fine = buffer(undefined, [0.25, 0.25, 0.25]);
		coarse[BUDGET] = 1000;
		fine[BUDGET] = 1000;
		run({ view: coarse });
		run({ view: fine });
		expect(countsOf(fine, 3)).toEqual(countsOf(coarse, 3));
	});

	it('keeps every chunk when the budget covers their coarsest level', () => {
		const view = buffer();
		view[BUDGET] = 39;
		run({ view });
		// Each chunk keeps an eighth of itself, so the whole cloud draws thinly.
		expect(countsOf(view, 3)).toEqual([13, 13, 13]);
		expect(view[TOTAL]).toBe(39);
	});

	it('spends what is left on the nearest chunks first', () => {
		const view = buffer();
		view[BUDGET] = 150;
		run({ view });
		// The bases take 39. The nearest chunk then takes its other 87, and the next what is left.
		expect(countsOf(view, 3)).toEqual([100, 37, 13]);
		expect(view[TOTAL]).toBe(150);
	});

	it('keeps every chunk even when the budget is short', () => {
		const view = buffer();
		view[BUDGET] = 60;
		run({ view });
		// The far chunks keep their eighth instead of losing every splat to the near one.
		expect(countsOf(view, 3)).toEqual([34, 13, 13]);
		expect(view[TOTAL]).toBe(60);
	});

	it('takes the camera into account', () => {
		const view = buffer();
		view[BUDGET] = 1000;
		view[EYE] = 150;
		run({ view });
		// The camera stands at the second chunk now, so the first is the half-level one.
		expect(countsOf(view, 3)).toEqual([50, 100, 13]);
	});

	it('reuses its scratch when the chunk count stays the same', () => {
		const first = buffer();
		first[BUDGET] = 1000;
		run({ view: first });
		const second = buffer();
		second[BUDGET] = 60;
		run({ view: second });
		expect(countsOf(second, 3)).toEqual([34, 13, 13]);
		expect(second[TOTAL]).toBe(60);
	});
});
