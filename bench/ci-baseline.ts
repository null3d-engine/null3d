// Prints the commit that main's benchmark run compares main's newest commit with: the last commit
// on main that a run of the Benchmarks workflow measured, or the commit before the new one when
// there is none. It prints nothing when a run already measured the new commit, as main has not
// moved since. A run measured its commit when it finished its comparison, passed or failed.
// bench/lib/baseline.ts says why. The benchmark workflow runs it with GH_TOKEN set, from a checkout
// that holds main's history:
//   bun bench/ci-baseline.ts <new commit>
import { execFileSync, spawnSync } from 'node:child_process';
import { finishedComparison, lastMeasured, type MainRun, type RunJob } from './lib/baseline';

/**
 * How many of the workflow's latest finished runs on main the search reads. A scheduled run starts
 * every day, also when main has not moved, so the list covers about a month without a merge.
 */
const RUNS = 30;

const REPO = process.env.GITHUB_REPOSITORY;

const run = (command: string, args: string[]) =>
	execFileSync(command, args, { encoding: 'utf8' }).trim();

/**
 * The workflow's finished scheduled runs on main, newest first, whatever their result. Before the
 * schedule, each push to main started a run, so those runs count too. A run started by hand can
 * measure any commit, so those runs do not.
 */
function finishedRuns(): MainRun[] {
	return JSON.parse(
		run('gh', [
			'run',
			'list',
			...(REPO ? ['--repo', REPO] : []),
			'--workflow',
			'bench.yml',
			'--branch',
			'main',
			'--status',
			'completed',
			'--limit',
			String(RUNS),
			'--json',
			'databaseId,headSha,event',
			'--jq',
			'[.[] | select(.event == "schedule" or .event == "push") | {id: .databaseId, headSha}]',
		]),
	) as MainRun[];
}

/** The jobs of a run's latest attempt, with their steps. */
function jobsOf({ id }: MainRun): RunJob[] {
	return JSON.parse(
		run('gh', [
			'api',
			`repos/${REPO ?? '{owner}/{repo}'}/actions/runs/${id}/jobs?per_page=100`,
			'--jq',
			'[.jobs[] | {name, steps: [.steps[]? | {name, conclusion}]}]',
		]),
	) as RunJob[];
}

function main(): void {
	const newCommit = process.argv[2];
	if (!newCommit) {
		console.error('usage: bun bench/ci-baseline.ts <new commit>');
		process.exit(2);
	}
	// git counts a commit as its own ancestor.
	const inHistory = (commit: string) =>
		spawnSync('git', ['merge-base', '--is-ancestor', commit, newCommit]).status === 0;
	const measured = lastMeasured(finishedRuns(), inHistory, (r) => finishedComparison(jobsOf(r)));
	if (measured === newCommit) {
		console.error('A benchmark run already measured this commit, so main has not moved since.');
		return;
	}
	console.error(
		measured
			? 'The baseline is the last commit on main that a benchmark run measured, passed or failed.'
			: 'No benchmark run on main has measured an earlier commit, so the baseline is the commit before.',
	);
	console.log(measured ?? run('git', ['rev-parse', `${newCommit}^`]));
}

if (import.meta.main) main();
