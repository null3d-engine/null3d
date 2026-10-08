// Every file that the docs generator and the skills sync write. Git keeps none of them: each is a
// whole file that .gitignore names, and a written page links to the generated page it needs. The
// install step, the git hooks after a checkout, merge or rebase, and `bun run docs` write them, so
// generated output never clashes in a merge (D-105).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readApi } from './api-docs';
import { generateDocs, libraryProblems, referenceProblems, writeGeneratedDocs } from './docs';
import { expectedSkillCopies, syncSkills } from './skills';
import { readRecord, recordFiles } from './tested-devices';

/**
 * Writes every generated file: the docs first, since the skills copy holds the docs generator's
 * mapping copies. Returns each generated file with its content, the paths that changed, and the
 * problems that the generated files cannot show, such as an export without doc comments.
 */
export function writeGenerated(root: string): {
	files: Map<string, string>;
	written: string[];
	problems: string[];
} {
	const api = readApi(root);
	const files = generateDocs(root, api);
	const written = writeGeneratedDocs(root, files);
	written.push(...syncSkills(root));
	for (const [path, content] of expectedSkillCopies(root)) files.set(path, content);
	const problems = [
		...referenceProblems(api),
		...libraryProblems(root),
		...readRecord(recordFiles(root)).problems,
	];
	return { files, written, problems };
}

/** True when `root` is the top of a git work tree. */
export function isWorkTree(root: string): boolean {
	return existsSync(join(root, '.git'));
}

/** Generated files that git keeps, or that .gitignore does not name. */
export function gitProblems(root: string, paths: readonly string[]): string[] {
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
	const tracked = new Set(
		execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: root, encoding: 'utf8' })
			.split('\0')
			.filter(Boolean),
	);
	const problems: string[] = [];
	for (const path of paths) {
		if (!ignored.has(path)) problems.push(`${path} is generated: add it to .gitignore`);
		if (tracked.has(path))
			problems.push(`${path} is generated: take it out of git with git rm --cached ${path}`);
	}
	return problems;
}
