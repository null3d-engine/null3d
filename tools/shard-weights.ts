// Works out the shard weights of CI's browser job and of its job of heavy tests from the test times of
// recent CI runs, and prints each shard's modelled time with the weights in the workflow and with the
// best weights:
//   bun run test:browser-weights                 take each test's median time in the last CI runs on
//                                                main that passed and ran the browser job
//   bun run test:browser-weights --runs <n>      take the median of that many runs
//   bun run test:browser-weights --run <id>      take the times from that CI run; give it more than once
//                                                for the median of several
//   bun run test:browser-weights --shards <n>    find weights for that many shards
//   bun run test:browser-weights --target <min>  fill each shard to about that many minutes, with as
//                                                many shards as that takes
//   bun run test:browser-weights --heavy-shards <n>  find weights for that many shards of the heavy tests
// It needs the GitHub CLI. `.dev/image-tests.md` says when to retune the weights.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALONE_PROJECT_SUFFIX, ALONE_TAG } from '../tests/lib/alone.ts';
import { PRODUCTION_PAGES_SWITCH } from '../tests/lib/server.ts';
import { gh, ghAsync } from './lib/gh.ts';
import { SHARD_TOTAL_ENV } from './lib/shard-groups-reporter.ts';
import {
	bestWeights,
	fillWeights,
	medianTimes,
	parseTestGroups,
	parseTestList,
	parseTestTimes,
	shardSeconds,
	splitByWeights,
	timedGroups,
} from './lib/shard-weights.ts';

/** The workflow whose browser job the weights are for. */
const WORKFLOW = '.github/workflows/ci.yml';
/** The weights in the workflow, one per shard, joined by colons. */
const WEIGHTS_LINE = /PWTEST_SHARD_WEIGHTS: "([\d:]+)"/;
/** The tests that a job of their own runs, which the shards leave out: S6's, which load the city. */
const CITY_LINE = /CITY_TESTS: '([^']+)'/;
/** The heavy tests, which a job of their own runs one at a time and the shards leave out. */
const HEAVY_LINE = /HEAVY_TESTS: '([^']+)'/;
/** The start of the job of the heavy tests, whose weights follow it in the workflow. */
const HEAVY_JOB = '\n  browser-heavy:\n';
/** The count of CI runs whose median test times the weights come from, by default. */
const DEFAULT_RUNS = 5;
/** The count of main's newest passing runs to search for runs with browser jobs. */
const SEARCH_RUNS = 50;
/** The workers of each shard: Playwright's default of half the cores of CI's four-core runners. */
const WORKERS = 2;
/** The workers of each shard of the heavy tests, which run one at a time. */
const HEAVY_WORKERS = 1;

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

const minutes = (seconds: number) => (seconds / 60).toFixed(1);
const report = (seconds: number[]) =>
	`${seconds.map(minutes).join(' ')} minutes, slowest ${minutes(Math.max(...seconds))}`;

const workflow = readFileSync(join(root, WORKFLOW), 'utf8');
const current = WEIGHTS_LINE.exec(workflow)?.[1];
if (!current) throw new Error(`${WORKFLOW} has no PWTEST_SHARD_WEIGHTS`);
const cityPattern = CITY_LINE.exec(workflow)?.[1];
if (!cityPattern) throw new Error(`${WORKFLOW} has no CITY_TESTS`);
const heavyPattern = HEAVY_LINE.exec(workflow)?.[1];
if (!heavyPattern) throw new Error(`${WORKFLOW} has no HEAVY_TESTS`);
const heavyCurrent = WEIGHTS_LINE.exec(workflow.slice(workflow.indexOf(HEAVY_JOB)))?.[1];
if (!workflow.includes(HEAVY_JOB) || !heavyCurrent)
	throw new Error(`${WORKFLOW} has no browser-heavy job with PWTEST_SHARD_WEIGHTS`);
const currentWeights = current.split(':').map(Number);
const shards = Number(option('--shards') ?? currentWeights.length);
const heavyWeights = heavyCurrent.split(':').map(Number);
const heavyShards = Number(option('--heavy-shards') ?? heavyWeights.length);

/** A job of a CI run, as the jobs listing of its newest attempt gives it. */
interface Job {
	databaseId: number;
	name: string;
	conclusion: string;
}

/**
 * The browser jobs of a CI run's newest attempt that ran. A skipped job is listed too, with no log.
 * The listing reads 50 jobs a page: GitHub answered every request of 100 a page with HTTP 502 for a
 * run of 137 jobs, where pages of 50 came back.
 */
function browserJobs(runId: string): Job[] {
	return gh(
		[
			'api',
			'--paginate',
			`repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=50&filter=latest`,
			'--jq',
			'.jobs[] | {databaseId: .id, name, conclusion} | tojson',
		],
		root,
	)
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Job)
		.filter((job) => job.name.startsWith('browser (') && job.conclusion !== 'skipped');
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
	const listed = gh(
		[
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
		],
		root,
	)
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
			ghAsync(
				[
					'api',
					'--allow-escape-sequences',
					`repos/{owner}/{repo}/actions/jobs/${job.databaseId}/logs`,
				],
				root,
			),
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

// The tests that each job's shards run, in the groups and the order in which Playwright splits them,
// as CI selects them: without the production build, which a job of its own runs. The browser job's
// shards leave out the tests that run alone, the heavy tests and S6's, which have jobs of their own.
const listEnv = { CI: '1', [PRODUCTION_PAGES_SWITCH]: 'skip' };
const listGroups = (filter: string[], shardTotal: number) =>
	parseTestGroups(
		run(
			[
				'bunx',
				'playwright',
				'test',
				'--list',
				'--reporter',
				join(root, 'tools/lib/shard-groups-reporter.ts'),
				...filter,
			],
			{ cwd: join(root, 'tests'), env: { ...listEnv, [SHARD_TOTAL_ENV]: String(shardTotal) } },
		),
	);
const shardedGroups = listGroups(
	['--grep-invert', `${ALONE_TAG}|${cityPattern}|${heavyPattern}`],
	shards,
);
const heavyGroups = listGroups(['--grep', heavyPattern, '--grep-invert', ALONE_TAG], heavyShards);
const alone = parseTestList(
	run(['bunx', 'playwright', 'test', '--list'], { cwd: join(root, 'tests'), env: listEnv }),
).filter((test) => test.project.endsWith(ALONE_PROJECT_SUFFIX));

/**
 * Prints the best weights of one job's shards, and its weights in the workflow when they fit its
 * shard count, each with the modelled shard times of the median times and of each run's.
 */
function weigh(
	job: string,
	tests: ReturnType<typeof listGroups>,
	workers: number,
	count: number,
	current: number[],
): void {
	const { groups, missing } = timedGroups(tests, times);
	console.log(
		`${job}: ${tests.flat().length} tests in ${groups.length} groups, ${workers} workers each; ${missing} tests have no time in the runs and take their file's mean.`,
	);
	const runGroups = eachRun.map((one) => timedGroups(tests, one).groups);
	const show = (label: string, weights: number[]) => {
		const modelled = splitByWeights(groups, weights).map((part) => shardSeconds(part, workers));
		const slowest = runGroups.map((one) =>
			Math.max(...splitByWeights(one, weights).map((part) => shardSeconds(part, workers))),
		);
		console.log(`${label} ${weights.join(':')}: ${report(modelled)}`);
		console.log(`  slowest shard in each run: ${slowest.map(minutes).join(' ')} minutes`);
	};
	if (current.length === count) show('Weights now ', current);
	show('Best weights', bestWeights([groups, ...runGroups], count, workers));
	const target = option('--target');
	if (target !== undefined) {
		const filled = fillWeights([groups, ...runGroups], workers, Number(target) * 60);
		show(`Weights to ${target} minutes, ${filled.length} shards`, filled);
	}
}
weigh('The browser job', shardedGroups, WORKERS, shards, currentWeights);
weigh('The heavy tests (browser-heavy)', heavyGroups, HEAVY_WORKERS, heavyShards, heavyWeights);

const aloneGroups = timedGroups(
	alone.map((test) => [test]),
	times,
).groups;
console.log(
	`Tests that run alone (${ALONE_TAG}): ${alone.length} tests, ${minutes(shardSeconds(aloneGroups, 1))} minutes one after another.`,
);
