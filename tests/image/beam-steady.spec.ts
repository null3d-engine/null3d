// A headlight beam in still fog must hold still. The owner saw the showroom's beam flicker, and the
// volumetric fog's light step was the cause: each cell sampled a point that moved with a sixteen
// frame cycle, and the blend with the last frame's grid kept enough weight on the new sample that
// the whole lit fog pulsed at the cycle's rate. A cell now keeps its own point, hashed from its
// place, so a still camera draws the same fog every frame. The test records the frames that the
// browser presents, as showroom-steady.spec.ts does, because a capture that draws the frame again
// would move the fog's own history. The page starts with ?still-camera=off, since the engine's
// still-camera accumulation would average the pulse away.
import { expect, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** The canvas, which fills the window, so a share of the frame is a share of the canvas. */
const WIDTH = 480;
const HEIGHT = 300;
/** The share of the canvas over the beam: the lit fog in front of the head lamps. */
const BOX = [0.42, 0.48, 0.98, 0.78] as const;
/** The most that the box's mean luminance may move across the recorded frames, in levels of 255. */
const MEAN_SWING = 0.5;
/** The most that one pixel may move, in levels of 255, for the frames to count as still. */
const PIXEL = 3;
/** The share of the box's pixels that may move more than that. */
const SHARE = 0.01;
/** The frames the page draws before the capture starts, so the blend's history settles. */
const SETTLE_FRAMES = 40;
/** How long the settle may take on a software GPU, where a frame can take seconds. */
const SETTLE_MS = 60_000;
/** The frames wanted before the capture stops early, and the least that a capture must give. */
const WANTED = 24;
const LEAST = 12;
/** How long the capture may take on a software GPU, where a frame can take seconds. */
const CAPTURE_MS = 60_000;

/** The luminance of a pixel, from its red, green and blue levels. */
function luminance(data: Uint8Array, at: number): number {
	return 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
}

/** The box's pixel bounds in a canvas of `width` and `height`. */
function boxOf(width: number, height: number) {
	const x0 = Math.floor(BOX[0] * width);
	const x1 = Math.floor(BOX[2] * width);
	const y0 = Math.floor(BOX[1] * height);
	const y1 = Math.floor(BOX[3] * height);
	return { x0, x1, y0, y1 };
}

test('the headlight beam holds still in the volumetric fog', async ({ page, context }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: WIDTH, height: HEIGHT });
	await page.goto(`/tests/pages/beam-steady.html?still-camera=off&size=${WIDTH}x${HEIGHT}`);
	await page.waitForFunction(
		() => (globalThis as { __null3dEngine?: unknown }).__null3dEngine !== undefined,
		null,
		{ timeout: 180_000 },
	);
	const framesDrawn = await page.evaluate(
		async ({ limit, ms }) => {
			const engine = (
				globalThis as {
					__null3dEngine?: {
						firstFrame?: Promise<unknown>;
						measure(s: number): Promise<{ frames: number }>;
					};
				}
			).__null3dEngine;
			if (!engine) return 0;
			await engine.firstFrame;
			const started = performance.now();
			let frames = 0;
			while (frames < limit && performance.now() - started < ms) {
				const slice = await engine.measure(0.5);
				frames += slice.frames;
			}
			return frames;
		},
		{ limit: SETTLE_FRAMES, ms: SETTLE_MS },
	);

	const frames: string[] = [];
	const session = await context.newCDPSession(page);
	session.on('Page.screencastFrame', async (event) => {
		frames.push(event.data as string);
		await session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
	});
	await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
	const deadline = Date.now() + CAPTURE_MS;
	while (frames.length < WANTED && Date.now() < deadline) await page.waitForTimeout(100);
	await session.send('Page.stopScreencast');

	const drawn = frames.map((base64) =>
		decodePngRgba(Buffer.from(base64, 'base64'), 'a screencast frame'),
	);
	// The last frames alone: a slow device may not have drawn enough settle frames, and its blend's
	// last steps would show in the first frames the capture holds.
	const sample = drawn.slice(Math.floor(drawn.length / 2));
	const { width, height } = drawn[0] ?? { width: 0, height: 0 };
	const { x0, x1, y0, y1 } = boxOf(width, height);
	const means = sample.map((frame) => {
		let sum = 0;
		let count = 0;
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++) {
				sum += luminance(frame.data, (y * width + x) * 4);
				count++;
			}
		return sum / count;
	});
	let moved = 0;
	let count = 0;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const at = (y * width + x) * 4;
			let least = 255;
			let most = 0;
			for (const frame of sample) {
				const value = luminance(frame.data, at);
				least = Math.min(least, value);
				most = Math.max(most, value);
			}
			if (most - least > PIXEL) moved++;
			count++;
		}
	const swing = Math.max(...means) - Math.min(...means);
	const share = moved / Math.max(1, count);
	console.log(
		`the beam over the last ${sample.length} of ${drawn.length} frames, after ${framesDrawn} of ${SETTLE_FRAMES} settle frames: ` +
			`mean swing ${swing.toFixed(2)} of ${MEAN_SWING}, ` +
			`${(100 * share).toFixed(1)}% of pixels moved more than ${PIXEL} of ${(100 * SHARE).toFixed(1)}%`,
	);
	expect(framesDrawn).toBeGreaterThan(0);
	expect(drawn.length).toBeGreaterThanOrEqual(LEAST);
	expect(swing).toBeLessThanOrEqual(MEAN_SWING);
	expect(share).toBeLessThanOrEqual(SHARE);
});
