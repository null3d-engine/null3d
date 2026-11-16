// Pre-push guard: a merge commit holds only conflict resolutions and mechanical fixes (AGENTS.md,
// "Commit gates"). Git hides a merge's own edits from `git log -p`, `git log -S` and most review
// tools, so a feature, test or shading change written inside a merge has no commit of its own.
//
// For each merge it rebuilds the tree that git's automatic merge gives, conflict markers included
// (what `git show --remerge-diff` compares against), and reads the merge's changes from that tree:
// - inside a conflict, a resolution line must come from the sides: the same line give or take
//   spacing and numbers, or one with at most two words that neither side holds there;
// - outside a conflict, an added line must be a small edit of a line it replaces, or a short line,
//   whose new words a side added (an import renamed by the other side, an argument passed on);
// - a line that leaves one place and arrives at another moved, and counts as nothing.
// What is left is new work. A merge may hold a little of it, since a resolution sometimes needs a
// line of glue, but no new shader code and no binary file, such as an image reference, that it
// changed itself. Generated files and lock files are exempt, since a merge writes them again. A
// merge past the allowance is refused unless its message has a `Merge-Edit:` trailer that says why
// the edit belongs in the merge.
//   bun tools/hooks/check-merges.ts <base>..<head>
// It skips merges committed before the rule; --all checks them too. It always skips the merges that
// KNOWN_MERGES names, by the owner's ruling.
import { spawnSync } from 'node:child_process';
import { effectiveMessage, findAckValue, isBareAck } from './commit-ack';

/** The trailer that explains an edit in a merge beyond its resolutions. */
export const MERGE_EDIT_TRAILER = 'Merge-Edit';

/** Merges committed before this moment were made before the rule, and are not checked. */
export const MERGE_RULE_SINCE = '2026-10-15T14:28:48+0800';

/**
 * Merges on the milestone branch that hold new work beyond their resolutions, from before landings
 * ran this check. By the owner's ruling they stay, named here, and the rule holds for every other
 * merge: their content is on the branch, and rewriting them would risk more than it fixes (D-259).
 *
 * The owner widened this set, answering a request that named the forty-three merges bringing the
 * vegetation branches into the range, in their words: "they're in" (D-359). The work each of those
 * merges resolved stays on the branch, and the rule holds for every merge made from now on.
 */
export const KNOWN_MERGES: ReadonlySet<string> = new Set([
	'69cfc974716cd5db7a97407df87bddbfa1155865', // Merge commit '5f4aa0104' into m3-start
	'87e4843448054f20f5b19aab33770aab6893deeb', // Merge remote-tracking branch 'origin/m3-start' into fix/skyway-phone-weight
	'6fafb27b2b35b80025435f0eb0db787c26437b28', // Merge branch 'fix/skyway-phone-weight' into m3-start
	'954f2f1a84a6b45623fa436b77c48b3d2f0fe1dc', // Merge branch 'feat/m3-a11-taa-measure' into m3-start
	'2df8ed7d31b013d6bac556f6751f8be43878af9c', // refactor(engine): name the compute instance draw apart from the batch draw
	'eab7e749c6082583da3dea713d0606138438ef49', // Merge branch 'feat/m3-levels-red' into m3-start
	'42ab5431afc23ada0ae62a4d3787f656744b0084', // Merge the milestone branch into the cluster levels branch
	'5ff008ccecabafe143e32acf7fcf671078f7015c', // Merge the milestone branch into the cluster levels branch
	'b989845376b971e376653a349bf6ed197e8452dd', // Merge origin/m3-start into feat/m3-l1-rest
	// The owner's ruling (D-359): the vegetation integration merges, in their words "they're in".
	// Each comment names the merge and the words of work it carries.
	'4fc9e01395627630dcb43cf7955fd71234567200', // Merge remote-tracking branch 'origin/veg/trees-b' into veg/integrate-m3-wip — 696 words
	'da3c179f88fdfc1fbaa690533d6d5900d27f8645', // Merge remote-tracking branch 'origin/veg/trees' into veg/integrate-m3-wip — 135 words
	'092914fb38b7e059bacb31c16e854eefa5712f53', // Merge remote-tracking branch 'origin/veg/frames' into veg/integrate-m3-wip — 126 words
	'a74d82a63627fcd4930c2f18701196e8c5de272a', // Merge commit 'c038ad6ec' into veg/integrate — 67 words
	'e81f8b5e64cba68e661fb96e6e636f76e9375c79', // Merge remote-tracking branch 'origin/veg/pieces' into veg/trees — 31 words
	'54b623f129647e40591600ad5cd09116586dc309', // Merge remote-tracking branch 'origin/veg/conifers' into veg/integrate — 31 words
	'6da77cc179994466a76e370222247d2e67324dd3', // Merge branch 'feat/date-palm-rows' into veg/integrate — 58 words
	'5b54656812be56aca6d6d2eae17344300e87ec3c', // Merge remote-tracking branch 'origin/veg/lead' into feat/saguaro-rows — 275 words
	'a2b23f5bb8e2db964fa355664b3518c02220b5b7', // Merge commit 'f92ce2cee' into feat/leaf-optics — 58 words
	'1ff4bf1c88984007179af7f256bb256c6cd9c141', // Merge remote-tracking branch 'origin/veg/lead' into pkg/giant-sequoia — 36 words
	'859bb84c555c92890d35d5c3266fafa7b7e22e0e', // Merge remote-tracking branch 'origin/veg/lead' into pkg/italian-cypress — 373 words
	'1b52b0f87f75fc4623cc1f2f27599087d4b03777', // Merge origin/veg/lead into feat/crown-limb-mass — 2072 words
	'cb777ff801328a2c4ad77bcacac96e1aa7db41f3', // Merge remote-tracking branch 'origin/veg/lead' into feat/sedge-cut-assembly — 347 words
	'a078e150d1135224a34a95eccf7750a5eff6230b', // Merge origin/veg/lead into feat/crown-limb-mass — 2781 words
	'aac88fb36a55c0ccb0fd645c8aa2c50d81d3115b', // Merge origin/veg/lead into feat/review-masks — 39 words
	'3826fb7982bbdd2cb623aeae74e394beba50a400', // Merge remote-tracking branch 'origin/m3-start' into feat/review-masks — 846 words
	'bc7397371d655bfb54d9ad065608dac27693c112', // Merge remote-tracking branch 'origin/landing/v5-answers' into feat/holm-oak-rows — 150 words
	'b85a125ad846c74894ee575daac8b5d1e23d29eb', // Merge remote-tracking branch 'origin/m3-start' into feat/bracken-crown — 268 words
	'9816da643fe0bd850fadbb540afd4c25f337ca16', // Merge remote-tracking branch 'origin/m3-start' into feat/olive-rows — 153 words
	'0a9621885ba3cd1cbdf5f948c7a08044cd43ec57', // Merge remote-tracking branch 'origin/m3-start' into feat/close-subject — 84 words
	'6da6e61c82996dd4abdc1127fed57636b79a9beb', // Merge remote-tracking branch 'origin/m3-start' into feat/review-masks — 1305 words
	'57ad070d59e753bd3aba34a4d70d05d1a0d63afb', // Merge remote-tracking branch 'origin/m3-start' into pkg/weeping-willow — 150 words
	'80b379b7014fc1df3dd642a25570e7e8fe167972', // fix(plant-review): let a whole view's crop correction ask for a 2.9 stand — 150 words
	'03bcbaa4be3f5d32ad4a2a558e3f472061682332', // Merge remote-tracking branch 'origin/landing/v5-answers' into probe/bamboo-row6-cards — 35 words
	'1d70e8953e098dc89d95fed4ed1432e9391741e2', // Merge remote-tracking branch 'origin/landing/v5-answers' into pkg/tree-fern — 707 words
	'0e143d41d876c0f1ac3d8ac7c003aa6ad07d0d99', // Merge remote-tracking branch 'origin/m3-start' into pkg/saguaro — 3 words
	'4a78200e9c490792206f9b1e16ef9c3e3aacf95c', // Merge remote-tracking branch 'origin/m3-start' into pkg/sedge — 3 words
	'065c091abe3cae1b7ca78c431f620759b5348b3d', // Merge remote-tracking branch 'origin/m3-start' into pkg/date-palm-rows — 16 words
	'588eeffe79f5c7c857ce5a3f265891c1868492ad', // Merge remote-tracking branch 'origin/m3-start' into pkg/giant-sequoia — 16 words
	'2202991f0fbacd26ce963144e9ccdadd2b0ac365', // Merge remote-tracking branch 'origin/m3-start' into pkg/hawthorn-shrub — 3 words
	'fdd3a1bb2c7876e435da7d4481b1c31808812849', // Merge remote-tracking branch 'origin/m3-start' into pkg/weeping-willow — 3 words
	'ae5993609ecae4bd76ee369aaf15b5a4d8d0bb09', // Merge remote-tracking branch 'origin/m3-start' into probe/bamboo-row6-cards — 3 words
	'd50c788a056742029bbbb1c17d19a115f14641c1', // Merge branch 'fix/review-subjects' into impl/mask-gate — 145 words
	'13c06f213d925de8304ced0f678115afe07b5ac5', // Merge remote-tracking branch 'origin/m3-start' into pkg/tree-fern — 75 words
	'bedc0001eb3e8e9cb0842fb43dfe5a0a6ea48572', // Merge remote-tracking branch 'origin/m3-start' into pkg/italian-cypress — 47 words
	'f75e9e9fd7d7fd3f1cc589fa0dfd7e766e502191', // Merge remote-tracking branch 'origin/m3-start' into pkg/giant-sequoia — 47 words
	'fa604c57e706ea213eedf33a6115771c554027fa', // Merge remote-tracking branch 'origin/m3-start' into pkg/meadow-grass — 445 words
	'88cb8208b8c3face55770856dd8e70d23b3e83a8', // Merge remote-tracking branch 'origin/m3-start' into pkg/silver-birch — 141 words
	'5328b2aff2f6a0038ff9d315a8906f5b36954096', // Merge remote-tracking branch 'origin/pkg/s0' into pkg/giant-sequoia — 97 words
	'd098c3cb662b878e37ca011b0ceaffbedd381a3c', // Merge remote-tracking branch 'origin/pkg/s0' into pkg/sedge — 61 words
	'951f8d690c4ab0e35081031a98483ba36ee3e802', // chore(vegetation): merge pkg/s0 and state the fork view's limits — 99 words
	'e8c4d752da8980a006acaac98561dbf228995f60', // Merge remote-tracking branch 'origin/pkg/s0-bark' into pkg/s0 — 62 words
	'7f11fa690042421df151ed630617ac1b09aee0c7', // Merge branch 'worktree-agent-a1d0dbe12ec441dcc' into pkg/r1 — 4481 words
]);

/** Words of new work a merge may hold before the check refuses it: a line or two of glue. */
export const NEW_WORD_ALLOWANCE = 30;

/** Words that a line inside or outside a conflict may hold beyond its source. */
const MAX_FRESH_WORDS = 2;

/** Files a merge writes again rather than by hand: generated sources and lock files. */
const EXEMPT_PATTERNS = [
	/^packages\/engine\/src\/generated\//,
	/(^|\/)bun\.lock$/,
	/(^|\/)Cargo\.lock$/,
];

/** Shader source, where any new code in a merge changes what the GPU draws. */
const SHADER_PATTERN = /\.wgsl$/;

function git(args: string[], cwd?: string, okCodes: number[] = [0]): string {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
	if (result.status === null || !okCodes.includes(result.status))
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

const words = (line: string) => line.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
/** Spacing and numbers do not count, so a renumbered or re-indented line matches its source. */
const normalise = (line: string) => line.replace(/\s+/g, '').replace(/\d+/g, '0');
/** A line of punctuation or one short word, such as a closing brace, carries no new work. */
const trivial = (line: string) => line.replace(/\s+/g, '').length <= 8 || words(line).length === 0;
/** The words of a line that a set of words lacks. */
const freshWords = (line: string, known: Set<string>) =>
	[...new Set(words(line))].filter((w) => !known.has(w));

interface Conflict {
	/** First and last line of the conflict in the rebuilt file, markers included, from 1. */
	start: number;
	end: number;
	sides: string[];
}

/** The conflicts that git's automatic merge left in a file's text. */
export function conflictsIn(text: string): Conflict[] {
	const conflicts: Conflict[] = [];
	let open: Conflict | null = null;
	text.split('\n').forEach((line, i) => {
		if (line.startsWith('<<<<<<< ')) open = { start: i + 1, end: i + 1, sides: [] };
		else if (open && line.startsWith('>>>>>>> ')) {
			open.end = i + 1;
			conflicts.push(open);
			open = null;
		} else if (open && line !== '=======') open.sides.push(line);
	});
	return conflicts;
}

export interface Hunk {
	/** The hunk's first line in the old text, from 1; for a pure insertion, the line before it. */
	oldStart: number;
	oldCount: number;
	removed: string[];
	added: string[];
}

export interface FileDiff {
	path: string;
	binary: boolean;
	created: boolean;
	hunks: Hunk[];
}

/** Parses `git diff -U0` output into files and hunks. */
export function parseDiff(diff: string): FileDiff[] {
	const files: FileDiff[] = [];
	let file: FileDiff | undefined;
	let hunk: Hunk | undefined;
	for (const line of diff.split('\n')) {
		const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
		if (header) {
			file = { path: header[1] ?? '', binary: false, created: false, hunks: [] };
			files.push(file);
			hunk = undefined;
			continue;
		}
		if (!file) continue;
		const range = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
		if (range) {
			hunk = {
				oldStart: Number(range[1]),
				oldCount: Number(range[2] ?? 1),
				removed: [],
				added: [],
			};
			file.hunks.push(hunk);
		} else if (!hunk) {
			if (line.startsWith('new file mode')) file.created = true;
			if (line.startsWith('Binary files')) file.binary = true;
		} else if (line.startsWith('+')) hunk.added.push(line.slice(1));
		else if (line.startsWith('-')) hunk.removed.push(line.slice(1));
	}
	return files;
}

/** The conflicts a hunk touches: those it overlaps or, for a pure insertion, borders. */
function touched(hunk: Hunk, conflicts: Conflict[]): Conflict[] {
	const last = hunk.oldStart + (hunk.oldCount === 0 ? 1 : hunk.oldCount - 1);
	return conflicts.filter((c) => hunk.oldStart <= c.end && last >= c.start);
}

const numbers = (line: string) => line.match(/\d+(\.\d+)?/g) ?? [];

/**
 * Whether an added line outside a conflict is mechanical: a small edit of a line it replaces, or
 * a short line, whose new words a side added. With `keepNumbers`, the edit may not change a number.
 */
function mechanical(
	line: string,
	replaced: string[],
	pool: Set<string>,
	keepNumbers: boolean,
): boolean {
	const own = new Set(words(line));
	if (replaced.length === 0)
		return own.size <= MAX_FRESH_WORDS + 1 && [...own].every((w) => pool.has(w));
	return replaced.some((r) => {
		const fresh = freshWords(line, new Set(words(r)));
		const known = new Set(numbers(r));
		return (
			fresh.length <= MAX_FRESH_WORDS &&
			fresh.length * 2 <= own.size &&
			fresh.every((w) => pool.has(w)) &&
			(!keepNumbers || numbers(line).every((n) => known.has(n)))
		);
	});
}

/** The lines of one file's changes in a merge that are neither resolutions nor mechanical. */
export interface NewWork {
	added: string[];
	/** Lines the automatic merge kept from a side, which the merge deleted outside a conflict. */
	deleted: string[];
}

/**
 * The new work in one file's changes in a merge, against the text that git's automatic merge gave.
 * `pool` holds the words that either side added against the merge base. With `keepNumbers`, an
 * edit outside a conflict that changes a number is new work.
 */
export function newWork(
	file: FileDiff,
	oldText: string,
	pool: Set<string>,
	keepNumbers = false,
): NewWork {
	const conflicts = conflictsIn(oldText);
	const work: NewWork = { added: [], deleted: [] };
	for (const hunk of file.hunks) {
		const inside = touched(hunk, conflicts);
		if (inside.length > 0) {
			const sides = inside.flatMap((c) => c.sides);
			const keys = new Set(sides.map(normalise));
			const sideWords = new Set(sides.flatMap(words));
			const fromSides = (l: string) =>
				keys.has(normalise(l)) || freshWords(l, sideWords).length <= MAX_FRESH_WORDS;
			work.added.push(...hunk.added.filter((l) => !trivial(l) && !fromSides(l)));
		} else {
			work.added.push(
				...hunk.added.filter((l) => !trivial(l) && !mechanical(l, hunk.removed, pool, keepNumbers)),
			);
			if (hunk.added.length === 0) work.deleted.push(...hunk.removed.filter((l) => !trivial(l)));
		}
	}
	return work;
}

/** The words of every line that a side added against the merge base. */
function addedWords(base: string, side: string, cwd?: string): Set<string> {
	const diff = git(['diff', '--no-color', '--no-ext-diff', '-U0', base, side], cwd);
	const pool = new Set<string>();
	for (const line of diff.split('\n'))
		if (line.startsWith('+') && !line.startsWith('+++')) for (const w of words(line)) pool.add(w);
	return pool;
}

export interface MergeFinding {
	sha: string;
	subject: string;
	/** New work by file; a deleted line starts with "(deleted)". */
	files: Map<string, string[]>;
	/** The words of new work, deleted lines included. */
	words: number;
	/** New or deleted lines of shader code, comments aside. */
	shaderLines: number;
	/** Binary files, such as image references, that the merge changed outside a conflict. */
	binaryFiles: number;
	/** The `Merge-Edit:` trailer's value, when the message has one that says something. */
	reason: string | null;
	/**
	 * Set when the two parents share no commit, which a message-only rewrite of one line leaves
	 * behind: whether the merge kept its first parent's files exactly, or changed them.
	 */
	unrelated?: "kept its first parent's tree" | "changed its first parent's tree";
}

/**
 * What git's automatic merge writes of two commits, conflicts marked, or `unrelated` when the two
 * histories share no commit and git refuses to merge them at all.
 */
function automaticMerge(
	ours: string,
	theirs: string,
	cwd?: string,
): { tree: string; conflicted: Set<string> } | 'unrelated' {
	const args = [
		'-c',
		'merge.conflictStyle=merge',
		'merge-tree',
		'--write-tree',
		'--name-only',
		ours,
		theirs,
	];
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
	if (result.status === 128 && /unrelated histories/.test(result.stderr ?? '')) return 'unrelated';
	// Exit status 1 means the automatic merge had conflicts; the tree then holds the markers.
	if (result.status === null || ![0, 1].includes(result.status))
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	const out = (result.stdout ?? '').split('\n');
	const end = out.indexOf('');
	return { tree: out[0] ?? '', conflicted: new Set(out.slice(1, end === -1 ? undefined : end)) };
}

/**
 * The new work in one merge commit, or null when it is not a two-parent merge or was committed
 * before `since` (an empty `since` checks every merge).
 */
export function analyseMerge(
	sha: string,
	cwd?: string,
	since = MERGE_RULE_SINCE,
): MergeFinding | null {
	const parents = git(['rev-list', '--parents', '-n1', sha], cwd).trim().split(' ').slice(1);
	if (parents.length !== 2) return null;
	const [ours = '', theirs = ''] = parents;
	const [committedAt = '', ...body] = git(['log', '-1', '--format=%cI%n%B', sha], cwd).split('\n');
	if (Date.parse(committedAt) < Date.parse(since)) return null;
	const message = body.join('\n');
	const trailer = findAckValue(effectiveMessage(message), MERGE_EDIT_TRAILER, committedAt);

	// Exit status 1 means the automatic merge had conflicts; the tree then holds the markers.
	const merged = automaticMerge(ours, theirs, cwd);
	if (merged === 'unrelated') {
		// A message-only rewrite gives its line a copy of the other's history under new ids, so the
		// merge that restores the ancestry has no common commit to resolve against and git writes
		// no automatic tree to compare with. The merge must then keep its first parent's files
		// exactly and say in its message why it stands.
		const tree = git(['rev-parse', `${sha}^{tree}`], cwd).trim();
		const first = git(['rev-parse', `${ours}^{tree}`], cwd).trim();
		return {
			sha,
			subject: message.split('\n')[0] ?? '',
			files: new Map(),
			words: 0,
			shaderLines: 0,
			binaryFiles: 0,
			reason: trailer !== null && !isBareAck(trailer) ? trailer : null,
			unrelated:
				tree === first ? "kept its first parent's tree" : "changed its first parent's tree",
		};
	}
	const tree = merged.tree;
	const conflicted = merged.conflicted;
	const diff = parseDiff(
		git(['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0', tree, sha], cwd),
	);
	const lines = (pick: (h: Hunk) => string[]) =>
		new Set(diff.flatMap((f) => f.hunks.flatMap((h) => pick(h).map(normalise))));
	const removedKeys = lines((h) => h.removed);
	const addedKeys = lines((h) => h.added);

	let pool: Set<string> | undefined;
	const files = new Map<string, string[]>();
	let total = 0;
	let shaderLines = 0;
	let binaryFiles = 0;
	for (const file of diff) {
		if (EXEMPT_PATTERNS.some((p) => p.test(file.path))) continue;
		const oldText = file.created ? '' : git(['cat-file', '-p', `${tree}:${file.path}`], cwd);
		// A conflict without markers (one side deleted or renamed the file) is resolved whole.
		if (conflicted.has(file.path) && conflictsIn(oldText).length === 0) continue;
		if (file.binary) {
			files.set(file.path, ['(binary file changed)']);
			binaryFiles++;
			continue;
		}
		if (!pool) {
			const base = git(['merge-base', ours, theirs], cwd).trim();
			pool = new Set([...addedWords(base, ours, cwd), ...addedWords(base, theirs, cwd)]);
		}
		const shader = SHADER_PATTERN.test(file.path);
		const work = newWork(file, oldText, pool, shader);
		const added = work.added.filter((l) => !removedKeys.has(normalise(l)));
		const deleted = work.deleted.filter((l) => !addedKeys.has(normalise(l)));
		if (added.length + deleted.length === 0) continue;
		files.set(file.path, [...added, ...deleted.map((l) => `(deleted) ${l}`)]);
		for (const l of [...added, ...deleted]) total += words(l).length;
		if (shader)
			shaderLines += [...added, ...deleted].filter((l) => !l.trim().startsWith('//')).length;
	}
	return {
		sha,
		subject: message.split('\n')[0] ?? '',
		files,
		words: total,
		shaderLines,
		binaryFiles,
		reason: trailer !== null && !isBareAck(trailer) ? trailer : null,
	};
}

/** Why a merge cannot be pushed, or null when it holds only resolutions and mechanical fixes. */
export function mergeProblem(finding: MergeFinding): string | null {
	if (finding.unrelated === "changed its first parent's tree")
		return `${finding.sha.slice(0, 9)} ${finding.subject}\n  joins two histories that share no commit and changes its first parent's files, which such a merge must keep exactly.`;
	if (finding.unrelated && !finding.reason)
		return `${finding.sha.slice(0, 9)} ${finding.subject}\n  joins two histories that share no commit. Add a Merge-Edit: trailer that names the rewrite which made them unrelated and says the tree already holds the other side's content.`;
	if (finding.reason) return null;
	const { words: count, shaderLines, binaryFiles } = finding;
	if (count <= NEW_WORD_ALLOWANCE && shaderLines === 0 && binaryFiles === 0) return null;
	const list = [...finding.files.entries()]
		.map(([path, lines]) => `    ${path}: ${lines.length} line(s), such as: ${lines[0]?.trim()}`)
		.join('\n');
	const what = [
		count > 0 ? `${count} words of new work` : '',
		shaderLines > 0 ? `${shaderLines} line(s) of new shader code` : '',
		binaryFiles > 0 ? `${binaryFiles} changed binary file(s)` : '',
	]
		.filter(Boolean)
		.join(', ');
	return `${finding.sha.slice(0, 9)} ${finding.subject}\n  holds ${what} outside its conflict resolutions:\n${list}`;
}

/** The merges of a range that the check reads: every one but those that KNOWN_MERGES names. */
export function mergesToCheck(shas: readonly string[]): string[] {
	return shas.filter((sha) => sha !== '' && !KNOWN_MERGES.has(sha));
}

function main(): void {
	const range = process.argv[2];
	if (!range) {
		console.error('usage: bun tools/hooks/check-merges.ts <base>..<head> [--all]');
		process.exit(2);
	}
	const problems = mergesToCheck(git(['rev-list', '--merges', range]).split('\n'))
		.map((sha) => analyseMerge(sha, undefined, process.argv.includes('--all') ? '' : undefined))
		.flatMap((finding) => (finding ? [mergeProblem(finding)] : []))
		.filter((problem) => problem !== null);
	if (problems.length === 0) {
		console.log(`merges OK in ${range}`);
		return;
	}
	for (const p of problems) console.error(`${p}\n`);
	console.error(
		'A merge commit holds only conflict resolutions and mechanical fixes (AGENTS.md, "Commit gates").\n' +
			'Move new code, tests and docs into a normal commit after the merge: undo them in the merge\n' +
			'(git commit --amend), then commit them again on top. When an edit is mechanical, such as a\n' +
			"rename or an argument that the other side's change needs, add a Merge-Edit: trailer to the\n" +
			"merge's message that names it and says why.",
	);
	process.exit(1);
}

if (import.meta.main) main();
