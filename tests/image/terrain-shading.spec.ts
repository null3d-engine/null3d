// Terrain shading in a live engine: the normals that the add-on bakes over the ground, and the
// height that each layer of its surface carries. The terrain image test draws the same scene with
// both features, so each draw here is compared with the same scene without the feature: a picture
// that moves this much could not match the reference, and a switch that the sketch never reads
// leaves the two pictures equal, which fails too.
//
// The normals are drawn at the Low preset. Low's level-of-detail threshold picks coarser blocks
// than High, which is where a block's own vertices lose the far hills' relief.
import { expect, test } from '@playwright/test';
import type { Tier } from '../../bench/lib/parity.ts';
import { compareImages, percent, TOLERANCE } from '../../packages/cli/src/compare.js';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

const WIDTH = 320;
const HEIGHT = 180;

/**
 * The pixels that one load of the terrain test draws with these switches and preset. The switches
 * join the sketch's own query, which the page passes to the module.
 */
async function draw(
	page: import('@playwright/test').Page,
	tier: Tier,
	switches: string,
	preset: string,
): Promise<Uint8Array> {
	const url = new URL(manifestRun('terrain', tier, 'pipelined').path, 'http://localhost');
	url.searchParams.set('preset', preset);
	const sketch = url.searchParams.get('sketch') ?? '';
	url.searchParams.set('sketch', `${sketch}${sketch.includes('?') ? '&' : '?'}${switches}`);
	const result = await loadResult(page, `${url.pathname}${url.search}`, 90_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const data = new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
	expect(data.length).toBe(WIDTH * HEIGHT * 4);
	return data;
}

/** The share of two pictures that differs past the image tests' own threshold. */
function share(a: Uint8Array, b: Uint8Array): number {
	const image = (data: Uint8Array) => ({ width: WIDTH, height: HEIGHT, data });
	return compareImages(image(a), image(b), TOLERANCE.threshold).share;
}

/** The upper half of a picture, where the far hills stand, as a picture of its own. */
function farHills(data: Uint8Array): { width: number; height: number; data: Uint8Array } {
	const rows = Math.floor(HEIGHT / 2);
	return { width: WIDTH, height: rows, data: data.subarray(0, WIDTH * rows * 4) };
}

/** The share of the two pictures' far hills that differs past the image tests' own threshold. */
function farShare(a: Uint8Array, b: Uint8Array): number {
	return compareImages(farHills(a), farHills(b), TOLERANCE.threshold).share;
}

for (const tier of ['webgpu', 'compat', 'webgl2'] as const)
	test(`terrain shading shows its baked normals and height blending on ${tier}`, async ({
		page,
	}) => {
		// Four loads of the terrain scene per tier, and the software GPU draws each slowly.
		test.setTimeout(420_000);
		const baked = await draw(page, tier, 'normals=baked', 'low');
		const vertex = await draw(page, tier, 'normals=vertex', 'low');
		const normals = share(baked, vertex);
		const hills = farShare(baked, vertex);
		const blended = await draw(page, tier, 'blend=on', 'high');
		const flat = await draw(page, tier, 'blend=off', 'high');
		const layers = share(blended, flat);
		console.log(
			`terrain shading on ${tier}: normals move ${percent(normals)} of the frame and ${percent(hills)} of the far hills, height blending ${percent(layers)}`,
		);
		// The image tests allow one tenth of one percent of the pixels to differ.
		expect(normals).toBeGreaterThan(TOLERANCE.maxDiffRatio);
		expect(hills).toBeGreaterThan(TOLERANCE.maxDiffRatio);
		expect(layers).toBeGreaterThan(TOLERANCE.maxDiffRatio);
	});
