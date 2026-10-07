import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Repository-relative paths, with forward slashes, of every file under `dir` that `keep` accepts, sorted. */
export function walkFiles(
	root: string,
	dir: string,
	keep: (path: string) => boolean = () => true,
): string[] {
	const out: string[] = [];
	const walk = (rel: string) => {
		if (!existsSync(join(root, rel))) return;
		for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
			const path = posix.join(rel, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (keep(path)) out.push(path);
		}
	};
	walk(dir);
	return out.sort();
}

/** The file's text, or null when it does not exist. */
export function readIfExists(root: string, path: string): string | null {
	const full = join(root, path);
	return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/** Paths of every Markdown file under `docs/`. */
export function docsFiles(root: string): string[] {
	return walkFiles(root, 'docs', (p) => p.endsWith('.md'));
}

/**
 * True for a maintainer guide, a decision record or a file of the record of tested devices:
 * Markdown in `.dev/`, `.dev/decisions/` or a folder of `.dev/tested-devices/`.
 */
export function isGuide(path: string): boolean {
	return /^\.dev\/(?:decisions\/|tested-devices\/[^/]+\/)?[^/]+\.md$/.test(path);
}

/** The maintainer guides, decision records and tested devices, which follow AGENTS.md's writing rules. */
export function guideFiles(root: string): string[] {
	return walkFiles(root, '.dev', isGuide);
}
