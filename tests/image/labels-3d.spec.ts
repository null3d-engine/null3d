// A label that is a plane of the scene: its element must be placed as three.js's CSS3DRenderer
// places a CSS3DObject's or a CSS3DSprite's, and it must follow the frame on screen. In hold mode the
// page draws the same scene in both engines, and each element's box must match. Otherwise the
// camera rolls a fixed step each frame, and a card that faces the camera must sit over the place
// that the sketch gives for the frame whose labels it shows, in every thread mode.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Boxes {
	/** Each element's x, y, width and height, in CSS pixels. */
	mine: { plate: number[]; face: number[] };
	theirs: { plate: number[]; face: number[] };
}

interface Samples {
	/** The frame whose labels the element showed, then its x and y, for each sample. */
	samples: number[];
	/** The engine's frame number, then the card's x and y, for each frame the sketch recorded. */
	places: number[];
}

/** How far an element may sit from three.js's, in CSS pixels. */
const TOLERANCE = 1.5;
/**
 * How far the element may sit from the card's place in its frame, in CSS pixels. The element's box
 * comes from the browser composing the container's transform with the element's, so a reading can
 * differ from the sketch's place by a fraction of the card's move between two frames.
 */
const PLACE_TOLERANCE = 2;
/** The card moves at least this far between frames while the camera rolls, in CSS pixels. */
const MIN_STEP = 3;

test("a 3D label's element sits where three.js's CSS3DRenderer puts it", async ({ page }) => {
	await page.goto('labels-3d.html?hold=1');
	const result = await pageResult<Boxes & { ok: boolean; error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	for (const id of ['plate', 'face'] as const) {
		const mine = result.mine[id] as number[];
		const theirs = result.theirs[id] as number[];
		// The card covers pixels, so its size shows that both engines drew an element there.
		expect(mine[2] as number).toBeGreaterThan(10);
		expect(mine[3] as number).toBeGreaterThan(10);
		for (let k = 0; k < 4; k++)
			expect(
				Math.abs((mine[k] as number) - (theirs[k] as number)),
				`${id} ${['x', 'y', 'width', 'height'][k]} against three.js's`,
			).toBeLessThanOrEqual(TOLERANCE);
	}
});

for (const mode of ENGINE_MODES)
	test(`a 3D label follows the frame on screen while the camera turns fast, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`labels-3d.html?${mode.query}`);
		const result = await pageResult<{ ok: boolean; error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		const { samples, places } = (await page.evaluate(
			() => (globalThis as { labels3d?: () => Promise<Samples> }).labels3d?.() as Promise<Samples>,
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
			expect(Math.abs((samples[k + 1] as number) - place[0])).toBeLessThanOrEqual(PLACE_TOLERANCE);
			expect(Math.abs((samples[k + 2] as number) - place[1])).toBeLessThanOrEqual(PLACE_TOLERANCE);
			// The next frame's place is far away, so the check tells the frames apart.
			expect(Math.hypot(next[0] - place[0], next[1] - place[1])).toBeGreaterThan(MIN_STEP);
			checked++;
		}
		expect(checked).toBeGreaterThan(30);
	});
