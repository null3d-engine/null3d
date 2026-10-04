// Failures after the start reach the page's failure handler instead of freezing the engine, and a
// thread that runs the sketch on the page never hangs the page. Engines follow one another on one
// canvas, as React's StrictMode starts them, and code that outlives an engine never reaches the next.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, THREADED_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface FailureResult {
	codes: string[];
	messages: string[];
	ticks: number;
	error?: string;
}

/**
 * Rewrites the job worker's script so that job worker 0 fails inside the job system: its clock,
 * which the core reads around each chunk of a parallel loop, throws once after some reads. The
 * worker then dies holding a chunk, as a trap in the core leaves it.
 */
async function failingJobWorker(page: Page): Promise<void> {
	await page.context().route(/\/job-worker[^/]*\.(js|ts)(\?|$)/, async (route) => {
		const response = await route.fetch();
		const fault = `if (self.name === 'null3d-job-0') {
			const now = performance.now.bind(performance);
			let reads = 0;
			performance.now = () => {
				if (++reads === 400) throw new Error('job worker 0 failed on purpose');
				return now();
			};
		}\n`;
		await route.fulfill({ response, body: fault + (await response.text()) });
	});
}

for (const mode of ENGINE_MODES) {
	test(`a frame step that throws reaches onFailure as E1404, ${mode.name}`, async ({ page }) => {
		await page.goto(`failures.html?case=fault&${mode.query}`);
		const result = await pageResult<FailureResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.codes[0]).toBe('E1404');
		expect(result.messages[0]).toContain('the frame step failed on purpose');
		expect(result.ticks).toBeGreaterThan(0);
	});
}

for (const mode of THREADED_MODES) {
	test(`a job worker that fails reaches onFailure, and the page never hangs, ${mode.name}`, async ({
		page,
	}) => {
		await failingJobWorker(page);
		await page.goto(`failures.html?case=job-fault&jobs=2&${mode.query}`);
		const result = await pageResult<FailureResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.codes).toContain('E1404');
		expect(result.messages.join('\n')).toContain('the job 0 worker failed');
		// The page's own timer ran through the failure.
		expect(result.ticks).toBeGreaterThan(5);
	});
}

for (const mode of ENGINE_MODES)
	for (const pattern of ['then', 'abort'])
		test(`engines follow one another on one canvas, ${pattern}, ${mode.name}`, async ({ page }) => {
			await page.goto(`failures.html?case=same-canvas&pattern=${pattern}&${mode.query}`);
			const result = await pageResult<{
				workersOfOne: number;
				workersOfSecond: number;
				workersAfter: number;
				workersAfterRemoval: number;
				reuse: string;
				frames: number;
				error?: string;
			}>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(result.frames).toBeGreaterThan(0);
			// Every worker of the engines that stopped has stopped, but the one that keeps the canvas.
			expect(result.workersOfSecond).toBe(result.workersOfOne);
			const workerDraws = mode.renderThread !== 'main';
			expect(result.workersAfter).toBe(workerDraws ? 1 : 0);
			expect(result.workersAfterRemoval).toBe(0);
			expect(result.reuse).toBe(workerDraws ? 'E1419' : 'started');
		});

test('a second engine on the canvas of a running one fails with E1419', async ({ page }) => {
	await page.goto('failures.html?case=two-live');
	const result = await pageResult<{ code: string; frames: number; error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.code).toBe('E1419');
	expect(result.frames).toBeGreaterThan(0);
});

for (const query of ['threads=off', 'sketch-thread=main'])
	test(`sketch code that outlives its engine fails with E1420, ${query}`, async ({ page }) => {
		await page.goto(`failures.html?case=after-destroy&${query}`);
		const result = await pageResult<{
			afterDestroy: string;
			whileAnotherRuns: string;
			destroyed: number;
			frames: number;
			error?: string;
		}>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.afterDestroy).toBe('E1420');
		expect(result.whileAnotherRuns).toBe('E1420');
		expect(result.destroyed).toBe(1);
		expect(result.frames).toBeGreaterThan(0);
	});
