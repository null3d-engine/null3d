// The size check's judging: how each file's size after Brotli changed against a build of a base
// commit, which files grew past the limit, which commit the check compares with, and the tables
// that show each file's growth. The base is main's own build, so no size record is committed. The
// functions here do no file or process work: tools/build-wasm.ts builds the base, reads the
// commits and prints.
import type { SizeEntry } from './size-report';

/** Growth after Brotli over the base build that fails the check unless a trailer explains it. */
export const MAX_GROWTH = 0.02;

/**
 * The fewest bytes after Brotli that a file must grow by to fail the check. Below it, a small file's
 * growth comes from the hashed names of the files it imports or loads and the bundler's short names
 * for them, which change with nearly every change to the engine, not from code of its own. A file
 * larger than the floor divided by the share limit fails on its share alone, as before.
 */
export const MIN_GROWTH_BYTES = 64;

/** A file's size after Brotli in the base build and in this build. A build that lacks the file has none. */
export interface SizeChange {
	file: string;
	base?: number;
	head?: number;
}

/** Each file of either build: this build's files in its order, then the files that only the base has. */
export function compareSizes(
	base: Readonly<Record<string, Pick<SizeEntry, 'brotli'>>>,
	head: Readonly<Record<string, Pick<SizeEntry, 'brotli'>>>,
): SizeChange[] {
	const files = [...Object.keys(head), ...Object.keys(base).filter((file) => !(file in head))];
	return files.map((file) => ({ file, base: base[file]?.brotli, head: head[file]?.brotli }));
}

/** The change as a share of the base size, so 0.021 is 2.1%. A new file grows without limit. */
export function growthOf({ base, head }: SizeChange): number {
	if (head === undefined) return -1;
	if (base === undefined) return Number.POSITIVE_INFINITY;
	return (head - base) / base;
}

/**
 * True when a file is new, or grew both by more than the share limit and by at least the byte
 * floor. Such a file fails the check unless a trailer explains it.
 */
export function overLimit(change: SizeChange): boolean {
	const { base, head } = change;
	if (head === undefined) return false;
	if (base === undefined) return true;
	return growthOf(change) > MAX_GROWTH && head - base >= MIN_GROWTH_BYTES;
}

/** The files that grew past the limit, new files among them. */
export function grownFiles(changes: readonly SizeChange[]): SizeChange[] {
	return changes.filter(overLimit);
}

/** The commit that the size check compares with, before git resolves it. */
export type BaseChoice =
	/** A commit that git can name, such as a branch, a tag or `HEAD^`. */
	| { ref: string; why: string }
	/** HEAD's merge base with a branch of `origin`, which the check fetches first. */
	| { branch: string; why: string };

/**
 * The base of the size check. `--base <ref>` names it. A merge queue run compares with the commit
 * that its group builds on, which holds the pull requests ahead of it in the queue: the queue
 * squashes each pull request into one commit on top of that commit, so it is the commit before. A
 * push to main runs no size check, because the queue checked that commit. Otherwise the base is HEAD's merge base with main, or
 * with the branch that a pull request targets. CI builds a pull request as GitHub's merge of it
 * into that branch, so there the merge base is the branch's commit that the pull request was merged
 * into.
 */
export function chooseBase(
	ref: string | undefined,
	env: Readonly<Record<string, string | undefined>>,
): BaseChoice {
	if (ref) return { ref, why: 'the commit that --base names' };
	if (env.GITHUB_EVENT_NAME === 'merge_group')
		return {
			ref: 'HEAD^',
			why: 'the commit that the merge group builds on, with the pull requests ahead of it',
		};
	const branch = env.GITHUB_BASE_REF || 'main';
	return { branch, why: `the merge base with origin/${branch}` };
}

const bytes = (n: number | undefined) => (n === undefined ? '-' : n.toLocaleString('en-US'));

/** The growth in words: a signed percentage to one decimal, or new, or removed. */
export function growthText(change: SizeChange): string {
	if (change.head === undefined) return 'removed';
	if (change.base === undefined) return 'new';
	const tenths = Math.round(growthOf(change) * 1000);
	if (tenths === 0) return '0.0%';
	return `${tenths > 0 ? '+' : ''}${(tenths / 10).toFixed(1)}%`;
}

/** The verdict on a file: blank within the limit, else the commit whose trailer explains its growth. */
function verdict(change: SizeChange, explainedBy: ReadonlyMap<string, string>): string {
	if (!overLimit(change)) return '';
	const commit = explainedBy.get(change.file);
	return commit ? `explained in ${commit.slice(0, 8)}` : 'not explained';
}

/** The growth of each file against the base, as lines for the log. */
export function growthLines(
	changes: readonly SizeChange[],
	explainedBy: ReadonlyMap<string, string>,
): string[] {
	const row = (cells: readonly string[]) => {
		const [file = '', base = '', head = '', growth = '', note = ''] = cells;
		return `  ${file.padEnd(28)} ${base.padStart(10)} ${head.padStart(12)} ${growth.padStart(9)}  ${note}`.trimEnd();
	};
	return [
		row(['file', 'base', 'this build', 'growth']),
		...changes.map((change) =>
			row([
				change.file,
				bytes(change.base),
				bytes(change.head),
				growthText(change),
				verdict(change, explainedBy),
			]),
		),
	];
}

/** The growth of each file against the base, as Markdown for CI's job summary. */
export function growthSummary(
	changes: readonly SizeChange[],
	explainedBy: ReadonlyMap<string, string>,
	base: string,
): string {
	return [
		'### Download sizes against the base',
		'',
		`The base is ${base}. Sizes are bytes after Brotli. A file that grows more than ${MAX_GROWTH * 100}% and by ${MIN_GROWTH_BYTES} bytes or more needs a \`Size-Growth:\` trailer that names it and gives the reason.`,
		'',
		'| File | Base | This build | Growth | Over the limit |',
		'| --- | ---: | ---: | ---: | --- |',
		...changes.map(
			(change) =>
				`| \`${change.file}\` | ${bytes(change.base)} | ${bytes(change.head)} | ${growthText(change)} | ${verdict(change, explainedBy)} |`,
		),
		'',
	].join('\n');
}

/** A problem for each file that grew past the limit with no trailer to explain it. */
export function growthProblems(
	changes: readonly SizeChange[],
	explainedBy: ReadonlyMap<string, string>,
): string[] {
	return grownFiles(changes)
		.filter((change) => !explainedBy.has(change.file))
		.map((change) =>
			change.base === undefined
				? `${change.file} is new, ${bytes(change.head)} bytes after Brotli, and no Size-Growth trailer names it`
				: `${change.file} grew ${growthText(change)} after Brotli, from ${bytes(change.base)} to ${bytes(change.head)} bytes, and no Size-Growth trailer names it`,
		);
}
