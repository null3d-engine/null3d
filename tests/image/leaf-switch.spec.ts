// An oak's leaf cards hand over to the next level without a pop. The switch page holds the camera
// still and takes the level threshold from the address, so the switch distance moves across the
// camera and nothing else in the frame changes. The two thresholds sit either side of the switch:
// just below it, the base level draws, and just above it, the next level draws.
//
// With the morph off, the cards that the next level drops vanish and the kept ones grow at the
// switch, so a share of the crown changes at once. With the morph on, the base level's cards have
// already moved to those places, so the pair differs only by the last few per cent of the mix.
//
// The switch distance comes from the same rules that the engine uses: the level's error times the
// copy's world scale times the render height times the projection's [1][1], over twice the
// threshold. The distance is to the nearest point of the plant's bounding sphere about its origin,
// so the sphere's radius comes off the camera's distance to the tree.
import { expect, test } from '@playwright/test';
import { compareImages, percent } from '../../packages/cli/src/compare.js';
import { builtInSpecies } from '../../packages/vegetation/src/builtin.ts';
import { generatePlant } from '../../packages/vegetation/src/generate.ts';
import { imageRuns, TIERS } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

const SKETCH = 'tests/pages/sketches/leaf-switch-sketch.ts';
/** The camera's distance from the tree, the field of view, and the frame's height. */
const DISTANCE = 25;
const FOV = 50;
const HEIGHT = 180;
/** The pixel difference that counts as a moved pixel: a seventh of full scale. */
const MOVED = 0.12;
const WIDTH = 320;

const oak = builtInSpecies('oak');
if (!oak) throw new Error('the built-in set has no oak');
const asset = generatePlant(oak, { seed: 3, variant: 0 });
const error = asset.levels[1]?.error as number;
const crownRadius =
	Math.hypot(asset.crown.center[0], asset.crown.center[1], asset.crown.center[2]) +
	asset.crown.radius;
/** The rule's factor for one unit of error: the render height times P[1][1], over two. */
const factor = (HEIGHT * (1 / Math.tan((FOV * Math.PI) / 360))) / 2;
/** The camera's distance to the nearest point of the tree's bounding sphere. */
const near = Math.hypot(asset.crown.center[1], DISTANCE) - crownRadius;
/** The threshold at which the first lower level's switch lies at the camera. */
const split = (error * factor) / near;
/** The thresholds either side of it: the first keeps the base level, the second switches it out. */
const THRESHOLDS = [split * 0.995, split * 1.005];

const frame = (data: Uint8Array) => ({ width: WIDTH, height: HEIGHT, data });

/** One frame of the switch page at a level threshold, with the morph on or off. */
async function draw(
	page: import('@playwright/test').Page,
	tier: (typeof TIERS)[number],
	threshold: number,
	morph: 'on' | 'off',
): Promise<Uint8Array> {
	const [run] = imageRuns([
		{
			name: `leaf-switch-${morph}-${threshold.toFixed(4)}`,
			sketch: `${SKETCH}?distance=${DISTANCE}&threshold=${threshold}&morph=${morph}`,
			hold: 1,
			tiers: [tier],
		},
	]);
	if (!run) throw new Error('the switch test has a run on its tier');
	const result = await loadResult(page, run.path, 180_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
}

const share = (a: Uint8Array, b: Uint8Array) => compareImages(frame(a), frame(b), MOVED).share;

for (const tier of TIERS)
	test(`a leaf-card level hands over without a pop on ${tier}`, async ({ page }) => {
		// Two thresholds, each with the morph off and on, and the software GPU is slow.
		test.setTimeout(420_000);
		const [before, after] = THRESHOLDS as [number, number];
		const off = [await draw(page, tier, before, 'off'), await draw(page, tier, after, 'off')];
		const on = [await draw(page, tier, before, 'on'), await draw(page, tier, after, 'on')];
		const pop = share(off[0] as Uint8Array, off[1] as Uint8Array);
		const morphed = share(on[0] as Uint8Array, on[1] as Uint8Array);
		const distinct = share(on[0] as Uint8Array, off[0] as Uint8Array);
		console.log(
			`leaf switch on ${tier}: the cards move ${percent(pop)} of the frame from threshold ${before.toFixed(3)} to ${after.toFixed(3)} with the morph off, and ${percent(morphed)} with it on; the two states differ by ${percent(distinct)}`,
		);
		// The switch shows with the morph off, and the morph removes most of the change.
		expect(pop).toBeGreaterThan(0.002);
		expect(morphed).toBeLessThan(pop * 0.5);
		// The morph draws the cards differently from the plain material.
		expect(distinct).toBeGreaterThan(0.0005);
	});
