// Works out the shard weights of CI's browser job from the test times of recent CI runs, and prints
// each shard's modelled time with the weights in the workflow and with the best weights:
//   bun run test:browser-weights                 take each test's median time in the last CI runs on
//                                                main that passed and ran the browser job
//   bun run test:browser-weights --runs <n>      take the median of that many runs
//   bun run test:browser-weights --run <id>      take the times from that CI run; give it more than once
//                                                for the median of several
//   bun run test:browser-weights --shards <n>    find weights for that many shards
// It needs the GitHub CLI. `.dev/image-tests.md` says when to retune the weights.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALONE_PROJECT_SUFFIX, ALONE_TAG } from '../tests/lib/alone.ts';
import {
	bestWeights,
	groupTests,
	medianTimes,
	parseTestList,
	parseTestTimes,
	runsInParallel,
	shardSeconds,
	splitByWeights,
} from './lib/shard-weights.ts';

/** The workflow whose browser job the weights are for. */
const WORKFLOW = '.github/workflows/ci.yml';
/** The weights in the workflow, one per shard, joined by colons. */
const WEIGHTS_LINE = /PWTEST_SHARD_WEIGHTS: "([\d:]+)"/;
/** The tests that a job of their own runs, which the shards leave out: S6's, which load the city. */
const CITY_LINE = /CITY_TESTS: '([^']+)'/;
/** The count of CI runs whose median test times the weights come from, by default. */
const DEFAULT_RUNS = 5;
/** The count of main's newest passing runs to search for runs with browser jobs. */
const SEARCH_RUNS = 50;
/** The workers of each shard: Playwright's default of half the cores of CI's two-core runners. */
const WORKERS = 2;

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};

function run(
	command: string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): string {
	const result = Bun.spawnSync(command, {
		cwd: options.cwd ?? root,
		env: { ...process.env, ...options.env },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (result.exitCode !== 0) {
		throw new Error(`${command.join(' ')} failed:\n${result.stderr.toString()}`);
	}
	return result.stdout.toString();
}

async function runAsync(command: string[]): Promise<string> {
	const child = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`${command.join(' ')} failed:\n${err}`);
	return out;
}

const minutes = (seconds: number) => (seconds / 60).toFixed(1);
const report = (seconds: number[]) =>
	`${seconds.map(minutes).join(' ')} minutes, slowest ${minutes(Math.max(...seconds))}`;

const workflow = readFileSync(join(root, WORKFLOW), 'utf8');
const current = WEIGHTS_LINE.exec(workflow)?.[1];
if (!current) throw new Error(`${WORKFLOW} has no PWTEST_SHARD_WEIGHTS`);
const cityPattern = CITY_LINE.exec(workflow)?.[1];
if (!cityPattern) throw new Error(`${WORKFLOW} has no CITY_TESTS`);
const cityTests = new RegExp(cityPattern);
const currentWeights = current.split(':').map(Number);
const shards = Number(option('--shards') ?? currentWeights.length);

/** A job of a CI run, as `gh run view --json jobs` gives it. */
interface Job {
	databaseId: number;
	name: string;
	conclusion: string;
}

/** The browser jobs of a CI run that ran. A skipped job is listed too, with no log. */
function browserJobs(runId: string): Job[] {
	return (
		JSON.parse(run(['gh', 'run', 'view', runId, '--json', 'jobs'])) as { jobs: Job[] }
	).jobs.filter((job) => job.name.startsWith('browser (') && job.conclusion !== 'skipped');
}

/**
 * The runs whose test times count, each with its browser jobs: the runs that --run names, or else
 * main's newest passing runs that ran the browser job. Main's runs from before D-99 kept only
 * caches and ran no browser job, so the search skips them.
 */
function chooseRuns(): { id: string; jobs: Job[] }[] {
	const named = args.flatMap((arg, at) => (args[at - 1] === '--run' ? [arg] : []));
	if (named.length > 0)
		return named.map((id) => {
			const jobs = browserJobs(id);
			if (jobs.length === 0) throw new Error(`CI run ${id} has no browser jobs`);
			return { id, jobs };
		});
	const count = Number(option('--runs') ?? DEFAULT_RUNS);
	const listed = run([
		'gh',
		'run',
		'list',
		'--workflow',
		'ci.yml',
		'--branch',
		'main',
		'--status',
		'success',
		'--limit',
		String(SEARCH_RUNS),
		'--json',
		'databaseId',
		'--jq',
		'.[].databaseId',
	])
		.split('\n')
		.filter(Boolean);
	const chosen: { id: string; jobs: Job[] }[] = [];
	for (const id of listed) {
		if (chosen.length === count) break;
		const jobs = browserJobs(id);
		if (jobs.length > 0) chosen.push({ id, jobs });
	}
	if (chosen.length === 0)
		throw new Error(
			`none of main's ${SEARCH_RUNS} newest passing CI runs ran the browser job; name runs with --run <id>`,
		);
	return chosen;
}

/** Each test's time in one CI run, from the logs of its browser jobs. */
async function runTimes(jobs: readonly Job[]): Promise<Map<string, number>> {
	const logs = await Promise.all(
		jobs.map((job) =>
			runAsync([
				'gh',
				'api',
				'--allow-escape-sequences',
				`repos/{owner}/{repo}/actions/jobs/${job.databaseId}/logs`,
			]),
		),
	);
	return parseTestTimes(logs.join('\n'));
}

const runs = chooseRuns();
const runIds = runs.map(({ id }) => id);
const eachRun = await Promise.all(runs.map(({ jobs }) => runTimes(jobs)));
const times = medianTimes(eachRun);
console.log(
	`CI runs ${runIds.join(', ')}: the median time of each of ${times.size} tests in their browser jobs.`,
);

// One list of every project: the alone projects hold the tests that run alone, and the others hold
// the shards' tests in the order that the shards split them.
const listed = parseTestList(
	run(['bunx', 'playwright', 'test', '--list'], { cwd: join(root, 'tests'), env: { CI: '1' } }),
);
const testDir = join(root, 'tests/image');
const parallelFiles = new Set(
	readdirSync(testDir).filter(
		(file) =>
			file.endsWith('.spec.ts') && runsInParallel(readFileSync(join(testDir, file), 'utf8')),
	),
);
const alone = listed.filter((test) => test.project.endsWith(ALONE_PROJECT_SUFFIX));
const sharded = listed.filter(
	(test) => !test.project.endsWith(ALONE_PROJECT_SUFFIX) && !cityTests.test(test.title),
);

const { groups, missing } = groupTests(sharded, times, parallelFiles);
console.log(
	`Shards: ${sharded.length} tests in ${groups.length} groups, ${WORKERS} workers each; ${missing} tests have no time in the runs and take their file's mean.`,
);
const runGroups = eachRun.map((one) => groupTests(sharded, one, parallelFiles).groups);
/** Prints the modelled shard times of the weights, with the median times and with each run's. */
function show(label: string, weights: number[]): void {
	const modelled = splitByWeights(groups, weights).map((part) => shardSeconds(part, WORKERS));
	const slowest = runGroups.map((one) =>
		Math.max(...splitByWeights(one, weights).map((part) => shardSeconds(part, WORKERS))),
	);
	console.log(`${label} ${weights.join(':')}: ${report(modelled)}`);
	console.log(`  slowest shard in each run: ${slowest.map(minutes).join(' ')} minutes`);
}
if (currentWeights.length === shards) show('Weights now ', currentWeights);
show('Best weights', bestWeights([groups, ...runGroups], shards, WORKERS));

const aloneGroups = groupTests(alone, times, new Set()).groups;
console.log(
	`Tests that run alone (${ALONE_TAG}): ${alone.length} tests, ${minutes(shardSeconds(aloneGroups, 1))} minutes one after another.`,
);
