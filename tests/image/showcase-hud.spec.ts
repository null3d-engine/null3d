// The showcase controls HUD names every change in a toast at the top centre of the view. Playwright
// opens the night town's HUD, picks a button in each group, and checks the toast's text
// ([D-171](../../.dev/decisions/D-171-showcase-controls-hud.md), owner, 14 October 2026). A toast
// alone cannot show that a change took: the stage writes the sky, the fog and the environment light
// every frame, and once undid each switch a frame after the toast named it. So the test also reads
// the canvas, and checks that each part stays off while it is off and comes back when it turns on.
import { expect, type Page, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';
import { watchPageProblems } from '../lib/page-result.ts';

/** The panel of a group, by the group's name in the model. */
const panel = (page: Page, name: string) => page.locator(`#hud-panel-${name}`);
/** The six picks, the startup and the slow software GPU need longer than the default limit. */
test.describe.configure({ timeout: 180_000 });

/**
 * Picks a button of a group and checks the toast that names the change: selects the group's tab,
 * then clicks the button, and reads the toast.
 */
async function pick(
	page: Page,
	tab: string,
	group: string,
	button: string,
	text: string,
): Promise<void> {
	await page.getByRole('tab', { name: tab }).click();
	await panel(page, group).getByRole('button', { name: button }).click();
	// A frame on the software GPU can take a while, and the toast shows for 2 s, so allow for it.
	const toast = page.locator('.hud__toast');
	await expect(toast).toHaveClass(/\bshow\b/, { timeout: 20_000 });
	await expect(toast).toHaveText(text, { timeout: 20_000 });
}

/** One frame of the canvas: its size and its RGBA pixels, top row first. */
interface Frame {
	width: number;
	height: number;
	data: Uint8Array;
}

/** The canvas as the scene draws it, with the HUD, the toast, the tips and the stats hidden. */
async function frame(page: Page): Promise<Frame> {
	const png = await page.locator('main.stage > canvas').screenshot({
		omitBackground: true,
		style: 'main.stage :not(canvas) { visibility: hidden !important; }',
	});
	return decodePngRgba(png, 'the canvas');
}

/** The mean difference of two frames' colour, in steps of 255, over every pixel and channel. */
function difference(a: Frame, b: Frame): number {
	let sum = 0;
	for (let i = 0; i < a.data.length; i += 4)
		for (let c = 0; c < 3; c++)
			sum += Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
	return sum / ((a.data.length / 4) * 3);
}

/** A mean difference that only a change of the look gives; the scene at rest differs less. */
const CHANGED = 1.5;
/** A mean difference below which the canvas counts as still, over a settled look. */
const STILL = 0.5;
/** Frames read after a switch: the old bug rewrote the part a frame later, so several are read. */
const FRAMES = 4;

/** Waits until two frames in a row differ by less than a change the checks could mistake for one. */
async function settle(page: Page): Promise<void> {
	let previous = await frame(page);
	for (let k = 0; k < 40; k++) {
		await new Promise((r) => setTimeout(r, 250));
		const next = await frame(page);
		if (difference(next, previous) < STILL) return;
		previous = next;
	}
}

/**
 * Turns a part of the look off and on through the HUD, and checks the canvas: while the part is off,
 * each of several frames differs from the frame with it on, and once it turns on, the look returns.
 */
async function switchPart(page: Page, label: string, tab: string, group: string): Promise<void> {
	// The look eases and the camera settles, so the frame with the part on is read when it is still.
	await settle(page);
	const before = await frame(page);
	await pick(page, tab, group, label, `${label}: off`);
	await expect
		.poll(async () => difference(await frame(page), before), { timeout: 20_000 })
		.toBeGreaterThan(CHANGED);
	for (let k = 0; k < FRAMES; k++)
		expect(difference(await frame(page), before), `${label} stays off`).toBeGreaterThan(CHANGED);
	await pick(page, tab, group, label, `${label}: on`);
	await expect
		.poll(async () => difference(await frame(page), before), { timeout: 20_000 })
		.toBeLessThan(CHANGED);
}

test('the showcase HUD names each group change in a toast at the top centre', async ({ page }) => {
	const errors = watchPageProblems(page);
	// A fresh page, the light preset, so CI's software GPU draws it quickly. The demo builds its
	// own look from code, so the toast text does not depend on the preset.
	await page.goto('/examples/index.html?demo=night-town&preset=low');
	const hud = page.locator('.hud');
	// The sketch posts the HUD once its setup has run, which loads nothing but builds the town.
	await expect(hud).toBeVisible({ timeout: 90_000 });
	await expect(page.getByRole('tab', { name: 'Post' })).toBeVisible();
	// Open the panel, as a visitor does, with the chevron.
	await page.locator('.hud__chevron').click();
	await expect(hud).toHaveClass(/\bopen\b/);

	// Camera is a radio group: a pick names the group and the new mode.
	await pick(page, 'Camera', 'camera', 'Manual', 'camera: manual');
	// The toast sits at the top centre of the stage, where the scene draws.
	const stage = await page.locator('main.stage').boundingBox();
	const toast = await page.locator('.hud__toast').boundingBox();
	expect(stage).not.toBeNull();
	expect(toast).not.toBeNull();
	expect(
		Math.abs(
			(toast?.x ?? 0) + (toast?.width ?? 0) / 2 - ((stage?.x ?? 0) + (stage?.width ?? 0) / 2),
		),
	).toBeLessThan(3);
	expect(toast?.y ?? 0).toBeLessThan(80);

	// Time of day is a radio group too. Its last entry is the studio, which is not an hour: every
	// mood the stage supports is reachable here and checked.
	await pick(page, 'Time of day', 'mood', 'Dawn', 'time of day: dawn');
	await pick(page, 'Time of day', 'mood', 'Studio', 'time of day: studio');
	// Back to an hour, so the switches below are checked against the sky, not the studio backdrop.
	await pick(page, 'Time of day', 'mood', 'Dawn', 'time of day: dawn');
	// Atmosphere, Lighting and Post are toggles: each names the effect, with its label's own case,
	// and its new state. The snow goes off first, so the scene holds still between frames.
	await pick(page, 'Atmosphere', 'atmosphere', 'Snow', 'Snow: off');
	await switchPart(page, 'Sky', 'Atmosphere', 'atmosphere');
	await switchPart(page, 'Fog', 'Atmosphere', 'atmosphere');
	await switchPart(page, 'Environment', 'Lighting', 'lighting');
	await pick(page, 'Lighting', 'lighting', 'Shadows', 'Shadows: off');
	await pick(page, 'Post', 'post', 'Bloom', 'Bloom: on');
	// Quality is a radio group of the presets.
	await pick(page, 'Quality', 'quality', 'Medium', 'quality: medium');

	expect(errors).toEqual([]);
});
