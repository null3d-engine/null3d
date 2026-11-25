// TEMPORARY DIAGNOSTIC for the texture-arrays stall on CI's WebGPU: runs the image test's pages of
// one tier in the image test's order, in one tab, and prints what the page recorded once the
// textures loaded, for every mode, whether or not the run failed. It runs only when
// NULL3D_TEXTURE_ARRAYS_DIAG names the tier, in the CI job of the same name.
import { expect, test } from '@playwright/test';
import { environmentNamed, runIn } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { IMAGE_RUNS } from './manifest.ts';

const tier = process.env.NULL3D_TEXTURE_ARRAYS_DIAG;

test('texture-arrays diagnostic', async ({ page }, testInfo) => {
	test.skip(!tier, 'only the diagnostic job runs it');
	const runs = IMAGE_RUNS.filter((run) => run.test === 'texture-arrays' && run.tier === tier);
	test.setTimeout(runs.reduce((sum, run) => sum + run.timeoutSeconds + 10, 0) * 1000);
	const environment = environmentNamed(testInfo.project.name);
	const failures: string[] = [];
	for (const run of runs) {
		const result = await loadResult(page, runIn(run, environment).path, run.timeoutSeconds * 1000);
		const diag = await page
			.evaluate(() => (globalThis as { __textureArraysDiag?: string }).__textureArraysDiag)
			.catch(() => undefined);
		const where = `${tier} ${run.mode?.name ?? ''} repeat ${testInfo.repeatEachIndex}`;
		console.log(`DIAG ${where}: ${result.ok ? 'ok' : 'FAILED'}; ${diag ?? 'no report'}`);
		if (!result.ok) {
			const failure = `${where}: ${failureText(result)}`;
			console.log(`DIAG-FAILURE ${failure}`);
			failures.push(failure);
		}
	}
	expect(failures).toEqual([]);
});
