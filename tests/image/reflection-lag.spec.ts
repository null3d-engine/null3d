// A reflection stays with what it mirrors on a moving camera: it changes in the same frame as the
// scene above it, on every GPU path. A live page's camera jumps once every 30 frames it draws, and
// the test records the canvas frame by frame until it holds the frames that the measure needs. The
// same page with the reflection drawn once in four frames shows the lag, so the measure sees the
// fault.
import { expect, type Page, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** The share of the frame's height from which the water holds the reflection alone. */
const WATER_FROM = 0.6;
/** The share of a jump's change in the water that may still arrive in the frames after it. */
const MOST_LATE = 0.25;
/**
 * The distinct rendered frames that a capture needs, and the longest it may take. The sketch jumps
 * the camera once every 30 frames it draws, so 40 distinct frames hold a jump with at least nine
 * transitions after it, and the late measure reads the four frames after a jump. Counting the
 * browser's screencast frames is not enough: it presents the same canvas frame more than once when
 * the software GPU draws slower than the display, so 40 presentations can hold fewer than 30 drawn
 * frames and no jump at all. The capture keeps the frames whose image differs from the one before,
 * which are the drawn frames, and waits until it has 40 of them. A capture that reaches the time
 * limit first still measures, and the missing jump fails the test, which names the fault rather
 * than hiding it.
 */
const WANTED_FRAMES = 40;
const CAPTURE_MS = 180_000;
/** The longest that the page may take to start, which on a software GPU builds every pipeline first. */
const READY_MS = 180_000;

/** The browser's screencast frames of the live page, until it holds the drawn frames the measure needs. */
async function record(page: Page, query: string) {
	await page.goto(`reflection-lag.html?${query}`);
	await page.waitForFunction('globalThis.__ready === true', undefined, { timeout: READY_MS });
	await page.waitForTimeout(1000);
	const session = await page.context().newCDPSession(page);
	const images: string[] = [];
	let presented = 0;
	session.on('Page.screencastFrame', (event) => {
		presented++;
		// The same canvas frame encodes to the same bytes, so a frame that repeats the last distinct
		// image is a presentation of it and not a new drawn frame.
		if (event.data !== images.at(-1)) images.push(event.data);
		void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
	});
	await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
	const started = Date.now();
	while (images.length < WANTED_FRAMES && Date.now() - started < CAPTURE_MS)
		await page.waitForTimeout(100);
	await session.send('Page.stopScreencast');
	console.log(
		`recorded ${images.length} drawn frames of ${presented} presented in ${(
			(Date.now() - started) / 1000
		).toFixed(1)} s`,
	);
	return images.map((frame) => decodePngRgba(Buffer.from(frame, 'base64'), 'a frame'));
}

/** The mean change between two frames over the rows from `from` to `to`, as shares of the height. */
function change(
	a: ReturnType<typeof decodePngRgba>,
	b: ReturnType<typeof decodePngRgba>,
	from: number,
	to: number,
) {
	const { width, height } = a;
	let sum = 0;
	let count = 0;
	for (let y = Math.floor(height * from); y < height * to; y += 2)
		for (let x = 0; x < width; x += 2) {
			const at = (y * width + x) * 4;
			sum += Math.abs((a.data[at] as number) - (b.data[at] as number));
			count++;
		}
	return sum / count;
}

/** How much of each jump's change in the water arrives after the frame of the jump itself, at most. */
function lateShare(frames: ReturnType<typeof decodePngRgba>[]): number {
	const above = frames.slice(1).map((frame, k) => change(frames[k] as never, frame, 0, 0.45));
	const water = frames.slice(1).map((frame, k) => change(frames[k] as never, frame, WATER_FROM, 1));
	// The first transition is where the page's first presented frame arrives, not a camera move.
	// On WebGPU that arrival can change more of the top of the frame than any move does, so it must
	// not set the threshold by which the moves are found.
	const steps = Math.max(...above.slice(1), 0);
	let worst = 0;
	let jumps = 0;
	for (let k = 1; k + 5 < above.length; k++) {
		if ((above[k] as number) < steps / 2 || (above[k - 1] as number) >= steps / 2) continue;
		jumps++;
		const late = Math.max(...water.slice(k + 1, k + 5));
		worst = Math.max(worst, late / Math.max(water[k] as number, 1e-3));
	}
	console.log(
		`top move ${steps.toFixed(2)} at frame ${above.indexOf(steps) + 1}, ` +
			`first transition ${above[0]?.toFixed(2)}, ${jumps} jumps in ${above.length} frames`,
	);
	expect(jumps).toBeGreaterThan(0);
	return worst;
}

for (const [path, query] of [
	['WebGPU', 'gpu=webgpu'],
	['compatibility mode', 'gpu=compat'],
	['WebGL2', 'gpu=webgl2'],
] as const)
	test(`a reflection changes in the frame of the camera's move on ${path}`, async ({ page }) => {
		// The page starts, and then the capture waits for the frames the measure reads.
		test.setTimeout(READY_MS + CAPTURE_MS + 60_000);
		const late = lateShare(await record(page, query));
		console.log(`late share on ${path}: ${late.toFixed(3)}`);
		expect(late).toBeLessThan(MOST_LATE);
	});

test('the measure sees a reflection that lags', async ({ page }) => {
	// The page starts, and then the capture waits for the frames the measure reads.
	test.setTimeout(READY_MS + CAPTURE_MS + 60_000);
	const late = lateShare(await record(page, 'gpu=webgpu&every=4'));
	console.log(`late share with a lag: ${late.toFixed(3)}`);
	expect(late).toBeGreaterThan(MOST_LATE);
});
