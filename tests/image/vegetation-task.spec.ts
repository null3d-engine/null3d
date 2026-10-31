// The built-in vegetation species grow through the add-on's task on the engine's job worker, on
// each GPU path. The page forces a path, and the sketch compares each task-grown plant with the one
// that the same species and seed grow on the thread. Each test also requires a worker besides the
// ones that run the sketch and the render step, since a task that reached no worker would answer
// nothing. Remove a GPU path and its test fails at the engine's start.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The GPU path that each query forces, and the tier that the engine must report for it. */
const PATHS = [
	{ gpu: 'webgpu', tier: 'webgpu' },
	{ gpu: 'compat', tier: 'webgpu-compat' },
	{ gpu: 'webgl2', tier: 'webgl2' },
] as const;

/** One species as the task grew it. */
interface GrownSpecies {
	id: string;
	triangles: number;
	parts: number;
	matches: boolean;
}

/** What the page reported. */
interface Result {
	ok: boolean;
	error?: string;
	tier: string;
	species: GrownSpecies[];
}

for (const path of PATHS) {
	test(`every built-in species grows in the job worker on ${path.gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		// The page stops its engine before it publishes, so the workers are gone by then. Their
		// addresses are kept as each one starts.
		const workerUrls: string[] = [];
		page.on('worker', (worker) => workerUrls.push(worker.url()));
		await page.goto(`vegetation-task.html?gpu=${path.gpu}`);
		const result = await pageResult<Result>(page, 90_000);
		expect(result.error).toBeUndefined();
		expect(result.ok).toBe(true);
		expect(result.tier).toBe(path.tier);
		expect(result.species).toHaveLength(13);
		for (const species of result.species) {
			expect(species.triangles).toBeGreaterThan(0);
			expect(species.parts).toBeGreaterThan(0);
			expect(species.matches).toBe(true);
		}
		// The task runs beside the sketch and the render step, in a job worker where the engine has
		// one, or in the task worker where it starts none.
		const worker = workerUrls.some(
			(url) => url.includes('job-worker') || url.includes('task-worker'),
		);
		expect(worker, workerUrls.join('\n')).toBe(true);
	});
}
