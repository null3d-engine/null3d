// Link checks for the Markdown the repository publishes: every page under docs/, the README and
// AGENTS.md. Internal links (page to page, heading anchors, relative paths, and github.com links
// into this repository) are checked across the whole tree, because a renamed or deleted page breaks
// the links in other files. External URLs are probed separately, by the commit hook, for the files
// a commit changes.
import { posix } from 'node:path';
import { docsFiles, readIfExists } from './files';

/** Root-level Markdown files that link into the docs and are checked with them. */
export const ROOT_LINKED_FILES = ['README.md', 'AGENTS.md'];

const SELF_REPO_RE = /^https:\/\/github\.com\/sokko3d\/sokko3d\/(?:blob|raw|tree)\/main\/([^#?]+)/;
/** Hosts that appear in docs as examples, never as real destinations. */
const SKIP_HOSTS = new Set(['localhost', '127.0.0.1', 'example.com']);
/** The only statuses that prove a link wrong; anything else could be the network. */
const HARD_BROKEN_STATUSES = new Set([404, 410]);

export interface FoundLink {
	target: string;
	/** 1-based line in the source file. */
	line: number;
}

/**
 * Blanks fenced code blocks and keeps the line count, so reported line numbers stay true. Inline
 * code is kept, because headings such as "Using `--foo`" need their code text for slugs.
 */
export function stripFences(md: string): string {
	let fence: string | null = null;
	return md
		.split('\n')
		.map((line) => {
			const marker = line.match(/^\s*(```|~~~)/);
			if (fence !== null) {
				if (marker && marker[1] === fence) fence = null;
				return '';
			}
			if (marker) {
				fence = marker[1] ?? null;
				return '';
			}
			return line;
		})
		.join('\n');
}

/** Blanks fenced blocks, inline code spans and HTML comments: example links are not links. */
export function stripCode(md: string): string {
	return stripFences(md)
		.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
		.split('\n')
		.map((line) => line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)))
		.join('\n');
}

/** Every inline, image and autolink target with its line number, with code stripped. */
export function extractLinks(md: string): FoundLink[] {
	const links: FoundLink[] = [];
	const inline = /!?\[[^\]]*\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g;
	const auto = /<(https?:\/\/[^>\s]+)>/g;
	const html = /<(?:a|img)\s[^>]*?(?:href|src)="([^"]+)"/g;
	stripCode(md)
		.split('\n')
		.forEach((line, i) => {
			for (const m of line.matchAll(inline)) if (m[1]) links.push({ target: m[1], line: i + 1 });
			for (const m of line.matchAll(auto)) if (m[1]) links.push({ target: m[1], line: i + 1 });
			for (const m of line.matchAll(html)) if (m[1]) links.push({ target: m[1], line: i + 1 });
		});
	return links;
}

/** GitHub-compatible anchor for one heading's text. */
export function slugifyHeading(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[*_`]/g, '')
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.replace(/\s/g, '-');
}

/** Anchors of every Markdown heading, with GitHub's -1, -2 suffixes for repeated headings. */
export function headingAnchors(md: string): Set<string> {
	const anchors = new Set<string>();
	const seen = new Map<string, number>();
	for (const m of stripFences(md).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const base = slugifyHeading(m[1] ?? '');
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		anchors.add(n === 0 ? base : `${base}-${n}`);
	}
	return anchors;
}

/** Repository-relative path that a github.com link into this repository names, or null. */
export function selfRepoPath(url: string): string | null {
	const m = url.match(SELF_REPO_RE);
	return m?.[1] ? m[1].replace(/\/$/, '') : null;
}

const OWN_REPO_URL = 'https://github.com/sokko3d/sokko3d';

/**
 * True for this repository's own pages on GitHub, such as its issues and CI badges. They depend
 * on the repository's state (they do not exist before the first push), so they are never probed.
 */
export function isOwnRepoUrl(url: string): boolean {
	return (
		url === OWN_REPO_URL ||
		url.startsWith(`${OWN_REPO_URL}/`) ||
		url.startsWith(`${OWN_REPO_URL}.git`)
	);
}

/** External URLs that are examples rather than destinations. */
export function isSkippedExternalUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return SKIP_HOSTS.has(host) || host.endsWith('.example.com') || host.endsWith('.local');
	} catch {
		return true;
	}
}

export function classifyExternalStatus(status: number): 'ok' | 'broken' | 'unreachable' {
	if (HARD_BROKEN_STATUSES.has(status)) return 'broken';
	if (status >= 200 && status < 400) return 'ok';
	return 'unreachable';
}

/**
 * Checks every internal link in `files` (repository-relative path to content). `exists` answers
 * for targets outside the map, such as images and source files. Returns one `file:line message`
 * string per problem.
 */
export function checkLinkTree(
	files: Map<string, string>,
	exists: (repoRelativePath: string) => boolean,
): string[] {
	const problems: string[] = [];
	const anchorsByFile = new Map<string, Set<string>>();
	for (const [path, content] of files) anchorsByFile.set(path, headingAnchors(content));

	const checkAnchor = (
		from: string,
		line: number,
		target: string,
		file: string,
		anchor: string,
	) => {
		if (!anchorsByFile.get(file)?.has(anchor)) {
			problems.push(`${from}:${line} broken anchor ${target} (no heading "#${anchor}" in ${file})`);
		}
	};

	for (const [path, content] of files) {
		for (const { target, line } of extractLinks(content)) {
			if (/^https?:\/\//.test(target)) {
				const repoPath = selfRepoPath(target);
				if (repoPath !== null && !exists(repoPath)) {
					problems.push(
						`${path}:${line} broken repository link ${target} (${repoPath} does not exist)`,
					);
				}
				continue;
			}
			if (target.startsWith('mailto:')) continue;

			const hash = target.indexOf('#');
			const pathPart = hash === -1 ? target : target.slice(0, hash);
			const anchor = hash === -1 ? null : target.slice(hash + 1);

			if (pathPart === '') {
				if (anchor !== null) checkAnchor(path, line, target, path, anchor);
				continue;
			}
			if (pathPart.startsWith('/')) {
				problems.push(`${path}:${line} absolute link ${target}: use a relative path or a full URL`);
				continue;
			}
			const resolved = posix.normalize(posix.join(posix.dirname(path), pathPart));
			if (resolved.endsWith('.md') && files.has(resolved)) {
				if (anchor !== null) checkAnchor(path, line, target, resolved, anchor);
				continue;
			}
			if (!exists(resolved)) {
				problems.push(
					`${path}:${line} broken relative link ${target} (${resolved} does not exist)`,
				);
			}
		}
	}
	return problems;
}

/** Every file whose links are checked, keyed by repository-relative path. */
export function linkedFiles(root: string): Map<string, string> {
	const files = new Map<string, string>();
	for (const path of [...ROOT_LINKED_FILES, ...docsFiles(root)]) {
		const content = readIfExists(root, path);
		if (content !== null) files.set(path, content);
	}
	return files;
}
