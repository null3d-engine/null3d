// Every file that the docs generator and the skills sync write. Git keeps none of their output:
// whole generated files are ignored, and a written page keeps only the empty markers of each
// generated section, because a git clean filter empties the sections when a page is staged. The
// working tree holds the full files, which `bun install`, the git hooks after a checkout, merge or
// rebase, and `bun run docs` write. Generated output therefore never clashes in a merge.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readApi } from './api-docs';
import { generateDocs, libraryProblems, referenceProblems, writeGeneratedDocs } from './docs';
import { readIfExists } from './files';
import { expectedSkillCopies, syncSkills } from './skills';
import { readRecord, recordFiles } from './tested-devices';

/** The name of the git filter that empties generated sections, as `.gitattributes` gives it. */
export const FILTER = 'null3d-generated';

/** A generated section: the text between a start marker and its end marker. */
const SECTION = /(<!-- null3d:([a-z-]+):start -->)[\s\S]*?(<!-- null3d:\2:end -->)/g;

/**
 * The filter's clean command: Perl, which git for every platform ships, so that git runs no
 * JavaScript runtime for each file it compares. It must give what `emptySections` gives.
 */
export const FILTER_CLEAN = `perl -0777 -pe 's/(<!-- null3d:([a-z-]+):start -->).*?(<!-- null3d:\\2:end -->)/$1\\n$3/gs'`;

/** The text with every generated section emptied, as git stores a written page. */
export function emptySections(text: string): string {
	return text.replace(SECTION, '$1\n$3');
}

/** The generated files: whole files, which git ignores, and pages with generated sections. */
export interface Generated {
	/** Each whole generated file, keyed by repository-relative path, with its content. */
	whole: Map<string, string>;
	/** Each written page with generated sections, with its full content. */
	sections: Map<string, string>;
}

/** True when the text holds a generated section with something in it. */
export function hasSections(text: string): boolean {
	return emptySections(text) !== text;
}

/**
 * Writes every generated file: the docs first, since the skills copy holds the docs generator's
 * mapping copies. Returns the generated files, the paths that changed, and the problems that the
 * generated files cannot show, such as an export without doc comments.
 */
export function writeGenerated(root: string): Generated & {
	written: string[];
	problems: string[];
} {
	const api = readApi(root);
	const docs = generateDocs(root, api);
	const written = writeGeneratedDocs(root, docs);
	written.push(...syncSkills(root));
	const whole = new Map(expectedSkillCopies(root));
	const sections = new Map<string, string>();
	for (const [path, content] of docs) (hasSections(content) ? sections : whole).set(path, content);
	if (isWorkTree(root)) refreshPages(root, sections.keys());
	const problems = [
		...referenceProblems(api),
		...libraryProblems(root),
		...readRecord(recordFiles(root)).problems,
	];
	return { whole, sections, written, problems };
}

const git = (root: string, args: string[]) =>
	execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });

/** The paths in NUL-separated git output. */
const lines = (output: string) => new Set(output.split('\0').filter(Boolean));

/**
 * Records each page's new size in git's index when only its generated sections changed. Git takes
 * a file whose size differs from the size it recorded as changed, without running the filter, so
 * such a page would show as modified. Staging a page whose emptied text matches what git stores
 * changes no content. A page with other changes, or in a merge conflict, stays as it is.
 */
export function refreshPages(root: string, pages: Iterable<string>): void {
	const unchanged: string[] = [];
	for (const entry of git(root, ['ls-files', '-s', '-z', '--', ...pages]).split('\0')) {
		// Each entry reads "<mode> <blob> <stage>\t<path>".
		const [info = '', path = ''] = entry.split('\t');
		const [, blob = '', stage] = info.split(' ');
		if (stage !== '0') continue;
		const text = readIfExists(root, path);
		if (text !== null && emptySections(text) === git(root, ['cat-file', 'blob', blob]))
			unchanged.push(path);
	}
	if (unchanged.length) git(root, ['add', '--', ...unchanged]);
}

/** True when `root` is the top of a git work tree. */
export function isWorkTree(root: string): boolean {
	return existsSync(join(root, '.git'));
}

/**
 * Problems with what git keeps of the generated files: a whole generated file that git tracks or
 * does not ignore, a written page that git ignores, and a staged page whose generated sections are
 * not empty, which means the clean filter is not set up.
 */
export function gitProblems(root: string, { whole, sections }: Generated): string[] {
	const problems: string[] = [];
	const paths = [...whole.keys(), ...sections.keys()];

	// check-ignore exits with 1 when it finds no ignored path.
	const ignored = new Set(
		spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
			cwd: root,
			encoding: 'utf8',
			input: `${paths.join('\n')}\n`,
		})
			.stdout.split('\n')
			.filter(Boolean),
	);
	const tracked = lines(git(root, ['ls-files', '-z', '--', ...paths]));
	for (const path of whole.keys()) {
		if (!ignored.has(path)) problems.push(`${path} is generated: add it to .gitignore`);
		if (tracked.has(path))
			problems.push(`${path} is generated: remove it from git with git rm --cached`);
	}
	for (const path of sections.keys()) {
		if (ignored.has(path)) problems.push(`${path} is a written page: take it out of .gitignore`);
	}

	for (const path of sections.keys()) {
		if (!tracked.has(path)) continue;
		const blob = git(root, ['show', `:${path}`]);
		if (hasSections(blob))
			problems.push(
				`${path} is staged with its generated sections: run bun install, which sets up the git filter that empties them, then git add --renormalize ${path}`,
			);
	}
	return problems;
}

/** Sets up the clean filter in the repository's git config, as `bun install` does. */
export function configureFilter(root: string): void {
	git(root, ['config', `filter.${FILTER}.clean`, FILTER_CLEAN]);
}
