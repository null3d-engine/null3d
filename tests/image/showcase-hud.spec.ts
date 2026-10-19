// The showcase controls HUD names every change in a toast at the top centre of the view. Playwright
// opens the night town's HUD, picks a button in each group, and checks the toast's text
// ([D-171](../../.dev/decisions/D-171-showcase-controls-hud.md), owner, 14 October 2026). A toast
// alone cannot show that a change took: the stage writes the sky, the fog and the environment light
// every frame, and once undid each switch a frame after the toast named it. So the test also reads
// the canvas, and checks that each part stays off while it is off and comes back when it turns on.
import { expect, type Page, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';
import { ALONE } from '../lib/alone.ts';
import { watchPageProblems } from '../lib/page-result.ts';

/** The panel of a group, by the group's name in the model. */
const panel = (page: Page, name: string) => page.locator(`#hud-panel-${name}`);
/**
 * The picks, the startup and the slow software GPU need longer than the default limit. The engine's
 * first frame is part of that, and on a software GPU it arrives long after the controls do, so the
 * budget covers that wait and the switches after it, and the test runs alone.
 *
 * Alone for two reasons. Its pictures need the engine to draw frames, and on CI's two-core runner a
 * heavy test beside it starves this page's frames, which is the fault D-186 measures. And its budget
 * cannot sit in a shard: a shard's limit is 25 minutes, which covers its tests taking twice as long
 * as the median, and this test's failure is exactly a slow machine. Moved out of shard 14, then out
 * of the alone job, which the rest of its tests filled to 21 minutes, this test runs in a job of its
 * own, whose 35 minutes bound its waits. The waits below are sized for a software renderer on a
 * loaded runner: a first frame there took longer than three minutes, and a switch showed no new
 * frame within one. A passing run took 16.4 minutes and a slower one ran out of 18. Its own budget
 * sits under the job's limit, so a page that truly stops drawing still fails by name rather than by
 * the job's clock.
 */
test.describe.configure({ timeout: 1_500_000 });

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

/**
 * The canvas as the scene draws it, read through the demo's engine: the canvas exactly, at its own
 * size, and the controls panel, the toast, the tips, the caption and the stats overlay are page
 * elements, so none of them is in it. The engine publishes itself behind its own `?bench` switch, as
 * it does for a benchmark tool, so the page needs nothing added for a test to read its frames.
 *
 * A browser screenshot cannot serve here. Both ways of taking one wait on the browser's own frame
 * work: an element's picture waits for its box to hold still across two of the page's animation
 * frames, and a page picture waits on the compositor for a frame to capture. A software GPU busy with
 * several demos starves both, for the whole of a test's budget. The engine's own reader instead waits
 * on the engine's frame loop, which keeps its turn, and gives the frame drawn last when no new frame
 * comes: measured here, one read took 17 ms where the screenshots ran the test out.
 */
async function frame(page: Page): Promise<Frame> {
	const base64 = await page.evaluate(async () => {
		const engine = (globalThis as { __null3dEngine?: { capture(): Promise<Blob> } }).__null3dEngine;
		if (!engine)
			throw new Error('the page publishes its engine behind ?bench, and it has not started one');
		const bytes = new Uint8Array(await (await engine.capture()).arrayBuffer());
		let text = '';
		// Each chunk keeps the argument count of fromCharCode inside its own limit.
		for (let at = 0; at < bytes.length; at += 0x8000)
			text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
		return btoa(text);
	});
	return decodePngRgba(Buffer.from(base64, 'base64'), 'the canvas');
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
/**
 * The share of the change that turning a part off made that turning it back on must make again. A
 * part whose own light is drawn into the environment map fills that map a stage a frame, so a slow
 * machine takes many seconds over it and the look it settles on sits steps away from any frame read
 * before it. The checks below therefore read the looks they compare, and judge the return by the
 * change the pick makes rather than by a frame that has had minutes to drift away.
 */
const RETURNED = 0.5;
/** A mean difference below which the canvas counts as still, over a settled look. */
const STILL = 0.5;
/** Frames read after a switch: the old bug rewrote the part a frame later, so several are read. */
const FRAMES = 4;
/**
 * How long the engine's first frame may take to arrive. A page shows its controls while its sketch
 * finishes building the scene, which is before that frame, and the page takes its loading overlay
 * away on the frame. On a software GPU the shader builds before it take about 30 seconds on a quiet
 * machine and minutes on a busy one. A picture read before the frame is an empty canvas, so this
 * wait is what keeps the checks below measuring the scene. A page that never draws fails here, which
 * names the page's start rather than a picture.
 */
const FIRST_FRAME_MS = 300_000;
/**
 * How long a switch may take to show in the canvas. A switch costs the page work, and a frame read
 * gives the frame drawn last when no new one comes. This wait is a hedge for a slow software GPU:
 * the check below is sound, and the same switch measures 12.4 steps of 255 on a real GPU, within one
 * frame of the pick.
 */
const WAIT_MS = 180_000;
/**
 * How long the look may take to come to rest. A frame read costs milliseconds on a real GPU and
 * seconds on a software one, so this bound is a time and never a count of frames: one count of
 * frames would give a software chip a wait many times longer than the same count gives a real GPU.
 */
const SETTLE_MS = 10_000;

/**
 * Waits until two frames in a row differ by less than a change the checks could mistake for one, and
 * gives that still frame as the look the checks below compare with. The look never coming to rest
 * inside the wait gives the last frame read. A caller that read this look again would pay for it a
 * second time, and a read costs the frame loop a whole frame.
 */
async function settle(page: Page): Promise<Frame> {
	let previous = await frame(page);
	const until = Date.now() + SETTLE_MS;
	while (Date.now() < until) {
		await new Promise((r) => setTimeout(r, 250));
		const next = await frame(page);
		if (difference(next, previous) < STILL) return next;
		previous = next;
	}
	return previous;
}

/**
 * Turns a part of the look off and on through the HUD, and checks the canvas: while the part is off,
 * each of several frames differs from the frame with it on, and once it turns on, the look comes
 * back to the one the part has.
 *
 * The return is judged by the change the pick makes, from the look with the part off back to the
 * look with it on, and never by the frame the first checks use. The sky's light reaches the
 * environment map a stage a frame, so the look a slow machine settles on sits steps away from a
 * frame read before it settled, and a comparison with that frame measures the machine's speed
 * rather than the part. The frame with the part off is read at the pick, so the two looks the
 * return is measured between are seconds apart and carry that change and little else.
 *
 * Each frame is read once. The poll reads a frame on every try, so the frame it accepts is the first
 * of the frames that must show the part off, and the last of those frames is the look the return is
 * measured from. Reading either of them again would cost the page another frame.
 */
async function switchPart(page: Page, label: string, tab: string, group: string): Promise<void> {
	// The look eases and the camera settles, so the frame with the part on is read when it is still.
	const before = await settle(page);
	await pick(page, tab, group, label, `${label}: off`);
	/** The part off, as the last frame read holds it. */
	let off = before;
	await expect
		.poll(
			async () => {
				off = await frame(page);
				return difference(off, before);
			},
			{ timeout: WAIT_MS },
		)
		.toBeGreaterThan(CHANGED);
	for (let k = 1; k < FRAMES; k++) {
		off = await frame(page);
		expect(difference(off, before), `${label} stays off`).toBeGreaterThan(CHANGED);
	}
	const departure = difference(off, before);
	await pick(page, tab, group, label, `${label}: on`);
	await expect
		.poll(async () => difference(await frame(page), off), { timeout: WAIT_MS })
		.toBeGreaterThan(departure * RETURNED);
}

test(
	'the showcase HUD names each group change in a toast at the top centre',
	ALONE,
	async ({ page }) => {
		const errors = watchPageProblems(page);
		// A fresh page, the light preset, so CI's software GPU draws it quickly. The demo builds its
		// own look from code, so the toast text does not depend on the preset. `bench` publishes the
		// demo's engine on the page, which is how this test reads the canvas's frames.
		await page.goto('/examples/index.html?demo=night-town&preset=low&bench');
		const hud = page.locator('.hud');
		// The sketch posts the HUD once its setup has run, which loads nothing but builds the town.
		await expect(hud).toBeVisible({ timeout: 90_000 });
		await expect(page.getByRole('tab', { name: 'Post' })).toBeVisible();
		// The controls come up while the sketch finishes its scene, which is before the engine's first
		// frame. On a software GPU that frame arrives much later, and a picture read before it is an
		// empty canvas: two empty frames differ by nothing, so the settle below would take one for a
		// still look and every frame the engine drew afterwards would be measured against nothing. The
		// page takes its loading overlay away on the first frame, so that is the signal to wait for
		// ([D-185](../../.dev/decisions/D-185-software-gpu-loses-the-sky.md)).
		await expect(page.locator('.loader')).toHaveCount(0, { timeout: FIRST_FRAME_MS });
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

		// Time of day is an hour slider with Auto and Studio beside it. The slider sets any hour; the
		// two buttons pick a mood, and each names its new state.
		await page.getByRole('tab', { name: 'Time of day' }).click();
		await panel(page, 'hour').locator('input.hud__range').fill('18.4');
		await pick(page, 'Time of day', 'hour', 'Auto', 'Auto: on');
		await pick(page, 'Time of day', 'hour', 'Studio', 'Studio: on');
		// Back to Auto, so the switches below are checked against the sky, not the studio backdrop.
		await pick(page, 'Time of day', 'hour', 'Auto', 'Auto: on');
		// Atmosphere, Lighting and Post are toggles: each names the effect, with its label's own case,
		// and its new state. The snow goes off first, so the scene holds still between frames.
		await pick(page, 'Atmosphere', 'atmosphere', 'Snow', 'Snow: off');
		await switchPart(page, 'Sky', 'Atmosphere', 'atmosphere');
		// The fog starts off, so it is turned on before the part that checks it goes off and on.
		await pick(page, 'Atmosphere', 'atmosphere', 'Fog', 'Fog: on');
		await switchPart(page, 'Fog', 'Atmosphere', 'atmosphere');
		await switchPart(page, 'Environment', 'Lighting', 'lighting');
		await pick(page, 'Lighting', 'lighting', 'Shadows', 'Shadows: off');
		await pick(page, 'Post', 'post', 'Bloom', 'Bloom: on');
		// Quality is a radio group of the presets.
		await pick(page, 'Quality', 'quality', 'Medium', 'quality: medium');

		expect(errors).toEqual([]);
	},
);
