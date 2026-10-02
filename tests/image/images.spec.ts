// Runs the image test manifest in Chrome: each test on each of its GPU tiers, in each of its thread
// modes, against the references of the environment that the Playwright project names. The tests
// run in parallel, so CI can split them into shards. A missing or different image fails its test
// and is saved as a candidate for bun run images:review. NULL3D_SWITCHES gives every page more
// switches, such as half=on, and the images must still match the usual references.
import { expect, type Page, test } from '@playwright/test';
import { readSwitches } from '../../bench/lib/parity.ts';
import { watchConsole } from '../../packages/cli/src/page.js';
import {
	clearCandidate,
	environmentNamed,
	type ImageRun,
	imageProblems,
	tiersOf,
} from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText, type ItemResult } from '../lib/runs.ts';
import { IMAGE_RUNS, IMAGE_TESTS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** Time to open each page, besides the time its image may take. */
const LOAD_SECONDS = 10;

/** The time that a test of these runs needs, in milliseconds. */
const timeoutOf = (runs: readonly ImageRun[]) =>
	runs.reduce((sum, run) => sum + run.timeoutSeconds + LOAD_SECONDS, 0) * 1000;

/**
 * Opens the page of each run in turn, and returns what is wrong with their images, each problem
 * with the mode or tier of its run. The runs of a test on a tier share one candidate, so an earlier
 * run's goes before any runs.
 */
async function runProblems(
	page: Page,
	runs: readonly ImageRun[],
	environment: string,
): Promise<string[]> {
	const place = { environment: environmentNamed(environment) };
	const { errors: pageErrors } = watchConsole(page);
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
		const where = run.mode?.name ?? run.tier;
		for (const problem of [...found, ...pageErrors.splice(0)])
			problems.push(`${where}: ${problem}`);
	}
	return problems;
}

/** The switches that NULL3D_SWITCHES adds to every page, or none. */
const extraSwitches =
	process.env.NULL3D_SWITCHES && readSwitches(process.env.NULL3D_SWITCHES, 'NULL3D_SWITCHES');

/** A run with the switches of NULL3D_SWITCHES after its own. */
const withExtraSwitches = (run: ImageRun): ImageRun =>
	extraSwitches ? { ...run, path: `${run.path}&${extraSwitches}` } : run;

for (const imageTest of IMAGE_TESTS)
	for (const tier of tiersOf(imageTest)) {
		const runs = IMAGE_RUNS.filter((run) => run.test === imageTest.name && run.tier === tier).map(
			withExtraSwitches,
		);
		test(`${imageTest.name} on ${tier}`, async ({ page }, testInfo) => {
			test.setTimeout(timeoutOf(runs));
			expect(await runProblems(page, runs, testInfo.project.name)).toEqual([]);
		});
	}

// Hold mode waits until the thread that draws holds every texture image. Where the threads wake
// each other with messages, as in a browser without Atomics.waitAsync, that thread's wake messages
// end the wait, and every threaded mode draws the same image.
const textureRuns = IMAGE_RUNS.filter(
	(run) => run.test === 'textures' && run.tier === 'webgl2' && run.mode?.build === 'threaded',
).map((run) => withExtraSwitches({ ...run, path: `${run.path}&wake=message` }));
test('textures on webgl2 with ?wake=message', async ({ page }, testInfo) => {
	test.setTimeout(timeoutOf(textureRuns));
	expect(await runProblems(page, textureRuns, testInfo.project.name)).toEqual([]);
});
