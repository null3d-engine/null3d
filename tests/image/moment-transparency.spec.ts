// Moment transparency against the exact image: the five panes of the moment sketch at different
// depths, drawn back to front by the sorted pass (the exact image), by the weighted blending, and
// by the moment layer. The task's acceptance test is that the moment layer is nearer the exact
// image than the weighted blending is, so this compares each approximation's mean channel error
// with the sorted image on every GPU tier.
import { expect, type Page, test } from '@playwright/test';
import type { Tier } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS, MOMENT_SKETCH } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

interface Image {
	width: number;
	pixels: Uint8Array;
}

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

/**
 * The mean difference of two images' color channels, in steps out of 255. The layers cover most of
 * the frame, so the mean over every pixel is the figure that the record's model predicts.
 */
function meanError(a: Image, b: Image): number {
	expect(a.width).toBe(b.width);
	expect(a.pixels.length).toBe(b.pixels.length);
	let total = 0;
	let counted = 0;
	for (let i = 0; i < a.pixels.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			total += Math.abs((a.pixels[i + c] ?? 0) - (b.pixels[i + c] ?? 0));
			counted++;
		}
	}
	return total / counted;
}

/** The pipelined run of a manifest test on a tier. */
function runOf(name: string, tier: Tier) {
	const run = IMAGE_RUNS.find(
		(candidate) =>
			candidate.test === name && candidate.tier === tier && candidate.mode?.name === 'pipelined',
	);
	if (!run) throw new Error(`the manifest has no pipelined run of ${name} on ${tier}`);
	return run;
}

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the moment layer is nearer the sorted image than the weighted blending is, on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		// The sketch must be in the manifest for its runs to exist.
		expect(MOMENT_SKETCH).toContain('moment-sketch');
		const exact = await imageOf(page, runOf('moment-sorted', tier).path);
		const weighted = await imageOf(page, runOf('moment-weighted', tier).path);
		const moment = await imageOf(page, runOf('moment-layer', tier).path);
		const weightedError = meanError(weighted, exact);
		const momentError = meanError(moment, exact);
		console.log(
			`${tier}: weighted ${weightedError.toFixed(3)} against sorted, moment ${momentError.toFixed(3)}`,
		);
		expect(weightedError).toBeGreaterThan(0.5);
		expect(momentError).toBeLessThan(weightedError);
		// A margin, so a layer that draws the weighted blending's own image fails.
		expect(momentError).toBeLessThan(weightedError * 0.9);
	});

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the moment layer draws the same image whatever order the panes add in, on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const forward = await imageOf(page, runOf('moment-layer', tier).path);
		const reverse = await imageOf(page, runOf('moment-layer-reverse', tier).path);
		const difference = meanError(forward, reverse);
		console.log(`${tier}: the two draw orders differ by ${difference.toFixed(3)}`);
		// The store adds floats, whose sums can round in a different order, so a step of one
		// channel here and there is allowed; a layer that mixed its surfaces in the draw order
		// would differ by many times this.
		expect(difference).toBeLessThan(0.5);
	});
