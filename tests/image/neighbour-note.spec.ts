// A failure's note names the tests that other workers ran beside it, and never the failing test
// itself. The note is composed at failure time from the records that the reporter writes as each
// test starts, so a page that never publishes a result still names the test that shared its machine.
import { expect, test } from '@playwright/test';
import {
	clearTestRunning,
	noteTestRunning,
	runningTest,
	workerIndex,
} from '../lib/running-tests.ts';
import { failureText } from '../lib/runs.ts';

/** A worker index that Playwright never gives a worker, for the record that stands in for a neighbour. */
const NEIGHBOUR = 1000;

/** The bright scene, which draws on both GPU paths and loads no files. */
const PAGE =
	'/tests/pages/image.html?gpu=webgpu&hold=0&preset=high&size=320x180&sketch=/tests/pages/sketches/bright-sketch.ts';

test('a failure names another worker’s test and not its own', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	const own = workerIndex();
	expect(own).toBeDefined();
	// The reporter records this test in the main process, a moment after the test body starts.
	await expect.poll(() => runningTest(own)?.name).toBe(testInfo.title);
	try {
		noteTestRunning(NEIGHBOUR, 'a named neighbour');
		// Keep a real page open while the neighbour's record stands, as a page of a run that stalls.
		await page.goto(PAGE);
		await page.waitForFunction(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
			null,
			{ timeout: 60_000 },
		);
		const text = failureText({ ok: false, error: 'forced failure', trail: ['1 ms x'] });
		expect(text).toContain('"a named neighbour"');
		expect(text).not.toContain(`"${testInfo.title}"`);
		expect(text).toContain("the page's last steps: 1 ms x");
	} finally {
		clearTestRunning(NEIGHBOUR);
	}
});
