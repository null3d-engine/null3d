// Bark relief lit along each limb, on every GPU path. `plant-bark-frame-sketch.ts` draws one limb
// whose bark normal map holds ridges along it, standing and lying, with the sun turned with it. The
// plant shader builds the bark's frame from the limb's own texture coordinates, so the lying
// picture turned back a quarter turn is the standing one. A frame from the world's up would light
// the lying limb's ridges from another side, and the two would differ across the whole limb.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { BARK_FRAME } from '../pages/lib/plant-bark-frame.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/plant-bark-frame-sketch.ts';
const SIZE = BARK_FRAME.size;

/** Draws one picture of the sketch with `query`, as its RGBA bytes. */
async function draw(page: Page, tier: Tier, query: string): Promise<Uint8Array> {
	const [run] = imageRuns([
		{
			name: `plant-bark-frame-${query.replaceAll(/[=&]/g, '-')}`,
			sketch: `${SKETCH}?${query}`,
			hold: 0,
			tiers: [tier],
			size: [SIZE, SIZE],
			// The first page of a run compiles the plant shader's builds.
			timeoutSeconds: 400,
		},
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
}

const luma = (pixels: Uint8Array, at: number) =>
	0.2126 * (pixels[at] as number) +
	0.7152 * (pixels[at + 1] as number) +
	0.0722 * (pixels[at + 2] as number);

/**
 * The limb's pixels in the standing picture, two pixels in from its outline, with the pixel of the
 * lying picture that the quarter turn takes each to.
 */
function pairs(standing: Uint8Array, lying: Uint8Array): [number, number][] {
	const drawn = (pixels: Uint8Array, x: number, y: number) => luma(pixels, (y * SIZE + x) * 4) > 2;
	const out: [number, number][] = [];
	for (let y = 2; y < SIZE - 2; y++)
		for (let x = 2; x < SIZE - 2; x++) {
			let inside = true;
			for (let dy = -2; dy <= 2 && inside; dy++)
				for (let dx = -2; dx <= 2 && inside; dx++)
					if (!drawn(standing, x + dx, y + dy)) inside = false;
			if (!inside) continue;
			// A quarter turn about the view's axis takes column x, row y to column y, row SIZE-1-x.
			const turned = ((SIZE - 1 - x) * SIZE + y) * 4;
			if (luma(lying, turned) > 2) out.push([(y * SIZE + x) * 4, turned]);
		}
	return out;
}

/** The mean difference in brightness between paired pixels, in steps of 255. */
function meanDifference(a: Uint8Array, b: Uint8Array, at: readonly [number, number][]): number {
	let sum = 0;
	for (const [p, q] of at) sum += Math.abs(luma(a, p) - luma(b, q));
	return sum / Math.max(1, at.length);
}

for (const tier of TIERS)
	test(`bark relief lights along a lying limb as along a standing one on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(600_000);
		const standing = await draw(page, tier, 'pose=standing&relief=ridges');
		const lying = await draw(page, tier, 'pose=lying&relief=ridges');
		const flat = await draw(page, tier, 'pose=standing&relief=flat');
		const turned = pairs(standing, lying);
		const same = pairs(standing, standing);
		// The limb covers a fifth of the picture.
		expect(turned.length).toBeGreaterThan(SIZE * SIZE * 0.1);
		const drift = meanDifference(standing, lying, turned);
		// The ridges show: the relief moves the picture far more than the turn does.
		const relief = meanDifference(standing, flat, same);
		console.log(
			`plant bark frame ${tier}: turned ${drift.toFixed(2)}, relief ${relief.toFixed(2)}`,
		);
		expect(relief).toBeGreaterThan(8);
		expect(drift).toBeLessThan(relief * 0.1);
	});
