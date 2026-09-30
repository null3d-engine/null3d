// Prints the commit that the benchmark job compares a push to main with: the last commit on main
// that a successful push run of the Benchmarks workflow measured, or the commit before the new one
// when there is none. bench/lib/baseline.ts says why. The benchmark workflow runs it with GH_TOKEN
// set, from a checkout that holds main's history:
//   bun bench/ci-baseline.ts <new commit>
import { execFileSync, spawnSync } from 'node:child_process';
import { chooseBaseline } from './lib/baseline';

/** How many of the workflow's latest successful push runs the search reads. */
const RUNS = 50;

const run = (command: string, args: string[]) =>
	execFileSync(command, args, { encoding: 'utf8' }).trim();

/** The commits that successful push runs of the workflow on main measured, newest first. */
function measuredCommits(): string[] {
	const repo = process.env.GITHUB_REPOSITORY;
	return run('gh', [
		'run',
		'list',
		...(repo ? ['--repo', repo] : []),
		'--workflow',
		'bench.yml',
		'--branch',
		'main',
		'--event',
		'push',
		'--status',
		'success',
		'--limit',
		String(RUNS),
		'--json',
		'headSha',
		'--jq',
		'.[].headSha',
	])
		.split('\n')
		.filter(Boolean);
}

function main(): void {
	const newCommit = process.argv[2];
	if (!newCommit) {
		console.error('usage: bun bench/ci-baseline.ts <new commit>');
		process.exit(2);
	}
	const isAncestor = (commit: string) =>
		spawnSync('git', ['merge-base', '--is-ancestor', commit, newCommit]).status === 0;
	const measured = chooseBaseline(newCommit, measuredCommits(), isAncestor);
	console.error(
		measured
			? 'The baseline is the last commit on main that a benchmark job measured with success.'
			: 'No benchmark job on main has measured an earlier commit, so the baseline is the commit before.',
	);
	console.log(measured ?? run('git', ['rev-parse', `${newCommit}^`]));
}

if (import.meta.main) main();
