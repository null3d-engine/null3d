// Rays from clicks follow the frame on screen. The sketch's camera turns a fixed step each frame,
// and Playwright clicks the canvas's center during the pan. A ray through the click must have the
// turn of the frame that was on screen at the click, in every thread mode. In pipelined modes that
// frame is older than the one the sketch's current camera holds, so the test can tell the two apart.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Click {
	/** The sketch frame that read the click. */
	frame: number;
	/** The sketch frame that was on screen at the click's event. */
	shown: number;
	/** The turns about the vertical axis of the ray through the click, and of one beside it. */
	turn: number;
	besideTurn: number;
}

interface Clicks {
	step: number;
	clicks: Click[];
}

/** The canvas's center, in CSS pixels from the page's top-left corner. */
const CENTER = { x: 160, y: 90 };
const CLICKS = 8;
/** The frames whose cameras the engine keeps. */
const KEPT_FRAMES = 4;
/** How far a turn may stray: well under one frame's step, well over rounding. */
const TURN_TOLERANCE = 1e-4;
/** The ray beside the click passes half a pixel to the right, about 0.003 radians off the center. */
const BESIDE_TOLERANCE = 0.01;

/** The difference of two turns, in radians from -pi to pi. */
const turnDifference = (a: number, b: number) => {
	const d = (a - b) % (2 * Math.PI);
	return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
};

for (const mode of ENGINE_MODES)
	test(`a ray from a click during a fast pan uses the frame on screen, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`screen-rays.html?${mode.query}`);
		const result = await pageResult<{ ok: boolean; error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		const read = () =>
			page.evaluate(
				() =>
					(globalThis as { screenRays?: () => Promise<Clicks> }).screenRays?.() as Promise<Clicks>,
			);
		for (let k = 1; k <= CLICKS; k++) {
			await page.mouse.click(CENTER.x, CENTER.y);
			await expect.poll(async () => (await read()).clicks.length).toBe(k);
		}
		const { step, clicks } = await read();
		for (const click of clicks) {
			// The click's ray turns with the frame on screen, which the camera ring still holds.
			expect(click.shown).toBeGreaterThanOrEqual(click.frame - KEPT_FRAMES);
			expect(click.shown).toBeLessThan(click.frame);
			expect(turnDifference(click.turn, click.shown * step)).toBeLessThan(TURN_TOLERANCE);
			// Any other point uses the camera of the frame that last ran.
			expect(turnDifference(click.besideTurn, (click.frame - 1) * step)).toBeLessThan(
				BESIDE_TOLERANCE,
			);
		}
		const behind = clicks.filter((click) => click.shown < click.frame - 1).length;
		if (mode.latency === 'pipelined') {
			// The sketch runs a frame ahead of the one on screen, so the current camera would miss.
			expect(behind).toBeGreaterThan(0);
		} else {
			// These modes draw each frame as they record it, so the click names the frame before.
			expect(behind).toBe(0);
		}
	});
