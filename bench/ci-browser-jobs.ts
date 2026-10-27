// Prints the jobs of the gate commit's CI run, for the gate's software-renderer picture step. That
// step judges the image test manifest as CI drew it on Linux SwiftShader, which is the authority
// for those pictures, rather than drawing them again on the Mac. The gate counts a run of a push to
// main or one started by hand, as its workflows step does (D-99): a push to a milestone branch runs
// no browser jobs. From the repository root:
//   bun bench/ci-browser-jobs.ts <commit>
// It needs the GitHub CLI with access to the repository. The output is one JSON object, which
// `browserPictures` in bench/lib/gate.ts judges: the counted run, or null, and its jobs.
import { execFileSync } from 'node:child_process';
import {
	countedRun,
	GATE_WORKFLOWS,
	REPOSITORY,
	type WorkflowJob,
	type WorkflowRun,
	wholeCommit,
} from './lib/gate.ts';

const commit = process.argv[2];
if (!commit) {
	console.error('usage: bun bench/ci-browser-jobs.ts <commit>');
	process.exit(2);
}

/**
 * The environment of a git command that must read the repository its own working directory names.
 * A hook that starts this tool hands its repository to every process it starts, and git obeys that
 * over the directory, so the variables that name a repository come out here.
 */
function repositoryEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const name of [
		'GIT_DIR',
		'GIT_WORK_TREE',
		'GIT_INDEX_FILE',
		'GIT_COMMON_DIR',
		'GIT_OBJECT_DIRECTORY',
		'GIT_ALTERNATE_OBJECT_DIRECTORIES',
		'GIT_NAMESPACE',
		'GIT_PREFIX',
	])
		delete env[name];
	return env;
}

const sha = wholeCommit(commit, (args) =>
	execFileSync('git', args, { encoding: 'utf8', env: repositoryEnv() }),
);
if (sha === null) {
	console.error(`ci-browser-jobs: ${commit} is not a commit of this repository`);
	process.exit(2);
}

const gh = (...args: string[]) =>
	execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const runs = JSON.parse(
	gh(
		'run',
		'list',
		'--repo',
		REPOSITORY,
		'--commit',
		sha,
		'--workflow',
		'ci.yml',
		'--json',
		'databaseId,workflowName,event,headBranch,status,conclusion',
	),
) as WorkflowRun[];
const workflow = GATE_WORKFLOWS.find(({ name }) => name === 'CI');
if (!workflow) throw new Error('the gate lists no CI workflow');
const run = countedRun(runs, workflow);
if (!run) {
	console.log(JSON.stringify({ run: null, jobs: [] }));
	process.exit(0);
}
const jobs = (
	JSON.parse(gh('run', 'view', String(run.databaseId), '--repo', REPOSITORY, '--json', 'jobs')) as {
		jobs: WorkflowJob[];
	}
).jobs.map(({ name, status, conclusion }) => ({ name, status, conclusion }));
console.log(JSON.stringify({ run, jobs }));
