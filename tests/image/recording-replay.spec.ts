// A recording made on a real device replays here to the same frames. The device run's plan item
// `record-phone` publishes the session's frame lines and its recording file; this test reads that
// result, serves the file to the same sketch on this computer, and compares the lines one for one:
// the frame number, the sketch time, the step, the key, the pointer and a seeded number, every
// frame, including the session's long frame. The phone's result is kept as a fixture, so every run
// checks it; NULL3D_RECORDING replays another run's result instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { REPO_ROOT } from '../lib/server.ts';

/** What the device run's result holds for the test. */
interface DeviceResult {
	ok: boolean;
	error?: string;
	/** The session's frame lines, as the sketch posted them. */
	log: string[];
	/** How many frames the session ran. */
	frames: number;
	/** The longest step in the session, in seconds: its hitch. */
	longestStep: number;
	/** The recording's bytes, as base64. */
	recording: string;
}

/** What the page keeps while it replays: the frame lines and the start's end. */
interface RecordingPage {
	recordingLog?: string[];
	recordingReady?: boolean;
	recordingError?: string;
}

/** The page's frame lines, once they stop growing. */
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
	return page.evaluate(() => (globalThis as RecordingPage).recordingLog?.slice() ?? []);
}

/** The phone's run, kept as a fixture; the environment may name another run's result instead. */
const RESULT =
	process.env.NULL3D_RECORDING ??
	join(REPO_ROOT, 'tests/fixtures/recordings/galaxy-s24-record.json');

test.describe.configure({ timeout: 120_000 });

test('a recording from a device replays here to the same frames', async ({ page }) => {
	const result = JSON.parse(readFileSync(RESULT, 'utf8')) as DeviceResult;
	expect(result.ok, result.error).toBe(true);
	expect(result.log.length).toBe(result.frames);
	expect(result.longestStep).toBeGreaterThanOrEqual(0.2);

	await page.route(
		(url) => url.pathname === '/phone.n3dr',
		(route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: Buffer.from(result.recording, 'base64'),
			}),
	);
	await page.goto('recording.html?replay=/phone.n3dr');
	await page.waitForFunction(
		() =>
			(globalThis as RecordingPage).recordingReady === true ||
			(globalThis as RecordingPage).recordingError !== undefined,
		undefined,
		{ timeout: 30_000 },
	);
	expect(await page.evaluate(() => (globalThis as RecordingPage).recordingError)).toBeUndefined();
	const replayed = await settledLog(page);
	// The same count, and every line the same, from the session's first frame to its last.
	expect(replayed.length).toBe(result.frames);
	expect(replayed).toEqual(result.log);
});
