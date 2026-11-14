// A change of grant in the scene's budget of real pieces crosses with a dither, never a pop. The
// near pool may grant one of two pines its pieces; the eye moves from the left one to the right one,
// and the strip draws the same camera before the pool hands out again, at four moments of the
// quarter-second crossfade, and once it has settled. Every frame keeps the plants' pixels (no hole
// where one copy's pieces have gone and its cards have not come), and no step from one frame to the
// next changes more than a stated share of what the whole crossfade changes (no pop).
//
// The frames are written to target/filmstrip/ for the owner to look at. It runs only with
// NULL3D_CROSSFADE_WALK set, on a computer with a GPU of its own: NULL3D_CROSSFADE_WALK=1 bun run
// test:browser -- near-pool-crossfade.spec.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { pageResult } from '../lib/page-result.ts';

test.skip(
	!process.env.NULL3D_CROSSFADE_WALK,
	'set NULL3D_CROSSFADE_WALK to draw the crossfade strip',
);

/** Where the frames go, from the repository the tests run in. */
const OUT = join(process.cwd(), 'target', 'filmstrip');

/** The moments the strip draws: before the hand-out, through the fade, and settled. */
const FADES = ['before', '0', '0.25', '0.5', '0.75', 'after'] as const;

/** The smallest share of its end frames' plant pixels that a frame of the crossfade may keep. */
const KEPT = 0.9;

/** The most of the whole crossfade's change that one step of the strip may make. */
const STEP = 0.6;

/** What the image page publishes: the frame's size and its pixels, base64. */
interface FrameResult {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** A page's frame as 8-bit RGBA pixels. */
async function frame(
	page: import('@playwright/test').Page,
	sketch: string,
): Promise<{ width: number; height: number; data: Uint8Array }> {
	const query = `gpu=webgpu&hold=0&size=640x360&preset=high&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<FrameResult>(page, 90_000);
	expect(result.error).toBeUndefined();
	const data = new Uint8Array(Buffer.from(result.pixels, 'base64'));
	return { width: result.width, height: result.height, data };
}

/** Whether a pixel draws plant: anything above the black background. */
function plant(data: Uint8Array, at: number): boolean {
	return (data[at] as number) > 8 || (data[at + 1] as number) > 8 || (data[at + 2] as number) > 8;
}

/** The plant pixels of a frame. */
function plantPixels(pixels: { data: Uint8Array }): number {
	let count = 0;
	for (let at = 0; at < pixels.data.length; at += 4) if (plant(pixels.data, at)) count++;
	return count;
}

/** The pixels whose colour differs between two frames by more than a little. */
function changed(a: { data: Uint8Array }, b: { data: Uint8Array }): number {
	let count = 0;
	for (let at = 0; at < a.data.length; at += 4) {
		const d =
			Math.abs((a.data[at] as number) - (b.data[at] as number)) +
			Math.abs((a.data[at + 1] as number) - (b.data[at + 1] as number)) +
			Math.abs((a.data[at + 2] as number) - (b.data[at + 2] as number));
		if (d > 24) count++;
	}
	return count;
}

test('a change of grant crosses between pieces and cards with no hole and no pop', async ({
	page,
}) => {
	test.setTimeout(240_000);
	mkdirSync(OUT, { recursive: true });
	const sketch = '/tests/pages/sketches/near-pool-crossfade-sketch.ts';
	page.on('console', (message) => {
		if (message.text().includes('crossfade') || message.type() === 'error')
			console.log(message.text());
	});
	const fixed = await frame(page, `${sketch}?fade=static`);
	writePng(join(OUT, 'near-pool-crossfade-static.png'), fixed);
	const frames: { fade: string; pixels: { width: number; height: number; data: Uint8Array } }[] =
		[];
	for (const fade of FADES) {
		const pixels = await frame(page, `${sketch}?fade=${fade}`);
		writePng(join(OUT, `near-pool-crossfade-${fade}.png`), pixels);
		frames.push({ fade, pixels });
	}
	const first = frames[0]?.pixels as { data: Uint8Array };
	const last = frames.at(-1)?.pixels as { data: Uint8Array };
	const whole = changed(first, last);
	const counts = frames.map((f) => plantPixels(f.pixels));
	const steps = frames
		.slice(1)
		.map((f, k) => changed((frames[k] as { pixels: { data: Uint8Array } }).pixels, f.pixels));
	console.log(
		`a placement with no pool: ${plantPixels(fixed)} plant pixels, ${changed(fixed, frames.at(-1)?.pixels as { data: Uint8Array })} pixels from the settled frame`,
	);
	console.log(
		`plant pixels ${frames.map((f, k) => `${f.fade} ${counts[k]}`).join(', ')}; whole change ${whole}; steps ${steps.join(', ')}`,
	);
	// The grant moved: the settled frame differs from the one before the hand-out.
	expect(whole).toBeGreaterThan(0.002 * (first.data.length / 4));
	// No hole: every frame keeps the plants' pixels.
	const ends = Math.min(counts[0] as number, counts.at(-1) as number);
	for (const [k, count] of counts.entries())
		expect(count, FADES[k]).toBeGreaterThanOrEqual(KEPT * ends);
	// No pop: the change is spread over the fade's steps.
	for (const [k, step] of steps.entries())
		expect(step, `${FADES[k]} to ${FADES[k + 1]}`).toBeLessThanOrEqual(STEP * whole);
});
