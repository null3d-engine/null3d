// Checks the trailers on every commit in a range that main's squash keeps, so a commit made with
// --no-verify cannot skip them: the acknowledgement trailers, that each Size-Growth trailer names a
// file and gives a reason, that a pull request that changes how the GPU draws records its GPU
// check, and that one that remakes SwiftShader references remakes the real-GPU ones or says why
// not. CI runs it on pull requests:
//   bun tools/hooks/check-trailers.ts origin/main..HEAD
import { execFileSync } from 'node:child_process';
import { DOCS_ACK_RULE } from './check-docs-ack';
import { type CommitWithFiles, gpuCheckProblem } from './check-gpu-ack';
import { macReferencesProblem } from './check-mac-references';
import { sizeGrowthProblems } from './check-size-growth';
import { SKILLS_ACK_RULE } from './check-skills-ack';
import { checkAck } from './commit-ack';

const RULES = [DOCS_ACK_RULE, SKILLS_ACK_RULE];

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

/** A commit that main's squash of a pull request keeps. */
export interface KeptCommit {
	sha: string;
	/** The author time, in ISO 8601. */
	authoredAt: string;
	message: string;
}

/**
 * The commits of a range that main's squash of a pull request keeps, newest first: every commit but
 * the merge commits. The squash writes the messages of the commits it keeps into main's commit and
 * drops the merge commits' messages, so a trailer counts only on a kept commit. A trailer on a merge
 * commit would pass a pull request's checks and then be gone on main.
 */
export function keptCommits(range: string, cwd?: string): KeptCommit[] {
	const log = execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%aI%x1f%B%x1e', range], {
		cwd,
		encoding: 'utf8',
	});
	return log
		.split('\x1e')
		.map((entry) => entry.trim().split('\x1f'))
		.filter(([sha]) => sha)
		.map(([sha = '', authoredAt = '', message = '']) => ({ sha, authoredAt, message }));
}

function main(): void {
	const range = process.argv[2];
	if (!range) {
		console.error('usage: bun tools/hooks/check-trailers.ts <base>..<head>');
		process.exit(2);
	}
	const failures: string[] = [];
	const commits: CommitWithFiles[] = [];
	for (const { sha, authoredAt, message } of keptCommits(range)) {
		const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)
			.split('\n')
			.filter(Boolean);
		commits.push({ sha, message, files });
		const commit = `${sha.slice(0, 8)} ${message.split('\n')[0]}`;
		for (const rule of RULES) {
			const result = checkAck(message, files, rule, authoredAt);
			if (!result.ok) failures.push(`${commit}: ${result.error}`);
		}
		for (const problem of sizeGrowthProblems(message)) failures.push(`${commit}: ${problem}`);
	}
	for (const problem of [gpuCheckProblem(commits), macReferencesProblem(commits)])
		if (problem) failures.push(problem);
	if (failures.length === 0) {
		console.log(`trailers OK in ${range}`);
		return;
	}
	for (const f of failures) console.error(f);
	console.error(
		'\nAmend or reword these commits to add or fix the trailers (AGENTS.md, "Commit gates").',
	);
	process.exit(1);
}

if (import.meta.main) main();
