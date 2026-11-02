// A reflection stays with what it mirrors on a moving camera: it changes in the same frame as the
// scene above it, on every GPU path. A live page's camera jumps each half second, and the test
// records the canvas frame by frame. The same page with the reflection drawn once in four frames
// shows the lag, so the measure sees the fault.
import { expect, type Page, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** The share of the frame's height from which the water holds the reflection alone. */
const WATER_FROM = 0.6;
/** The share of a jump's change in the water that may still arrive in the frames after it. */
const MOST_LATE = 0.25;

/** The frames of the live page over two seconds, as the browser's screencast gives them. */
async function record(page: Page, query: string) {
	// A software WebGPU draws this water too slowly at the viewport's size to give the frames that
	// a jump takes, so the page draws small: the change across a jump still shows at this size.
	await page.setViewportSize({ width: 480, height: 270 });
	await page.goto(`reflection-lag.html?${query}`);
	await page.waitForFunction('globalThis.__ready === true', undefined, { timeout: 60_000 });
	await page.waitForTimeout(1000);
	// A WebGPU canvas that has not been composed since the page opened gives the screencast no
	// frame, however many animation frames the page takes. A screenshot takes one, and the
	// screencast then follows the canvas's frames.
	await page.screenshot();
	const session = await page.context().newCDPSession(page);
	const frames: string[] = [];
	session.on('Page.screencastFrame', (event) => {
		frames.push(event.data);
		void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
	});
	await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
	await page.waitForTimeout(4000);
	await session.send('Page.stopScreencast');
	return frames.map((frame) => decodePngRgba(Buffer.from(frame, 'base64'), 'a frame'));
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
	const steps = Math.max(...above);
	let worst = 0;
	let jumps = 0;
	for (let k = 1; k + 5 < above.length; k++) {
		if ((above[k] as number) < steps / 2 || (above[k - 1] as number) >= steps / 2) continue;
		jumps++;
		const late = Math.max(...water.slice(k + 1, k + 5));
		worst = Math.max(worst, late / Math.max(water[k] as number, 1e-3));
	}
	expect(jumps).toBeGreaterThan(0);
	return worst;
}

for (const [path, query] of [
	['WebGPU', 'gpu=webgpu'],
	['compatibility mode', 'gpu=compat'],
	['WebGL2', 'gpu=webgl2'],
] as const)
	test(`a reflection changes in the frame of the camera's move on ${path}`, async ({ page }) => {
		test.setTimeout(120_000);
		const late = lateShare(await record(page, query));
		console.log(`late share on ${path}: ${late.toFixed(3)}`);
		expect(late).toBeLessThan(MOST_LATE);
	});

test('the measure sees a reflection that lags', async ({ page }) => {
	test.setTimeout(120_000);
	const late = lateShare(await record(page, 'gpu=webgpu&every=4'));
	console.log(`late share with a lag: ${late.toFixed(3)}`);
	expect(late).toBeGreaterThan(MOST_LATE);
});
