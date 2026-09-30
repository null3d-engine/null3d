// Runs the image test manifest in Chrome: each test on each of its GPU tiers, in each of its thread
// modes, against the references of the environment that the Playwright project names. The tests
// run in parallel, so CI can split them into shards. A missing or different image fails its test
// and is saved as a candidate for bun run images:review.
import { expect, test } from '@playwright/test';
import { watchConsole } from '../../packages/cli/src/page.js';
import { clearCandidate, environmentNamed, imageProblems, tiersOf } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText, type ItemResult } from '../lib/runs.ts';
import { IMAGE_RUNS, IMAGE_TESTS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** Time to open each page, besides the time its image may take. */
const LOAD_SECONDS = 10;

for (const imageTest of IMAGE_TESTS)
	for (const tier of tiersOf(imageTest)) {
		const runs = IMAGE_RUNS.filter((run) => run.test === imageTest.name && run.tier === tier);
		test(`${imageTest.name} on ${tier}`, async ({ page }, testInfo) => {
			test.setTimeout(runs.reduce((sum, run) => sum + run.timeoutSeconds + LOAD_SECONDS, 0) * 1000);
			const place = { environment: environmentNamed(testInfo.project.name) };
			const { errors: pageErrors } = watchConsole(page);
			// The runs of a test on a tier share one candidate, so an earlier run's goes before any runs.
			for (const run of runs) clearCandidate(run, place);
			const results = new Map<string, ItemResult>();
			const problems: string[] = [];
			for (const run of runs) {
				const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
				results.set(run.id, result);
				const first = run.sameAs === undefined ? undefined : results.get(run.sameAs);
				const found = result.ok
					? imageProblems(run, result, place, first?.ok ? first : undefined)
					: [failureText(result)];
				const where = run.mode?.name ?? tier;
				for (const problem of [...found, ...pageErrors.splice(0)])
					problems.push(`${where}: ${problem}`);
			}
			expect(problems).toEqual([]);
		});
	}
