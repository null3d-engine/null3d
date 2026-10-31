// Chrome's measurement of the page's memory waits until every worker of the page has run it as a
// task. An idle job worker that blocks in the job loop never runs it, so each measurement takes
// about a minute, and the whole page can stop answering meanwhile: Night town's comparison pages
// with job workers hang for minutes. While a measurement runs, the engine lets idle job workers run
// their threads' tasks between frame jobs. This test starts job workers with a busy scene, then
// measures the page's memory as the stats overlay does, and checks that the answer comes within
// seconds while the page answers.
import { expect, test } from '@playwright/test';

/** The job workers that the page's trail notes as started. */
const JOB_STARTED = /null3d-job-\d+: started/g;

/**
 * The longest a measurement may take. Without the eager flag, Chrome answers at its next garbage
 * collection, which takes up to 17 s on the Mac. A job worker that never runs the task holds the
 * answer back for about a minute.
 */
const MEASURE_LIMIT_MS = 30_000;

test('the page measures its memory within seconds while job workers run', async ({ page }) => {
	test.skip(
		test.info().project.name.startsWith('chromium-swiftshader'),
		"the software GPU's browser measures no memory",
	);
	test.setTimeout(120_000);
	await page.goto('engine-frame.html?gpu=webgl2&sketch=busy&jobs=3');
	await expect
		.poll(() => page.evaluate('window.__engineFrame?.engineFrame'), { timeout: 30_000 })
		.toBe('running');
	const started = async () =>
		String(await page.evaluate("window.__null3dProgress?.join('\\n') ?? ''")).match(JOB_STARTED)
			?.length ?? 0;
	await expect.poll(started, { timeout: 30_000 }).toBeGreaterThan(0);
	// The busy scene keeps its job workers at work for the whole measurement.
	type Measured = { bytes?: number; ms: number; error?: string };
	const measuring = page.evaluate('window.__measurePageMemory?.()') as Promise<
		Measured | undefined
	>;
	// The page keeps answering while the measurement runs.
	for (let i = 0; i < 3; i++) {
		const asked = Date.now();
		await page.evaluate(() => performance.now());
		expect(Date.now() - asked).toBeLessThan(2_000);
		await page.waitForTimeout(500);
	}
	const late: Measured = { ms: Number.POSITIVE_INFINITY, error: 'no answer' };
	const measured = await Promise.race([
		measuring,
		page.waitForTimeout(MEASURE_LIMIT_MS + 10_000).then(() => late),
	]);
	test.skip(measured?.error === 'the browser offers no measurement', measured?.error);
	expect(measured?.error).toBeUndefined();
	expect(measured?.bytes).toBeGreaterThan(0);
	expect(measured?.ms).toBeLessThan(MEASURE_LIMIT_MS);
});

// The stats overlay samples the page's memory through the same path, every few seconds while it is
// open, so a page with the overlay open and job workers at work shows a figure within seconds.
test("the stats overlay shows the page's memory within seconds while job workers run", async ({
	page,
}) => {
	test.skip(
		test.info().project.name.startsWith('chromium-swiftshader'),
		"the software GPU's browser measures no memory",
	);
	test.setTimeout(120_000);
	await page.goto('engine-frame.html?gpu=webgl2&sketch=busy&jobs=3&stats=open');
	await expect
		.poll(() => page.evaluate('window.__engineFrame?.engineFrame'), { timeout: 30_000 })
		.toBe('running');
	const line = async () =>
		String(
			await page.evaluate(
				`document.querySelector('[data-null3d-stats]')?.shadowRoot?.querySelector('[data-figure="page-memory"]')?.textContent ?? ''`,
			),
		);
	const started = async () =>
		String(await page.evaluate("window.__null3dProgress?.join('\\n') ?? ''")).match(JOB_STARTED)
			?.length ?? 0;
	await expect.poll(started, { timeout: 30_000 }).toBeGreaterThan(0);
	const text = await line();
	test.skip(text === '' || text.includes('n/a'), 'this browser offers no page memory figure');
	await expect
		.poll(line, { timeout: MEASURE_LIMIT_MS })
		.toMatch(/Whole page, as the browser counts it: \d/);
});
