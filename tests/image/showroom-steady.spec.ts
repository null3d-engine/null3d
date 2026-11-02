// The showroom's lit floor must hold still. The owner saw the light pool on the road flicker frame
// to frame, and the cause was the engine's rectangle area lights: a light that already sat at its
// target strength stepped one frame's step away from it and back again, for ever, so every lit
// surface in the scene pulsed by one eighth of the area lights' light on every frame. This test
// holds the demo's camera still and measures the floor on consecutive frames as the browser presents
// them, not through the engine's own reader, which draws a frame again and hides the fault.
import { expect, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** The share of the canvas to measure, of its width and height: the lit floor before the car. */
const BOX = [0.3, 0.7, 0.6, 0.95] as const;
/** The most that the floor's mean luminance may move across the frames, in levels of 255. */
const LIMIT = 2;
/**
 * How much more a frame may step from the one before it than from the one two before: an image that
 * alternates frame to frame steps about twice as far between neighbours as across two frames, while
 * a scene that drifts steps the same both ways. The fade's alternation measured about thirty times
 * on this view, and the same view with the fade steady measured under one.
 */
const ALTERNATION = 1.5;
/** The least step that counts as movement at all, so a still image's rounding does not divide out. */
const FLOOR = 0.05;
/** The frames wanted before the capture stops early, and the least that a capture must give. */
const WANTED = 24;
const LEAST = 8;
/** How long the capture may take on a software GPU, where a frame can take seconds. */
const CAPTURE_MS = 30_000;

/** The mean luminance of the box, from the canvas pixels of one frame. */
function meanOf(data: Uint8Array, width: number, height: number): number {
	const x0 = Math.floor(BOX[0] * width);
	const x1 = Math.floor(BOX[2] * width);
	const y0 = Math.floor(BOX[1] * height);
	const y1 = Math.floor(BOX[3] * height);
	let sum = 0;
	let count = 0;
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const at = (y * width + x) * 4;
			sum += 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
			count++;
		}
	return sum / count;
}

test('the showroom floor holds still on a still camera', async ({ page, context }) => {
	test.setTimeout(300_000);
	await page.goto('/examples/?demo=showroom&bench');
	await page.waitForFunction(
		() => (globalThis as { __null3dEngine?: unknown }).__null3dEngine !== undefined,
		null,
		{ timeout: 180_000 },
	);
	await page.evaluate(async () => {
		const engine = (globalThis as { __null3dEngine?: { firstFrame?: Promise<unknown> } })
			.__null3dEngine;
		await engine?.firstFrame;
	});
	// The Manual camera holds the view where the route has it, and the route's first shot holds the
	// opening view for three seconds, so the press lands on that view.
	await page.keyboard.press('c');
	await page.waitForTimeout(600);

	const frames: string[] = [];
	const session = await context.newCDPSession(page);
	session.on('Page.screencastFrame', async (event) => {
		frames.push(event.data as string);
		await session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
	});
	await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
	const deadline = Date.now() + CAPTURE_MS;
	while (frames.length < WANTED && Date.now() < deadline) await page.waitForTimeout(250);
	await session.send('Page.stopScreencast');

	const means = frames.map((base64) => {
		const frame = decodePngRgba(Buffer.from(base64, 'base64'), 'a screencast frame');
		return meanOf(frame.data, frame.width, frame.height);
	});
	const swing = Math.max(...means) - Math.min(...means);
	let step = 0;
	let across = 0;
	for (let at = 0; at + 1 < means.length; at++) step += Math.abs(means[at + 1]! - means[at]!);
	for (let at = 0; at + 2 < means.length; at++) across += Math.abs(means[at + 2]! - means[at]!);
	const apart = step / (means.length - 1);
	const twoApart = across / Math.max(1, means.length - 2);
	console.log(
		`the showroom floor over ${means.length} frames: mean ${(
			means.reduce((a, b) => a + b, 0) / means.length
		).toFixed(2)}, swing ${swing.toFixed(2)} of ${LIMIT}, step ${apart.toFixed(
			3,
		)} against ${twoApart.toFixed(3)} two frames apart`,
	);
	expect(means.length).toBeGreaterThanOrEqual(LEAST);
	expect(swing).toBeLessThanOrEqual(LIMIT);
	expect(apart).toBeLessThanOrEqual(Math.max(FLOOR, ALTERNATION * twoApart));
});
