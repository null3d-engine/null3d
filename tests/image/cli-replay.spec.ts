// The shot command's replay, run as a developer runs it: a page records a session with ?record, the
// test saves the file, and then `bunx @null3d/cli shot --replay` serves it to the same page and
// draws the last frame. The command must draw the frame, name the replay in its summary, and save
// the replay's facts in its JSON report.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runCli } from '../lib/cli.ts';
import { REPO_ROOT } from '../lib/server.ts';

/** The frame log and start state that the page keeps, which the test reads. */
interface RecordingPage {
	recordingLog?: string[];
	recordingReady?: boolean;
	recordingError?: string;
	null3dEngine?: { saveRecording(): Promise<Uint8Array | undefined> };
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
	await page.keyboard.down('w');
	await page.waitForTimeout(300);
	await page.keyboard.up('w');
	await page.waitForTimeout(200);
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
