// Pre-push guard: refuses a range that puts a second copy of a commit on the branch. A
// history rewrite gives every rewritten commit a new id and keeps its subject, its author's date and
// its change, so a branch started before the rewrite carries the old copies, and merging it puts
// both copies on the branch with no conflict and no change to any tree. On 25 October 2026 such a
// merge brought the rewritten commits back to the milestone branch. A commit of the range is a copy
// when another commit that the range's head reaches has the same subject, the same author's date
// and the same change, by `git patch-id`. A fix that is cherry-picked onto the rewritten history
// shares its subject and date with the old one, but the old one is not reached from the head, so
// it is no copy. A change that lands again after a revert takes a new author's date. The push hook
// checks the commits that a push adds, against every commit that the pushed head reaches. Pairs
// that the milestone branch took before the rule are known by their ids and pass, so the branch
// can still land on main; an old copy that a rewritten branch brings back has another id.
//   bun tools/hooks/check-copies.ts <base>..<head>
import { spawnSync } from 'node:child_process';

/** A commit that is not a merge, by its id, its author's date and its subject. */
export interface CommitLine {
	readonly sha: string;
	readonly date: string;
	readonly subject: string;
}

/**
 * The pairs of copies that the milestone branch took from 21 to 25 October 2026, before the rule:
 * helper branches landed twice, as a rebase of them and as the branch itself. Each pair holds the
 * same change twice, so neither copy changes the tree.
 */
export const KNOWN_COPIES: readonly (readonly [string, string])[] = [
	['000107daa8d1074979196866bc406cd12b2425f7', '3e1b8e29b752b36c1d69787de68cb66337a043c6'],
	['1cecc234ab487070bcb55efb6af15ad2cf5d7dd1', 'f841e7e73cc776bcf64be78df75c21a6f472685b'],
	['22d6210c8d30c180e4828c7731206322d8013a09', '917ec4bea651cbbfd274291245cee9e0eb8477e2'],
	['4b995f6e5768f815dc10219dd6599c98fae4525b', 'ab4e0c992c6d0b28a287ee03dc1eb210beceb7e2'],
	['5700db91736494ff1f9e8518513c011caaf5328b', '6bc5c1e0a775e884bc1d6002f90653f84a7a9a43'],
	['63dc7feddf6218fac4a66a6103801362d77e66e8', '63eca592ff4ea5c8cc0d64cb2b2a8c4d9cff2230'],
	['6c91d0a2e081baa9ca4adb31d6fa0c25c51feae8', 'cade2ce334e3ddeed98ce4b44211b4a364d36902'],
	['8a38f6684fbe8898776a2c963bd37a003ce35098', 'ae2cb187a7a07866db9e344958c1e5cf195c3ced'],
	['8d2b5c68498f5d1dff1fd9e36399527c94af6247', 'a1d6bcb94202cb5f27b92d47fc6812d87d801c9d'],
	['a5b1a151945411642da59e97fea91b00a96073dd', 'df2593ddca2302ccb45f9ec6b12519bce58c7a68'],
	['a5f4db11d2428538662a8e93e1e6ef9214c9e155', 'ab2307002e97656e233e9263d8be115a3c4680aa'],
	['a78512faafd13c4ec68e6e01782fec32b63be7ae', 'e4490963c174b89f2331b274a7c94d5c1e543170'],
	['ac798ff019c2bfc7a5f6632c424be3e10fbf13a2', 'dc54814e7670a72ff6c93fe1e3a7132a73e9dbe8'],
	['b3e81d903ef6b433cd73b98131a368c8b763b74c', 'ebbb5b1be08edd74bd88f944fc7273d367492b02'],
];

/** The most commits that the check reads from the head, far more than a branch holds. */
const MOST_COMMITS = 50_000;

function git(args: string[], input?: string): string {
	const result = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 1 << 30 });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

/**
 * Each commit of `inRange` that repeats another commit of `reached`, with that commit: the same
 * author's date and subject, and the same change by `changeOf`. A pair whose two commits are both in
 * the range is named once. Only the pairs that share a date and a subject have their changes
 * compared, so the check reads few diffs.
 */
export function copiesOf(
	reached: readonly CommitLine[],
	inRange: ReadonlySet<string>,
	changeOf: (sha: string) => string,
	known: readonly (readonly [string, string])[] = KNOWN_COPIES,
): [copy: string, of: string][] {
	const knownPair = new Set(known.flatMap(([a, b]) => [`${a} ${b}`, `${b} ${a}`]));
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
		const named = new Set<string>();
		for (const commit of group) {
			if (!inRange.has(commit.sha) || named.has(commit.sha)) continue;
			const other = group.find(
				({ sha }) =>
					sha !== commit.sha &&
					changes.get(sha) === changes.get(commit.sha) &&
					!knownPair.has(`${commit.sha} ${sha}`),
			);
			if (!other) continue;
			copies.push([commit.sha, other.sha]);
			named.add(commit.sha).add(other.sha);
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
	console.error(`${range} puts a second copy of a commit on the branch, ${copies.length} times:`);
	for (const [copy, of] of copies)
		console.error(
			`  ${copy.slice(0, 9)} repeats ${of.slice(0, 9)}: the same subject, author's date and change`,
		);
	console.error(
		'A branch started before a history rewrite carries the old copies. Take its own commits onto the current branch with `git cherry-pick` instead of merging it. A change that lands again after a revert takes a new date: `git commit --amend --no-edit --date=now`.',
	);
	process.exit(1);
}
