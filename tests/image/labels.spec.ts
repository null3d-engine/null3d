// HTML labels follow the frame on screen. The sketch's camera rolls a fixed step each frame, with a
// label on a box off the view's center, and the page samples the label's element in each frame it
// shows. The element must sit within one pixel of the box's place in the frame whose labels it
// shows, in every thread mode. In pipelined modes the sketch records a frame ahead of the one on
// screen, and a roll moves the box several pixels, so a label placed from the frame being recorded
// would fail. In hold mode, the element must sit within one pixel of the center of the box's pixels
// in the drawn frame, as three.js's CSS2DRenderer places a label over its object.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Samples {
	/** The frame whose labels the element showed, then its x and y, for each sample. */
	samples: number[];
	/** The engine's frame number, then the box's x and y, for each frame the sketch recorded. */
	places: number[];
}

/** How far the element may sit from the box, in CSS pixels. */
const TOLERANCE = 1;
/** The box moves at least this far between frames while the camera rolls, in CSS pixels. */
const MIN_STEP = 3;

for (const mode of ENGINE_MODES)
	test(`a label follows the frame on screen while the camera turns fast, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`labels.html?${mode.query}`);
		const result = await pageResult<{ ok: boolean; error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		const { samples, places } = (await page.evaluate(
			() => (globalThis as { labels?: () => Promise<Samples> }).labels?.() as Promise<Samples>,
		)) as Samples;
		const placeOf = new Map<number, [number, number]>();
		for (let k = 0; k < places.length; k += 3)
			placeOf.set(places[k] as number, [places[k + 1] as number, places[k + 2] as number]);
		let checked = 0;
		for (let k = 0; k < samples.length; k += 3) {
			const frame = samples[k] as number;
			const place = placeOf.get(frame);
			const next = placeOf.get(frame + 1);
			// The setup's frames hold no sketch code, so the sketch has no place for them.
			if (!place || !next) continue;
			expect(Math.abs((samples[k + 1] as number) - place[0])).toBeLessThanOrEqual(TOLERANCE);
			expect(Math.abs((samples[k + 2] as number) - place[1])).toBeLessThanOrEqual(TOLERANCE);
			// The next frame's place is far away, so the check tells the frames apart.
			expect(Math.hypot(next[0] - place[0], next[1] - place[1])).toBeGreaterThan(MIN_STEP);
			checked++;
		}
		expect(checked).toBeGreaterThan(30);
	});

test('a label sits over the center of its object in the drawn frame', async ({ page }) => {
	await page.goto('labels.html?hold=0.5');
	const result = await pageResult<{
		ok: boolean;
		error?: string;
		label: [number, number] | null;
		pixels: number;
		center: [number, number] | null;
	}>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.pixels).toBeGreaterThan(50);
	const { label, center } = result;
	expect(label).not.toBeNull();
	expect(center).not.toBeNull();
	expect(Math.abs((label?.[0] as number) - (center?.[0] as number))).toBeLessThanOrEqual(TOLERANCE);
	expect(Math.abs((label?.[1] as number) - (center?.[1] as number))).toBeLessThanOrEqual(TOLERANCE);
});
