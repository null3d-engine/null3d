// A recording of a live session replays to the same frames. The test opens a page that records with
// ?record, drives its key, and saves the recording through the engine. It then opens the same page
// with ?replay, serves the saved bytes, and compares what each frame gave the sketch: its number,
// sketch time, step, the key's state and a number from the seeded random. A replay that follows the
// page's own frame rate, or that seeds the sketch's random differently, differs on one of them.
import { expect, type Page, test } from '@playwright/test';

/** The frame log and start state that the page keeps, which the test reads. */
interface RecordingPage {
	recordingLog?: string[];
	recordingReady?: boolean;
	recordingError?: string;
	null3dEngine?: { saveRecording(): Promise<Uint8Array | undefined> };
	__null3dHold?: { ok: boolean; replay?: { frames: number; seconds: number; stopped: boolean } };
}

/** The page's frame log, which each frame writes one line of. */
const frameLog = () => (globalThis as RecordingPage).recordingLog?.slice() ?? [];

/**
 * The page's frame log once it stops growing. Each frame's line comes from the sketch's thread as a
 * message, so a few can still arrive after the start resolves.
 */
async function settledLog(page: Page): Promise<string[]> {
	let last = -1;
	for (let k = 0; k < 60; k++) {
		const length = await page.evaluate(
			() => (globalThis as RecordingPage).recordingLog?.length ?? 0,
		);
		if (length === last && length > 0) break;
		last = length;
		await page.waitForTimeout(100);
	}
	return page.evaluate(frameLog);
}

// Each part starts an engine and draws frames for a moment, which takes longer than Playwright's
// default minute on a busy machine.
test.describe.configure({ timeout: 120_000 });

test('a recorded session replays to the same frames', async ({ page }) => {
	page.on('pageerror', (error) => console.log('page error:', error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') console.log('console error:', message.text());
	});
	await page.goto('recording.html?record');
	await page.waitForFunction(
		() =>
			(globalThis as RecordingPage).recordingReady === true ||
			(globalThis as RecordingPage).recordingError !== undefined,
		undefined,
		{ timeout: 30_000 },
	);
	expect(await page.evaluate(() => (globalThis as RecordingPage).recordingError)).toBeUndefined();
	// The key moves the box for a while, and the frames in between record it.
	await page.keyboard.down('w');
	await page.waitForTimeout(400);
	await page.keyboard.up('w');
	await page.waitForTimeout(200);
	const bytes = await page.evaluate(async () => {
		const engine = (globalThis as RecordingPage).null3dEngine;
		if (engine === undefined) throw new Error('the page has no engine');
		return Array.from((await engine.saveRecording()) ?? []);
	});
	expect(bytes.length).toBeGreaterThan(64);
	// The session's own lines reach the page as messages, so read them after the save: the
	// recording cannot hold a frame that the page has not heard of by then.
	await page.waitForTimeout(200);
	const live = await page.evaluate(frameLog);
	expect(live.length).toBeGreaterThanOrEqual(6);
	expect(live.some((line) => line.split('|')[3] === '1')).toBe(true);

	// The replay reads the same bytes from its own address, so the file needs no copy into the page.
	await page.route(
		(url) => url.pathname === '/recording.n3dr',
		(route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: Buffer.from(bytes),
			}),
	);
	await page.goto('recording.html?replay=/recording.n3dr');
	await page.waitForFunction(
		() => (globalThis as RecordingPage).recordingReady === true,
		undefined,
		{ timeout: 30_000 },
	);
	const replayed = await settledLog(page);
	expect(replayed.length).toBeGreaterThan(5);
	// The recording starts at the session's first frame, so the replay's frames are the live log's
	// first ones, line for line: the same times, steps, input and seeded number.
	expect(replayed.length).toBeLessThanOrEqual(live.length);
	expect(replayed).toEqual(live.slice(0, replayed.length));
	const held = await page.evaluate(() => (globalThis as RecordingPage).__null3dHold);
	expect(held?.ok).toBe(true);
	expect(held?.replay?.frames).toBe(replayed.length);
	expect(held?.replay?.stopped).toBe(false);
});

test('the device page records a session with a long frame', async ({ page }) => {
	// The page drives its own keyboard and touch, holds a frame long enough to be a hitch, saves,
	// and publishes the session. The device run uses the same page, so this checks it here. It then
	// replays the file and compares every frame line: a slow GPU draws fewer frames in the session's
	// fixed time, so the test asks for the replay, not for a frame count.
	await page.goto('recording-device.html?record&threads=off');
	await page.waitForFunction(
		() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
		undefined,
		{ timeout: 60_000 },
	);
	const result = await page.evaluate(
		() =>
			(globalThis as { __null3dResult?: Record<string, unknown> }).__null3dResult as {
				ok: boolean;
				error?: string;
				log: string[];
				longestStep: number;
				recording: string;
			},
	);
	expect(result.ok, result.error).toBe(true);
	expect(result.log.length).toBeGreaterThan(0);
	expect(result.longestStep).toBeGreaterThanOrEqual(0.2);
	expect(result.recording.length).toBeGreaterThan(100);

	await page.route(
		(url) => url.pathname === '/device.n3dr',
		(route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: Buffer.from(result.recording, 'base64'),
			}),
	);
	await page.goto('recording.html?replay=/device.n3dr');
	await page.waitForFunction(
		() =>
			(globalThis as RecordingPage).recordingReady === true ||
			(globalThis as RecordingPage).recordingError !== undefined,
		undefined,
		{ timeout: 30_000 },
	);
	expect(await page.evaluate(() => (globalThis as RecordingPage).recordingError)).toBeUndefined();
	const replayed = await settledLog(page);
	expect(replayed).toEqual(result.log);
});
