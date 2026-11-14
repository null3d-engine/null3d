// The repository files that some scripts import, directly or through other files, found by
// following each relative import. A package import resolves in node_modules, outside the
// repository's own files, so it is not followed. CI's workflow tests read which files a job's
// scripts load, and the runtime test reads which files Node loads under Playwright and Vite.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"?]+)/g;

/** The repository file that an import names, by its path from `root`, or null outside it. */
export function importedFile(root: string, from: string, spec: string): string | null {
	const base = resolve(dirname(join(root, from)), spec);
	for (const candidate of [
		base,
		base.replace(/\.js$/, '.ts'),
		`${base}.ts`,
		join(base, 'index.ts'),
	])
		if (existsSync(candidate) && statSync(candidate).isFile()) return relative(root, candidate);
	return null;
}

/**
 * The files in `start` and every repository file that they import, directly or through other
 * files, by their paths from `root`. A file that `unread` names is kept but its imports are not
 * followed, as for generated files too large to read.
 */
export function withImports(
	root: string,
	start: readonly string[],
	unread: (file: string) => boolean = () => false,
): Set<string> {
	const found = new Set<string>();
	const next = [...start];
	for (let file = next.pop(); file !== undefined; file = next.pop()) {
		if (found.has(file)) continue;
		found.add(file);
		if (unread(file)) continue;
		for (const [, spec] of readFileSync(join(root, file), 'utf8').matchAll(RELATIVE_IMPORT)) {
			const imported = spec === undefined ? null : importedFile(root, file, spec);
			if (imported !== null && !imported.includes('node_modules')) next.push(imported);
		}
	}
	return found;
}
