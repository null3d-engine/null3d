// Pre-push guard: refuses a range that puts a second copy of a commit on the branch. A history
// rewrite gives every rewritten commit a new id and keeps its subject, its author's date and its
// change, so a branch started before the rewrite carries the old copies, and merging it puts both
// copies on the branch with no conflict and no change to any tree. A commit of the range is a copy
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
 * The pairs of copies that the milestone branch took before the rule: helper branches that landed
 * twice, as a rebase of them and as the branch itself. Each pair holds the same change twice, so
 * neither copy changes the tree.
 */
export const KNOWN_COPIES: readonly (readonly [string, string])[] = [
	['ac6fe9247059cca238f78399332ed81d759f1709', '8d7b799a2876f401415a0db34dd69fd1a28117b9'],
	['6b2db9549e4b794f0ce082be24b4df0a0bbdf71c', '2f2355fab993b3370280d14897943eeb7dac69c0'],
	['5c44ea4234c2ad232ebb10076eedccdd79914cfc', '68566dbe2e60aa8ab9affa89c1de35130f42ef6d'],
	['0cf8a180dd2634d173d618d2ffa24c67ceb2d58b', '15290d811d93d9c31ccff1e89cba95b4cd66db92'],
	['ca2c6ec5eee834e95df15581912765b3885a2b5c', '772b1af673b9d8700aa34cf2e7bef56b46dc159f'],
	['c11437e52add7800cc755d99a89c8388e87e9e68', 'cb3e4b7062173f06f1f2d16385627ba2bb8539cb'],
	['d0933c0644990f2c09d920d7009d8b54c143e348', '7a8c9aaf7d3410dbae7c849d0a5cc381cc53c3ee'],
	['5c6484302f23c0882b945dd3f636998cb645de3d', '24f7fc30e8588b3a84ac8bbc44c8906403ea2552'],
	['63e7b74245d4bd6bf1e6e51fe72d6e24c32898ba', '8cba83740626cf542a4b461cad0ae3a3e258a691'],
	['5f599f79f84edcda7d64e5260b76bac06291ec9d', 'b5197c24182729004e6b641ec9728067b1b10f6e'],
	['bf792fb1c275877b83bb75fac768c740dee28d30', '0a5fd64eb219ec9644b81543d313806384ad977b'],
	['fd88167aee78e68f154671b68d68f0f70c80f284', '3797dc53c405d2507dba39f8b024a5171f7210b6'],
	['2012beec3c90331fe836de570292e83a05a13493', 'e1220f4926ae87ab835b8064b1037df7d20fad1b'],
	['b1020951aeba01b973bfd4fef5c85173cfde0be9', 'e7cfa97138cab30606c176d67a1f5ee0dabccf75'],
	// The sedge's copy of the plant-review grass-blade fix. The meadow grass branch landed the same
	// change first, and `b06363e8c` is already on the milestone branch; the sedge carried it again
	// as `bcfce2dd8`, and an earlier integration carried it as `c3bccf445`. Dropping either would
	// re-commit commits that the milestone branch already holds, so they stay as known copies;
	// none of them changes the tree.
	['bcfce2dd8fe31c29df44fc3f95e63923dc98c06f', 'b06363e8cbec98ceef8a867ab37efd4c06e135e2'],
	['c3bccf4454b8ccf5a41088485ac05f00db0d5ee5', 'b06363e8cbec98ceef8a867ab37efd4c06e135e2'],
	// The species series the redraw carries, landed once on the milestone before this branch was
	// rebuilt: each pair is one change that reached the milestone by its own branch and the
	// redraw again by the replay, identical by `git patch-id`. They are listed so the redraw
	// can land; the pair is the range's copy first and the milestone's second.
	['a90c6862a41bb0da07e3e642fed5294a6947b816', 'e19dce4351274300a92bbb8e92f0c02c415884bd'],
	['14b19a55fc5275dcab69beed416fcb4afb66caa0', 'e9ee7c17fef2212f8f6cfba3db0bd20427628e14'],
	['d1697a654d3f72bed79f2ec410956ed9592b394f', '2f02c7c5ece33117ab32e25c1ca299fc521864a3'],
	['5c65656b0ca1fead138c6a5b0611610097e02329', '955a4cc313110b659e65478946144ae4041495da'],
	['d87a430bc13f9ad93690eb21eb306cc7578dba37', '5fd28986e20c9d19222dc6bfbb322285a9fed61f'],
	['c8177f898eab141d51eac24d7c33f278bb5cd940', '973368d707e34b9b367e13d6a04e27d4ed1ae503'],
	['0de644ef5f0a54227390cc066d63ab08aae046f7', '92f99ffd363b2d4cad43d8df6c953ea731455170'],
	['9fdde70a3c57a585fde7b2393e82d5f920e635bc', '776db88b4b35a994862fce730173de6187c65664'],
	['ee0973e312af5ac24b3fd4f1311f32019124daeb', '99c2d47356498d63e8a55c3f6d5f3894857cddb5'],
	['1342672dedc01280ab1c763147870f18653b176a', '2e2af1495927d754bb79a3bfc24e651783bb190a'],
	['d9fc19bf630dc4880819fe10b417505521681b44', '90c1fd29e69d8878e2e71d6e2c33f71f76473d12'],
	['04a78e965d45dc44e6bf65d4455d9d1a4965d623', 'f79aac3a06b4c83f953a7ba972e1727799c69f88'],
	['71a29d1f3c4bcda656c011d2061c597119f8e8b8', '9d2573323338732413ec65a80ade69b0b4290d89'],
	['b180e0ed0428b490694c38d3bbaa4562fdf8eaa9', 'bb322a644b9d5df80823bd77790b8260fce79298'],
	['f7397fd3332a6e9d75a7746f22fa0db7b2a0fdef', '9e5f0e46bab05433ccbeaf88776bbd50f8365a8f'],
	['740e2e21e2a4e5c76db252aaaf747005000cb9c3', '8560d5f7e002bfaac998828f9022342b0228aa3c'],
	['a09660722104953c69dfb1d9d4f693c859d3e3a6', '74ab197c6f3edd3d2d0847823d6b21de480625ec'],
	['1dde14fdd8cc010b1c1990af9715b66935c1d59e', 'cfb2fec1637a03414339f05c5571c0feadf96df6'],
	['5b19168d214b25149662564a190adab74eecbbeb', 'c5ccba8b8148b9dc13338636164ed5dc316a4b79'],
	['92b25bb2c6a4c1ae0e7e727e8fc57d9c32d7de43', 'fa3fb5ed39d0fd96fe8a67f43691cdc7c1d134ef'],
	['ac6ef64976628394f995e2b89c1b85eb2da87582', 'a5932d9bff451aab425e581db9da09d2308045aa'],
	['a8611e5bb03e2ac45a028ed4efdb7e10059f3ed7', '5c8891722036f994dcbab96f21436451a0e36463'],
	['4ece37244cd508a2edb84200a558e6bd76d88b02', 'f84be63793f98b394de14991fd1323d4dc65b681'],
	['10f05d51fc58105875dc02ed4c3dde61d228942b', '7da09ed0905155fb2ea849c90b4ab5cb849bcc15'],
	['45462b028bd3756b413e7b9c9c987dce52a5f79e', 'bbf5fb9c06ccfd6bc577a334458307f2d695a82e'],
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
