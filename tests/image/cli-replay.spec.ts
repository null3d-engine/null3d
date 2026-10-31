// The shot command's replay, run as a developer runs it: a page records a session with ?record, the
// test saves the file, and then `bunx @null3d/cli shot --replay` serves it to the same page and
// draws the last frame. The command must draw the frame, name the replay in its summary, and save
// the replay's facts in its JSON report.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { runCli } from '../lib/cli.ts';
import { REPO_ROOT } from '../lib/server.ts';

/** The frame log and start state that the page keeps, which the test reads. */
interface RecordingPage {
	recordingLog?: string[];
	recordingReady?: boolean;
	recordingError?: string;
	null3dEngine?: { saveRecording(): Promise<Uint8Array | undefined> };
}

/**
 * Waits until the session has posted `count` frame lines, so the recording holds that many frames.
 * The session runs frames at the speed of the machine that draws them, and a software GPU draws a
 * few a second, so a fixed span of time records too short a session there.
 */
async function waitForFrames(page: Page, count: number): Promise<void> {
	await page.waitForFunction(
		(needed: number) => ((globalThis as RecordingPage).recordingLog?.length ?? 0) >= needed,
		count,
		{ timeout: 60_000 },
	);
}

// The test records a session in a browser and the command starts its own dev server and browser,
// which takes longer than Playwright's default minute on a busy machine.
test.describe.configure({ timeout: 240_000 });

test('null3d shot --replay draws the last frame of a recording', async ({ page }) => {
	await page.goto('recording.html?record');
	await page.waitForFunction(
		() =>
			(globalThis as RecordingPage).recordingReady === true ||
			(globalThis as RecordingPage).recordingError !== undefined,
		undefined,
		{ timeout: 30_000 },
	);
	expect(await page.evaluate(() => (globalThis as RecordingPage).recordingError)).toBeUndefined();
	await waitForFrames(page, 4);
	// A frame that reads the key holds the press in the recording. Waiting for that frame, rather
	// than for a fixed time, leaves the session long enough at any rate the machine draws.
	await page.keyboard.down('w');
	await page.waitForFunction(
		() =>
			((globalThis as RecordingPage).recordingLog ?? []).some((line) => line.split('|')[3] === '1'),
		undefined,
		{ timeout: 60_000 },
	);
	await page.keyboard.up('w');
	await waitForFrames(page, 10);
	const bytes = await page.evaluate(async () => {
		const engine = (globalThis as RecordingPage).null3dEngine;
		if (engine === undefined) throw new Error('the page has no engine');
		return Array.from((await engine.saveRecording()) ?? []);
	});
	expect(bytes.length).toBeGreaterThan(64);

	const folder = mkdtempSync(join(REPO_ROOT, 'target/cli-replay-'));
	try {
		const recording = join(folder, 'bug.n3dr');
		writeFileSync(recording, Buffer.from(bytes));
		const out = join(folder, 'bug.png');
		const { code, output } = await runCli(REPO_ROOT, [
			'shot',
			'--replay',
			recording,
			'--page',
			'/tests/pages/recording.html',
			'--size',
			'640x360',
			'--gpu',
			'webgl2',
			'--out',
			out,
		]);
		expect(code, output).toBe(0);
		expect(output).toContain('Replayed ');
		expect(output).toContain('frames');
		const report = JSON.parse(readFileSync(out.replace(/\.png$/, '.json'), 'utf8'));
		expect(report.ok).toBe(true);
		expect(report.replay.frames).toBeGreaterThan(5);
		expect(report.replay.sketch).toContain('/tests/pages/sketches/recording-sketch.ts');
		expect(report.replay.stopped).toBe(false);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
