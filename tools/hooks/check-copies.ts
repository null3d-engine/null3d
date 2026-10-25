// Pre-push and CI guard: refuses a range that puts a second copy of a commit on the branch. A
// history rewrite gives every rewritten commit a new id and keeps its subject, its author's date and
// its change, so a branch started before the rewrite carries the old copies, and merging it puts
// both copies on the branch with no conflict and no change to any tree. On 25 October 2026 such a
// merge brought the rewritten commits back to the milestone branch. A commit of the range is a copy
// when another commit that the range's head reaches has the same subject, the same author's date
// and the same change, by `git patch-id`. A fix that is cherry-picked onto the rewritten history
// shares its subject and date with the old one, but the old one is not reached from the head, so
// it is no copy. A change that lands again after a revert takes a new author's date. The push hook
// checks only the commits that a push adds, against every commit the branch already holds. The
// milestone branch already holds a few such pairs from before the rule, and a range that adds none
// passes, so the check never runs over the whole branch.
//   bun tools/hooks/check-copies.ts <base>..<head>
import { spawnSync } from 'node:child_process';

/** A commit that is not a merge, by its id, its author's date and its subject. */
export interface CommitLine {
	readonly sha: string;
	readonly date: string;
	readonly subject: string;
}

/** The most commits that the check reads from the head, far more than a branch holds. */
const MOST_COMMITS = 50_000;

function git(args: string[], input?: string): string {
	const result = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 1 << 30 });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

/**
 * Each commit of `inRange` that repeats another commit of `reached`, with that commit: the same
 * author's date and subject, and the same change by `changeOf`. Only the pairs that share a date and
 * a subject have their changes compared, so the check reads few diffs.
 */
export function copiesOf(
	reached: readonly CommitLine[],
	inRange: ReadonlySet<string>,
	changeOf: (sha: string) => string,
): [copy: string, of: string][] {
	const byKey = new Map<string, CommitLine[]>();
	for (const commit of reached) {
		const key = `${commit.date}\t${commit.subject}`;
		const group = byKey.get(key);
		if (group) group.push(commit);
		else byKey.set(key, [commit]);
	}
	const copies: [string, string][] = [];
	for (const group of byKey.values()) {
		if (group.length < 2 || !group.some(({ sha }) => inRange.has(sha))) continue;
		const changes = new Map(group.map(({ sha }) => [sha, changeOf(sha)]));
		for (const commit of group) {
			if (!inRange.has(commit.sha)) continue;
			const other = group.find(
				({ sha }) => sha !== commit.sha && changes.get(sha) === changes.get(commit.sha),
			);
			if (other) copies.push([commit.sha, other.sha]);
		}
	}
	return copies;
}

/** The change of a commit, as `git patch-id --stable` names it. */
function patchId(sha: string): string {
	return git(['patch-id', '--stable'], git(['show', '--no-color', sha])).split(' ')[0] ?? '';
}

if (import.meta.main) {
	const range = process.argv[2];
	const head = range?.split('..')[1];
	if (!range || !head) {
		console.error('usage: bun tools/hooks/check-copies.ts <base>..<head>');
		process.exit(2);
	}
	const reached = git([
		'log',
		'--no-merges',
		`--max-count=${MOST_COMMITS}`,
		'--format=%H%x09%aI%x09%s',
		head,
	])
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [sha = '', date = '', ...subject] = line.split('\t');
			return { sha, date, subject: subject.join('\t') };
		});
	const inRange = new Set(git(['rev-list', '--no-merges', range]).split('\n').filter(Boolean));
	const copies = copiesOf(reached, inRange, patchId);
	if (copies.length === 0) {
		console.log(`no commit in ${range} repeats one that its head already holds`);
		process.exit(0);
	}
	console.error(`${range} puts a second copy of ${copies.length} commits on the branch:`);
	for (const [copy, of] of copies)
		console.error(
			`  ${copy.slice(0, 9)} repeats ${of.slice(0, 9)}: the same subject, author's date and change`,
		);
	console.error(
		'A branch started before a history rewrite carries the old copies. Take its own commits onto the current branch with `git cherry-pick` instead of merging it. A change that lands again after a revert takes a new date: `git commit --amend --no-edit --date=now`.',
	);
	process.exit(1);
}
