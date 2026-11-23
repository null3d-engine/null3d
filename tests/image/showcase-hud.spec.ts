// The showcase controls HUD names every change in a toast at the top centre of the view. Playwright
// opens the island's HUD, picks a button in each group, and checks the toast's text
// ([D-171](../../.dev/decisions/D-171-showcase-controls-hud.md), owner's ruling). A toast alone
// cannot show that a change took: the stage writes the sky, the fog and the environment light every
// frame, and can undo a switch a frame after the toast names it. So the tests also read
// the canvas, and check that each part stays off while it is off and comes back when it turns on.
//
// The checks fall into three tests, and each one opens the page afresh, so CI can run them in jobs
// of their own at the same time. The first checks the toasts of the camera, the time of day, the
// shadows, the bloom and the quality, and where the toast sits. The second turns the sky and then
// the fog off and on, and the third does the same with the environment light. Each test first sets
// up the state its checks need: the switches run with the camera held at the hour the scene opens
// on, and the environment light with the fog on. Each name starts with "the showcase
// HUD": the job of the other tests that run alone leaves the three out by those words, and the rest
// of the name picks one test.
import { expect, type Page, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import {
	frameDifference as difference,
	type Frame,
	readFrame as frame,
} from '../lib/canvas-frame.ts';
import { watchPageProblems } from '../lib/page-result.ts';

/** The panel of a group, by the group's name in the model. */
const panel = (page: Page, name: string) => page.locator(`#hud-panel-${name}`);
/**
 * The picks, the startup and the slow software GPU need longer than the default limit. The engine's
 * first frame is part of that, and on a software GPU it arrives long after the controls do, so each
 * test's budget covers that wait and the picks or switches after it, and each test runs alone.
 *
 * Alone for two reasons. Their pictures need the engine to draw frames, and on CI's runner a heavy
 * test beside one starves its page's frames, which is the fault D-186 measures. And their
 * budget cannot sit in a shard: a shard's limit is 25 minutes, which covers its tests taking twice
 * as long as the median, and these tests fail exactly on a slow machine. The waits below are sized
 * for a software renderer on a loaded runner: a first frame there took longer than three minutes,
 * and a switch showed no new frame within one. The whole sequence of picks and switches takes 14 to
 * 24 minutes on CI's software GPU, so the file splits it into four tests that CI can run at once.
 * Each pays for its own page's first frame. The environment light's test also turns the fog on,
 * since every scene opens with clear air, so it carries two switches and is the longest; its
 * measured stages sum to about 25 minutes with the fog's switch at 535 s and the return's wait,
 * and the caps sum to about 28, or 33 with the fog's longer return wait. The budget is 34 minutes,
 * under the 35-minute job's limit, so a page that truly stops drawing still fails by name rather
 * than by the job's clock.
 */
test.describe.configure({ timeout: 2_040_000 });

/** Clicks a group's button and checks the toast that names the change. */
async function press(page: Page, group: string, button: string, text: string): Promise<void> {
	await panel(page, group).getByRole('button', { name: button }).click();
	// A frame on the software GPU can take a while, and the toast shows for 2 s, so allow for it.
	const toast = page.locator('.hud__toast');
	await expect(toast).toHaveClass(/\bshow\b/, { timeout: 20_000 });
	await expect(toast).toHaveText(text, { timeout: 20_000 });
}

/**
 * Picks a button of a group and checks the toast that names the change: selects the group's tab,
 * then presses the button.
 */
async function pick(
	page: Page,
	tab: string,
	group: string,
	button: string,
	text: string,
): Promise<void> {
	await page.getByRole('tab', { name: tab }).click();
	await press(page, group, button, text);
}

/**
 * Turns a switch on unless the HUD shows it on already. Every showcase opens with the air clear, so
 * its fog starts off; the other parts open on. A test that needs the switch on reads its button
 * rather than assuming the state it opens in.
 */
async function turnOn(page: Page, tab: string, group: string, label: string): Promise<void> {
	// The group's panel is out of the accessibility tree until its tab is picked, so the tab goes
	// first and the button's state is read from the panel it shows.
	await page.getByRole('tab', { name: tab }).click();
	const button = panel(page, group).getByRole('button', { name: label });
	if ((await button.getAttribute('aria-pressed')) === 'true') return;
	await press(page, group, label, `${label}: on`);
}

/**
 * A mean difference that only a change of the look gives; the scene at rest differs less. Held at
 * its opening hour with its trees grown, the island at rest differs by 0.002 to 0.031 between two
 * frames on this Mac's software GPU. Of the parts, the fog's switch changes the least, 1.06, against
 * 3.71 for the environment light and 47.5 for the sky. The limit sits at half the fog's change and
 * sixteen times the largest change at rest.
 */
const CHANGED = 0.5;
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
/** Frames read after a switch, since a stage that rewrites the part does so a frame later. */
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
 * How long a part's departure may take to show in the canvas. A switch costs the page work, and a
 * frame read gives the frame drawn last when no new one comes. This wait is a hedge for a slow
 * software GPU: the check below is sound, and the same switch measures 12.4 steps of 255 on a real
 * GPU, within one frame of the pick. The return's own, longer wait is RETURN_MS.
 */
const WAIT_MS = 180_000;
/**
 * How long the environment light's return may take once it is on again. It fills the environment
 * map a stage a frame, and CI's software GPU took 492 and 535 s over the sky's and the fog's whole
 * switches (run 39854225392); a failing run read 5.24 of a 29.08 departure after three minutes,
 * less than a fifth of the half the check needs. Eight minutes holds the return past half the
 * departure plus its easing, and the file's 30 minutes holds it with the page's first frame, the
 * fog's own switch and the settle.
 */
const RETURN_MS = 480_000;
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
		const rest = difference(next, previous);
		if (rest < STILL) {
			progress(`the look at rest, ${rest.toFixed(3)} between two frames`);
			return next;
		}
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
async function switchPart(
	page: Page,
	label: string,
	tab: string,
	group: string,
	/** How long the look may take to return: the environment light fills a map, so it is slower. */
	returnMs = WAIT_MS,
): Promise<void> {
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
	progress(`${label} off, ${departure.toFixed(2)} from the look with it on`);
	await pick(page, tab, group, label, `${label}: on`);
	let returned = 0;
	await expect
		.poll(
			async () => {
				returned = difference(await frame(page), off);
				return returned;
			},
			{ timeout: returnMs },
		)
		.toBeGreaterThan(departure * RETURNED);
	progress(`${label} off and on again, ${returned.toFixed(2)} from the look with it off`);
}

/** When the test's page opened, for the progress lines that each stage prints. */
let opened = 0;

/**
 * Prints how far the test has come and when, so a long run on a slow machine shows which stage takes
 * its time.
 */
function progress(stage: string): void {
	console.log(`  ${stage} after ${Math.round((performance.now() - opened) / 1000)} s`);
}

/**
 * Opens the island's HUD as a visitor finds it, once the engine has drawn its first frame, and
 * watches the page for problems from the start. A test that compares the canvas's frames passes
 * `size`, the window it reads them in, and the island then grows its trees before that first frame.
 * A live page grows them after it, and their arrival minutes later changes the look by more than
 * the fog's switch does: run here, a fog that measured 1.06 off read 1.21 once they landed.
 * Gives the list of problems, which each test checks last.
 */
async function openHud(page: Page, size?: { width: number; height: number }): Promise<string[]> {
	const errors = watchPageProblems(page);
	// A reload after the first frame is a fault of the run, not the scene: it detaches every control
	// a pick is about to click. The test server is started with its live reload off for this reason,
	// and this watch names the fault if a server that reloads serves the page anyway.
	let watchReloads = false;
	page.on('framenavigated', (frame) => {
		if (watchReloads && frame === page.mainFrame())
			errors.push('the page reloaded during the test');
	});
	opened = performance.now();
	if (size) await page.setViewportSize(size);
	// A fresh page, the light preset, so CI's software GPU draws it quickly. The demo builds its own
	// look from code, so the toast text does not depend on the preset. `bench` publishes the demo's
	// engine on the page, which is how these tests read the canvas's frames.
	await page.goto(`/examples/index.html?demo=island&preset=low&bench${size ? '&grown' : ''}`);
	const hud = page.locator('#hud-panel');
	// The sketch posts the HUD as soon as its controls exist, which is before it builds the island's
	// town, its trees and its grass, and the page shows the controls when that message arrives. The
	// scene's own builds and its environment maps, which a software GPU spends minutes on, no longer
	// hold the controls back. The wait keeps the first frame's budget, because the sketch itself
	// starts first: its core, its modules and the worker the sketch's setup runs in. A page that
	// never posts the controls still fails here, by the test's own name.
	await expect(hud).toHaveCount(1, { timeout: FIRST_FRAME_MS });
	// The controls come up while the sketch finishes its scene, which is before the engine's first
	// frame. On a software GPU that frame arrives much later, and a picture read before it is an
	// empty canvas: two empty frames differ by nothing, so a switch's settle would take one for a
	// still look and every frame the engine drew afterwards would be measured against nothing. The
	// page takes its loading overlay away on the first frame, so that is the signal to wait for
	// ([D-185](../../.dev/decisions/D-185-software-gpu-loses-the-sky.md)).
	await expect(page.locator('.loader')).toHaveCount(0, { timeout: FIRST_FRAME_MS });
	progress('the first frame');
	watchReloads = true;
	// Open the panel, as a visitor does, with its chevron at the bottom of the scene. The scene's
	// tabs reach the page's roles only while the panel is open.
	await page.locator('.hud__chevron').click();
	await expect(page.getByRole('tab', { name: 'Post' })).toHaveCount(1);
	await expect(hud).toBeVisible();
	return errors;
}

/**
 * Sets up the scene for the switches, and checks the toast of the pick. The manual camera holds the
 * view, and the scene keeps the fixed hour that it opens on, under the sky, so the look holds still
 * between frames and each part is checked against the sky rather than the studio backdrop.
 *
 * Auto would move the sun: a whole day passes in 80 seconds of the scene's time, and each frame
 * advances that time by up to a quarter of a second, about four and a half minutes of the day. The
 * environment light's switch takes eight minutes on CI's software GPU, so the frames that a check
 * compares would hold the sun hours apart, and the return would measure the sun's move as much as
 * the part's.
 */
async function holdForSwitches(page: Page): Promise<void> {
	// Camera is a radio group: a pick names the group and the new mode. The town opens on its
	// cinematic route, and Manual stops the camera where the route stands.
	await pick(page, 'Camera', 'camera', 'Manual', 'camera: manual');
	progress('the scene held still for the switches');
}

test('the showcase HUD shows its toasts at the top centre', ALONE, async ({ page }) => {
	const errors = await openHud(page);

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

	// Time of day is an hour dial with a readout, and Auto and Studio beside it. A tap on the ring
	// sets the hour there: midnight sits at the bottom and the hours run clockwise, so 18:24 is a
	// little below the right-hand side. The readout names the hour.
	await page.getByRole('tab', { name: 'Time of day' }).click();
	const dial = panel(page, 'hour').getByRole('slider', { name: 'Time of day' });
	const box = await dial.boundingBox();
	expect(box).not.toBeNull();
	const turn = (18.4 / 24) * Math.PI * 2;
	const reach = (box?.width ?? 0) * 0.445;
	await page.mouse.click(
		(box?.x ?? 0) + (box?.width ?? 0) / 2 - Math.sin(turn) * reach,
		(box?.y ?? 0) + (box?.height ?? 0) / 2 + Math.cos(turn) * reach,
	);
	const readout = panel(page, 'hour').locator('.hud__name');
	await expect(readout).toHaveText('Dusk');
	// The dial wraps round: six hours on from 18:24 is past midnight, which the readout names.
	await dial.focus();
	for (let k = 0; k < 6; k++) await dial.press('PageUp');
	await expect(readout).toHaveText('Midnight');
	await expect(panel(page, 'hour').locator('.hud__time')).toHaveText(/^00:2\d$/);
	// Auto and Studio each turn on with a press and off with the next, and name each change.
	await pick(page, 'Time of day', 'hour', 'Auto', 'Auto: on');
	await pick(page, 'Time of day', 'hour', 'Auto', 'Auto: off');
	await pick(page, 'Time of day', 'hour', 'Studio', 'Studio: on');
	await expect(readout).toHaveText('Studio');
	await pick(page, 'Time of day', 'hour', 'Studio', 'Studio: off');
	await pick(page, 'Time of day', 'hour', 'Studio', 'Studio: on');
	// Auto from the studio leaves the studio backdrop for the sky again.
	await pick(page, 'Time of day', 'hour', 'Auto', 'Auto: on');
	// Lighting and Post are toggles: each names the effect, with its label's own case, and its
	// new state.
	await pick(page, 'Lighting', 'lighting', 'Shadows', 'Shadows: off');
	await pick(page, 'Post', 'post', 'Bloom', 'Bloom: on');
	// Quality is a radio group of the presets.
	await pick(page, 'Quality', 'quality', 'Medium', 'quality: medium');

	expect(errors).toEqual([]);
});

/**
 * The window of the tests that turn a part of the look off and on. They judge the canvas's frames,
 * and CI's software GPU spends most of each frame on its pixels, so a quarter of the default
 * window's pixels makes each frame they wait for cheaper. The HUD's layout stays the toast test's.
 */
const PART_WINDOW = { width: 640, height: 360 };

// The sky and the fog each take about 2 minutes to go off and on again on CI's software GPU, so
// each has a test, and a machine, of its own.
test('the showcase HUD keeps the sky off until it turns on', ALONE, async ({ page }) => {
	const errors = await openHud(page, PART_WINDOW);
	await holdForSwitches(page);

	await switchPart(page, 'Sky', 'Atmosphere', 'atmosphere');

	expect(errors).toEqual([]);
});

test('the showcase HUD keeps the fog off until it turns on', ALONE, async ({ page }) => {
	const errors = await openHud(page, PART_WINDOW);
	await holdForSwitches(page);

	// Every scene starts with the fog off, so the switch turns it on before the part that checks it
	// goes off and on again. The fog's return fills the stages the same way the environment light's
	// does, and on CI's software GPU it took longer than the plain wait, so it gets the longer one.
	await turnOn(page, 'Atmosphere', 'atmosphere', 'Fog');
	await switchPart(page, 'Fog', 'Atmosphere', 'atmosphere', RETURN_MS);

	expect(errors).toEqual([]);
});

test(
	'the showcase HUD keeps the environment light off until it turns on',
	ALONE,
	async ({ page }) => {
		const errors = await openHud(page, PART_WINDOW);
		await holdForSwitches(page);

		// The fog goes on first, when the scene starts without it, so the environment light is
		// checked with the sky and the fog both drawn.
		await turnOn(page, 'Atmosphere', 'atmosphere', 'Fog');
		await switchPart(page, 'Environment', 'Lighting', 'lighting', RETURN_MS);

		expect(errors).toEqual([]);
	},
);
