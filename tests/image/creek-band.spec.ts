// The water's light-from-behind lookup divides a screen place by the size a shader reads for the
// render target, so a value that reports the canvas sends the sample past the drawn image: on the
// route view at a render scale of three quarters the river goes dark from three quarters of the
// width, with a hard vertical edge there. The band of rows across the river states it: the mean
// brightness right of that edge over the mean left of it. The picture tests of the same view judge
// its look on the machine that drew their references; this measure reads the frame itself, so a
// value that reported the canvas fails here on any machine.
import { expect, type Page, test } from '@playwright/test';
import { environmentNamed, runIn } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import { manifestRun } from './manifest.ts';

/** The rows of the 320 x 279 route picture that hold the river across the frame. */
const ROWS = [160, 180] as const;
/** The column where the drawn image stops at a render scale of three quarters: 75% of 320. */
const EDGE = 240;
/**
 * The least that the river's right side may read against its left. The reference that recorded the
 * fault, which the value that reported the canvas drew, reads 0.462 on this Mac's WebGL2 and 0.389
 * on the software GPU; with the value corrected the references read 0.87 to 0.99 on every path. A
 * hard edge at three quarters of the width is that fault, so a river lit across its width is far
 * from it.
 */
const LEAST_EVENNESS = 0.7;

interface PublishedFrame {
	error?: string;
	width: number;
	pixels: string;
}

/** The held frame that a manifest run draws, as bytes in the order that a page writes them. */
async function imageOf(
	page: Page,
	path: string,
	timeoutMs: number,
): Promise<{ width: number; pixels: Uint8Array }> {
	await page.goto(path);
	const frame = await pageResult<PublishedFrame>(page, timeoutMs);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

/** The mean brightness of the pixels of the band, from column `left` to `right` and rows `top` to `bottom`. */
function brightness(
	{ width, pixels }: { width: number; pixels: Uint8Array },
	left: number,
	right: number,
	top: number,
	bottom: number,
): number {
	let sum = 0;
	let count = 0;
	for (let y = top; y <= bottom; y++)
		for (let x = left; x < right; x++) {
			const at = 4 * (y * width + x);
			sum += ((pixels[at] ?? 0) + (pixels[at + 1] ?? 0) + (pixels[at + 2] ?? 0)) / 3;
			count++;
		}
	return count > 0 ? sum / count : 0;
}

const TIERS = [
	{ tier: 'webgpu', name: 'WebGPU' },
	{ tier: 'compat', name: 'compatibility mode' },
	{ tier: 'webgl2', name: 'WebGL2' },
] as const;

for (const { tier, name } of TIERS)
	test(`the creek's river is lit across its width at a render scale of three quarters on ${name}`, async ({
		page,
	}, testInfo) => {
		// The page draws with the switches of the environment that judges the references, so the
		// software GPU takes the preset that keeps its run short.
		const run = manifestRun('creek-render-scale-route', tier, 'pipelined');
		test.setTimeout(run.timeoutSeconds * 1000 + 30_000);
		const image = await imageOf(
			page,
			runIn(run, environmentNamed(testInfo.project.name)).path,
			run.timeoutSeconds * 1000,
		);
		const left = brightness(image, 0, EDGE, ROWS[0], ROWS[1]);
		const right = brightness(image, EDGE, image.width, ROWS[0], ROWS[1]);
		expect(left, `the river reads ${left.toFixed(1)} left of column ${EDGE}`).toBeGreaterThan(0);
		expect(
			right / left,
			`the river reads ${right.toFixed(1)} right of column ${EDGE} against ${left.toFixed(1)} left of it`,
		).toBeGreaterThan(LEAST_EVENNESS);
	});
