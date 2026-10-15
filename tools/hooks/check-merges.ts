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
// It skips merges committed before the rule; --all checks them too.
import { spawnSync } from 'node:child_process';
import { effectiveMessage, findAckValue, isBareAck } from './commit-ack';

/** The trailer that explains an edit in a merge beyond its resolutions. */
export const MERGE_EDIT_TRAILER = 'Merge-Edit';

/** Merges committed before this moment were made before the rule, and are not checked. */
export const MERGE_RULE_SINCE = '2026-10-15T14:00:00+08:00';

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
	const trailer = findAckValue(effectiveMessage(message), MERGE_EDIT_TRAILER);

	// Exit status 1 means the automatic merge had conflicts; the tree then holds the markers.
	const out = git(
		['-c', 'merge.conflictStyle=merge', 'merge-tree', '--write-tree', '--name-only', ours, theirs],
		cwd,
		[0, 1],
	).split('\n');
	const tree = out[0] ?? '';
	const end = out.indexOf('');
	const conflicted = new Set(out.slice(1, end === -1 ? undefined : end));
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

function main(): void {
	const range = process.argv[2];
	if (!range) {
		console.error('usage: bun tools/hooks/check-merges.ts <base>..<head> [--all]');
		process.exit(2);
	}
	const problems = git(['rev-list', '--merges', range])
		.split('\n')
		.filter(Boolean)
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
