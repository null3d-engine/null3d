// A terrain block hands over to a coarser block without a pop. The split page frames one hill from
// a still camera. The page's allowed error moves the split: at 34 pixels the block under the hill
// draws with its four children, and at 37 pixels with the block itself. The flat ground's surface
// is the same at every level, so only the hill changes between the two frames.
//
// With the morph off, the children's own surface gives way to the block's coarser surface at the
// split, and a share of the hill changes at once. With the morph on, the children have already moved
// to the block's surface, so the two frames match.
//
// The comparison counts only pixels that change by more than a seventh of full scale, so a switch
// that draws the same surface does not count.
import { expect, test } from '@playwright/test';
import { compareImages, percent } from '../../packages/cli/src/compare.js';
import { imageRuns, TIERS } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

const SKETCH = 'tests/pages/sketches/terrain-split-sketch.ts';
/** The still camera's distance, in meters, and the errors either side of the hill's split. */
const DISTANCE = 25.4;
const ERRORS = [34, 37];
/** The pixel difference that counts as a moved pixel: a seventh of full scale. */
const MOVED = 0.12;
const WIDTH = 320;
const HEIGHT = 180;

const frame = (data: Uint8Array) => ({ width: WIDTH, height: HEIGHT, data });

/** One frame of the split page at an allowed error, with the morph on or off. */
async function draw(
	page: import('@playwright/test').Page,
	tier: (typeof TIERS)[number],
	error: number,
	morph: 'on' | 'off',
): Promise<Uint8Array> {
	const [run] = imageRuns([
		{
			name: `terrain-split-${morph}-${error}`,
			sketch: `${SKETCH}?distance=${DISTANCE}&error=${error}&morph=${morph}`,
			hold: 1,
			tiers: [tier],
		},
	]);
	if (!run) throw new Error('the split test has a run on its tier');
	const result = await loadResult(page, run.path, 180_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
}

const share = (a: Uint8Array, b: Uint8Array) => compareImages(frame(a), frame(b), MOVED).share;

for (const tier of TIERS)
	test(`a terrain block hands over without a pop on ${tier}`, async ({ page }) => {
		// Two errors, each with the morph off and on, and the software GPU is slow.
		test.setTimeout(600_000);
		const [before, after] = ERRORS as [number, number];
		const off = [await draw(page, tier, before, 'off'), await draw(page, tier, after, 'off')];
		const on = [await draw(page, tier, before, 'on'), await draw(page, tier, after, 'on')];
		const pop = share(off[0] as Uint8Array, off[1] as Uint8Array);
		const morphed = share(on[0] as Uint8Array, on[1] as Uint8Array);
		const distinct = share(on[0] as Uint8Array, off[0] as Uint8Array);
		console.log(
			`terrain split on ${tier}: the hill moves ${percent(pop)} of the frame from ${before} to ${after} pixels of error with the morph off, and ${percent(morphed)} with it on; the two states differ by ${percent(distinct)}`,
		);
		// The split shows with the morph off, and the two states draw the hill differently.
		expect(pop).toBeGreaterThan(0.0001);
		expect(distinct).toBeGreaterThan(0.0001);
		// The morph removes most of the change.
		expect(morphed).toBeLessThan(pop * 0.5);
	});
