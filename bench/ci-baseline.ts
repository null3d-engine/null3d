// Prints the commit that the benchmark job compares a push to main with: the last commit on main
// that a push run of the Benchmarks workflow measured, or the commit before the new one when there
// is none. A run measured its commit when it finished its comparison, passed or failed.
// bench/lib/baseline.ts says why. The benchmark workflow runs it with GH_TOKEN set, from a checkout
// that holds main's history:
//   bun bench/ci-baseline.ts <new commit>
import { execFileSync, spawnSync } from 'node:child_process';
import { chooseBaseline, finishedComparison, type MainRun, type RunJob } from './lib/baseline';

/** How many of the workflow's latest finished push runs the search reads. */
const RUNS = 50;

const REPO = process.env.GITHUB_REPOSITORY;

const run = (command: string, args: string[]) =>
	execFileSync(command, args, { encoding: 'utf8' }).trim();

/** The workflow's finished push runs on main, newest first, whatever their result. */
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
			'--event',
			'push',
			'--status',
			'completed',
			'--limit',
			String(RUNS),
			'--json',
			'databaseId,headSha',
			'--jq',
			'[.[] | {id: .databaseId, headSha}]',
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
	const isAncestor = (commit: string) =>
		spawnSync('git', ['merge-base', '--is-ancestor', commit, newCommit]).status === 0;
	const measured = chooseBaseline(newCommit, finishedRuns(), isAncestor, (r) =>
		finishedComparison(jobsOf(r)),
	);
	console.error(
		measured
			? 'The baseline is the last commit on main that a benchmark run measured, passed or failed.'
			: 'No benchmark run on main has measured an earlier commit, so the baseline is the commit before.',
	);
	console.log(measured ?? run('git', ['rev-parse', `${newCommit}^`]));
}

if (import.meta.main) main();
