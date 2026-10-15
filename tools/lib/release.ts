// Release versions and notes from Conventional Commits (AGENTS.md, "Releases"). Parsing, version
// arithmetic, rendering the notes and the release checks are pure, so the release script and its
// tests share them. Reading git's log, the version copies and the docs pages is the only outside
// access.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, pagePath } from './docs';
import { checkDocsStyle, DECISION_RECORD_SOURCE, INTERNAL_REFERENCE_SOURCE } from './docs-style';
import { readIfExists } from './files';
import { parseFrontMatter } from './frontmatter';

export interface ParsedCommit {
	/** Lowercased commit type, such as `feat`; empty when the subject is not conventional. */
	type: string;
	/** Scope from `feat(scope):`, or null. */
	scope: string | null;
	/** True for `!` after the type or scope, or a `BREAKING CHANGE:` footer. */
	breaking: boolean;
	/** The text after the `type(scope):` prefix, without a trailing pull request number. */
	description: string;
	/** The commit's hash. */
	hash: string;
	/** Pull request number from a trailing `(#123)`, or null. */
	pr: number | null;
}

export interface RawCommit {
	subject: string;
	body: string;
	hash: string;
}

const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const PR_SUFFIX_RE = /\s*\(#(\d+)\)\s*$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m;

export function parseCommit({ subject, body, hash }: RawCommit): ParsedCommit {
	const trimmed = subject.trim();
	const match = HEADER_RE.exec(trimmed);
	const prMatch = PR_SUFFIX_RE.exec(trimmed);
	const pr = prMatch ? Number.parseInt(prMatch[1] ?? '', 10) : null;
	const breaking = Boolean(match?.[3]) || BREAKING_FOOTER_RE.test(body);
	if (!match) {
		const description = trimmed.replace(PR_SUFFIX_RE, '').trim();
		return { type: '', scope: null, breaking, description, hash, pr };
	}
	return {
		type: (match[1] ?? '').toLowerCase(),
		scope: match[2] ?? null,
		breaking,
		description: (match[4] ?? '').replace(PR_SUFFIX_RE, '').trim(),
		hash,
		pr,
	};
}

/**
 * Every commit in a range of history that is not a merge, newest first, parsed as git writes its
 * log, so no limit on the log's size applies. A merge only joins a branch, and the branch's own
 * commits are listed one by one, so the range's notes miss no change, whichever branch brought it.
 */
export async function* readCommits(root: string, range: string): AsyncGenerator<ParsedCommit> {
	const git = spawn('git', ['log', '--no-merges', '--format=%H%x00%s%x00%b%x1e', range], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exited = new Promise<number | null>((resolve, reject) => {
		git.once('error', reject);
		git.once('close', resolve);
	});
	let errors = '';
	git.stderr.setEncoding('utf8').on('data', (text: string) => {
		errors += text;
	});
	try {
		let pending = '';
		for await (const chunk of git.stdout.setEncoding('utf8')) {
			const records = (pending + chunk).split('\x1e');
			pending = records.pop() ?? '';
			for (const record of records) {
				const [hash = '', subject = '', body = ''] = record.replace(/^\n/, '').split('\x00');
				if (hash !== '') yield parseCommit({ hash, subject, body });
			}
		}
		const code = await exited;
		if (code !== 0) throw new Error(`git log ${range} failed (exit ${code}): ${errors.trim()}`);
	} finally {
		if (git.exitCode === null) git.kill();
	}
}

/** True for the commit a release adds, which no release notes list. */
export function isReleaseCommit(commit: ParsedCommit): boolean {
	return commit.type === 'chore' && commit.scope === 'release';
}

export type Bump = 'major' | 'minor' | 'patch' | 'none';
export type ReleaseType = 'auto' | 'major' | 'minor' | 'patch';

/**
 * The bump that a set of commits implies: a patch for any conventional commit. Minor and major
 * versions follow the roadmap, where each one is a set of features and the docs label pages with
 * the version that ships them. So a person picks a minor or major bump when that set is done.
 */
export function computeBump(commits: readonly ParsedCommit[]): Bump {
	return commits.some((c) => c.type !== '') ? 'patch' : 'none';
}

/** Applies the release type that the person starting the release chose; `auto` keeps the bump. */
export function applyOverride(auto: Bump, override: ReleaseType): Bump {
	return override === 'auto' ? auto : override;
}

export function parseVersion(version: string): [number, number, number] {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
	if (!m) throw new Error(`Not a plain MAJOR.MINOR.PATCH version: ${version}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function nextVersion(previous: string, bump: Bump): string {
	if (bump === 'none') throw new Error('A "none" bump has no next version');
	const [major, minor, patch] = parseVersion(previous);
	switch (bump) {
		case 'major':
			return `${major + 1}.0.0`;
		case 'minor':
			return `${major}.${minor + 1}.0`;
		case 'patch':
			return `${major}.${minor}.${patch + 1}`;
	}
}

/**
 * Release-notes sections in order, each with the commit types it lists. Sections that users meet
 * come first, so a cut to GitHub's length limit drops the repository's own work first. Other types
 * and plain subjects go under "Other".
 */
const SECTIONS: readonly (readonly [heading: string, types: readonly string[]])[] = [
	['Features', ['feat']],
	['Bug fixes', ['fix']],
	['Performance', ['perf']],
	['Refactors', ['refactor', 'style']],
	['Documentation', ['docs']],
	['Tests', ['test']],
	['Build and tooling', ['build', 'ci', 'chore']],
];
const KNOWN_TYPES = new Set(SECTIONS.flatMap(([, types]) => types));

/** Scopes that name a part of a package rather than a package of their own, by package folder. */
const PACKAGE_PARTS: Readonly<Record<string, string>> = {
	core: 'engine',
	render: 'engine',
	gpu: 'engine',
	shaders: 'engine',
	shadows: 'engine',
	errors: 'engine',
	wasm: 'engine',
	assets: 'cli',
};
const DOCS_SCOPES = new Set(['docs', 'api', 'guides', 'skills']);
/** Scopes of the repository's own work: its tools, tests, benchmarks, CI and maintainer records. */
const REPOSITORY_SCOPES = new Set([
	'dev',
	'decisions',
	'tools',
	'tests',
	'test',
	'images',
	'image',
	'pages',
	'bench',
	'parity',
	'devices',
	'browser',
	'browsers',
	'restarts',
	'ci',
	'hooks',
	'deps',
	'release',
]);

const EXAMPLES_AREA = 'Examples';
const DOCS_AREA = 'Docs and skills';
/** Scopes that the notes do not know; each line keeps its scope. */
const OTHER_AREA = 'Other parts';
const REPOSITORY_AREA = 'Repository and tooling';

/**
 * The part of the project a commit touches, from its scope: a package such as `@null3d/engine`, the
 * examples, the docs, the repository's own work, or an empty string when the commit has no scope.
 */
export function areaOf(scope: string | null, packages: readonly string[]): string {
	if (scope === null) return '';
	const name = scope.toLowerCase().split(/[\s,]/)[0] ?? '';
	const folder = PACKAGE_PARTS[name] ?? name;
	if (packages.includes(folder)) return `@null3d/${folder}`;
	if (name === 'examples') return EXAMPLES_AREA;
	if (DOCS_SCOPES.has(name)) return DOCS_AREA;
	if (REPOSITORY_SCOPES.has(name) || /^m\d+$/.test(name)) return REPOSITORY_AREA;
	return OTHER_AREA;
}

/** Areas in the order the notes list them: the engine, the other packages, then the rest. */
function areaRank(area: string): string {
	if (area === '@null3d/engine') return '0';
	if (area.startsWith('@null3d/')) return `1${area}`;
	return `${[EXAMPLES_AREA, DOCS_AREA, OTHER_AREA, REPOSITORY_AREA, ''].indexOf(area) + 2}`;
}

const REFERENCE = `(?:${INTERNAL_REFERENCE_SOURCE})`;
const RECORD = DECISION_RECORD_SOURCE;
const list = (item: string) => `${item}(?:(?:,\\s*|\\s+(?:and|to)\\s+)${item})+`;
/**
 * Rewrites that take the maintainers' references out of a line and keep it readable: a possessive
 * becomes "the", a decision record becomes "the record" unless a noun already names it, and an
 * aside, an appositive or a closing "for T-36" goes with its words.
 */
const REWORDINGS: readonly (readonly [RegExp, string])[] = [
	[new RegExp(`\\b(?:the )?${REFERENCE}'s\\b`, 'g'), 'the'],
	[new RegExp(`(?:the |decision records? )?${list(RECORD)}`, 'g'), 'the records'],
	[new RegExp(list(REFERENCE), 'g'), ''],
	[new RegExp(`\\s*\\(${REFERENCE}\\)`, 'g'), ''],
	[new RegExp(`${REFERENCE},\\s+`, 'g'), ''],
	[new RegExp(`(?<=\\b(?:ruling|decision|record))\\s+${RECORD}`, 'g'), ''],
	[new RegExp(`(?:the |decision records? )?${RECORD}`, 'g'), 'the record'],
	[
		new RegExp(
			`,?\\s+(?:to|in|for|of|as|by|from|after|with|which closes)\\s+${REFERENCE}(?=$|[,;:)])`,
			'g',
		),
		'',
	],
	[new RegExp(`\\s*${REFERENCE}`, 'g'), ''],
];

/**
 * A commit's description as a line of the release notes: without the maintainers' task IDs,
 * decision records and milestones, and starting with a capital. The commit link beside it leads to
 * the full message.
 */
export function userWording(description: string): string {
	let text = description;
	for (const [pattern, replacement] of REWORDINGS) text = text.replace(pattern, replacement);
	text = text
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([,;:)])/g, '$1')
		.replace(/^[\s,;:]+|[\s,;:]+$/g, '');
	if (text === '') text = description.trim();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Subjects written before the commit hook checked them, by commit hash, as the release notes word
 * them. Every newer subject passes the hook's check, so this list does not grow.
 */
const REWORDED_SUBJECTS: Readonly<Record<string, string>> = {
	d5c9d03ce654129dae33b737e6613975652ff8f5: 'the engine core, tuned for desktop speed',
	f50a9a6e9e1da940b726e6a46948f0e5d71d961c:
		'rename to null3D, cut releases through pull requests, and write docs for engine users',
};

/**
 * Why release notes cannot be published: each line that breaks the published docs' writing rules,
 * which the docs check holds `CHANGELOG.md` to. Empty when the notes pass.
 */
export function notesProblems(notes: string): string[] {
	return checkDocsStyle(notes)
		.filter((f) => f.severity === 'error')
		.map((f) => `line ${f.line}: ${f.message} (${f.excerpt})`);
}

export interface ChangelogOptions {
	version: string;
	/** The release date as YYYY-MM-DD. */
	date: string;
	commits: readonly ParsedCommit[];
	/** The folder names in `packages/`, which name the npm packages. */
	packages: readonly string[];
	/** The previous release tag, or null for the first release. */
	previousTag: string | null;
	/** The repository URL, such as https://github.com/owner/repo, for commit and compare links. */
	repoUrl?: string;
}

/** One line of the notes: commits with the same words in one area share it. */
interface Entry {
	area: string;
	scope: string | null;
	text: string;
	hashes: string[];
	prs: number[];
}

/** Characters of a commit hash that the notes show. */
const SHORT_HASH = 9;

function renderEntry(entry: Entry, repoUrl?: string): string {
	const scope = entry.area === OTHER_AREA && entry.scope ? `**${entry.scope}:** ` : '';
	const links = [
		...entry.prs.map((pr) => (repoUrl ? `[#${pr}](${repoUrl}/pull/${pr})` : `#${pr}`)),
		...entry.hashes.map((hash) => {
			const short = hash.slice(0, SHORT_HASH);
			return repoUrl ? `[${short}](${repoUrl}/commit/${hash})` : short;
		}),
	];
	return `- ${scope}${entry.text}${links.length > 0 ? ` (${links.join(', ')})` : ''}`;
}

/**
 * One section of the notes. Its lines go under a heading for each area, and commits whose words
 * match in one area share a line, which links each of them.
 */
function renderSection(
	heading: string,
	commits: readonly ParsedCommit[],
	packages: readonly string[],
	repoUrl?: string,
): string {
	const entries = new Map<string, Entry>();
	for (const c of commits) {
		const area = areaOf(c.scope, packages);
		const text = userWording(REWORDED_SUBJECTS[c.hash] ?? c.description);
		const key = `${area}\n${area === OTHER_AREA ? c.scope : ''}\n${text.toLowerCase()}`;
		const entry = entries.get(key) ?? { area, scope: c.scope, text, hashes: [], prs: [] };
		entry.hashes.push(c.hash);
		if (c.pr !== null && !entry.prs.includes(c.pr)) entry.prs.push(c.pr);
		entries.set(key, entry);
	}
	if (entries.size === 0) return '';
	const byArea = Map.groupBy(entries.values(), (e) => e.area);
	const areas = [...byArea.keys()].sort((a, b) => areaRank(a).localeCompare(areaRank(b)));
	const lists = areas.map((area) => {
		const lines = (byArea.get(area) ?? []).map((e) => renderEntry(e, repoUrl)).join('\n');
		if (areas.length === 1 && area === '') return `${lines}\n`;
		return `#### ${area || 'Across the project'}\n\n${lines}\n`;
	});
	return `### ${heading}\n\n${lists.join('\n')}`;
}

/**
 * One release's notes, which are its section of the changelog file and the GitHub Release text.
 * They list every commit in the release, whichever branch brought it to main.
 */
export function renderChangelog({
	version,
	date,
	commits,
	packages,
	previousTag,
	repoUrl,
}: ChangelogOptions): string {
	const section = (heading: string, list: readonly ParsedCommit[]) =>
		renderSection(heading, list, packages, repoUrl);
	const blocks = [
		`## ${version} - ${date}\n`,
		section(
			'Breaking changes',
			commits.filter((c) => c.breaking),
		),
		...SECTIONS.map(([heading, types]) =>
			section(
				heading,
				commits.filter((c) => types.includes(c.type)),
			),
		),
		section(
			'Other',
			commits.filter((c) => !KNOWN_TYPES.has(c.type)),
		),
	].filter(Boolean);
	if (blocks.length === 1) blocks.push('_No notable changes._\n');
	if (repoUrl) {
		const link = previousTag
			? `${repoUrl}/compare/${previousTag}...${version}`
			: `${repoUrl}/commits/${version}`;
		blocks.push(`**Full changelog**: ${link}`);
	}
	return `${blocks.join('\n').trimEnd()}\n`;
}

/** GitHub refuses a release whose text is longer than this many characters. */
export const RELEASE_TEXT_LIMIT = 125_000;

/**
 * Release notes cut to a length limit at a line's end, with a closing line that links the full
 * list. Unchanged when they fit.
 */
export function fitReleaseText(notes: string, limit: number, fullListUrl: string): string {
	if (notes.length <= limit) return notes;
	const closing = `\n\n_GitHub limits the length of this text, so the list stops here. [CHANGELOG.md](${fullListUrl}) lists every change of this release._\n`;
	const cut = notes.lastIndexOf('\n', limit - closing.length);
	return `${notes.slice(0, Math.max(cut, 0)).trimEnd()}${closing}`;
}

/** Adds a release's section to the top of the changelog file, under its title. */
export function prependChangelog(existing: string, section: string): string {
	const previous = existing.replace(/^# Changelog\n+/, '').trim();
	return `# Changelog\n\n${section.trim()}\n${previous ? `\n${previous}\n` : ''}`;
}

/**
 * One version's notes from the changelog file: the lines under its `## <version>` heading, up to
 * the next release. The heading itself is left out, because the GitHub Release title shows the
 * version. Null when the file has no such version.
 */
export function extractReleaseNotes(changelog: string, version: string): string | null {
	const lines = changelog.split('\n');
	const start = lines.findIndex(
		(l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`,
	);
	if (start === -1) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith('## '));
	return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

export interface PageStatus {
	id: string;
	status: string;
	since: string;
}

/** The status and first version of every page in the docs inventory. */
export function pageStatuses(root: string): PageStatus[] {
	return PAGES.flatMap((page) => {
		const text = readIfExists(root, pagePath(page.id));
		const fm = text === null ? null : parseFrontMatter(text);
		return fm
			? [{ id: page.id, status: String(fm.data.status), since: String(fm.data.since) }]
			: [];
	});
}

/** The README's roadmap: its section and the table of planned features by version. */
const ROADMAP = /^## Roadmap$|Everything else planned, by version/m;

/**
 * Why a version cannot be released yet. A minor or major release ships the features of every
 * page with that version or an earlier one, so none of those pages may still be planned. From 1.0
 * on, releases are public, and the roadmap is internal, so the README must not carry it.
 */
export function releaseProblems(
	version: string,
	pages: readonly PageStatus[],
	readme: string,
): string[] {
	const [major, minor, patch] = parseVersion(version);
	const problems: string[] = [];
	if ((major > 0 || minor > 0) && patch === 0) {
		for (const page of pages) {
			const since = /^(\d+)\.(\d+)$/.exec(page.since);
			if (page.status !== 'planned' || !since) continue;
			const [sinceMajor, sinceMinor] = [Number(since[1]), Number(since[2])];
			if (sinceMajor < major || (sinceMajor === major && sinceMinor <= minor))
				problems.push(
					`${pagePath(page.id)} is still planned, and ${version} ships its feature (since ${page.since})`,
				);
		}
	}
	if (major >= 1 && ROADMAP.test(readme))
		problems.push(
			`README.md still has the roadmap, which is internal; remove it before the public ${version} release`,
		);
	return problems;
}

/** A file that holds the release version, and where in the file the version sits. */
export interface VersionCopy {
	path: string;
	/** Three groups: the text before the version, the version, and the text after it. */
	pattern: RegExp;
}

/** The folder names in `packages/` that hold a package manifest, one per npm package. */
export function packageFolders(root: string): string[] {
	return readdirSync(join(root, 'packages')).filter((name) =>
		existsSync(join(root, 'packages', name, 'package.json')),
	);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every copy of the release version: each package manifest, the engine's `VERSION` export, the
 * Rust workspace version (which the core reports), and the workspace crates in the lockfile.
 */
export function versionCopies(root: string): VersionCopy[] {
	const manifests = packageFolders(root).map((name) => `packages/${name}/package.json`);
	const crates = readdirSync(join(root, 'crates')).flatMap((dir) => {
		const name = /^name = "([^"]+)"/m.exec(readIfExists(root, `crates/${dir}/Cargo.toml`) ?? '');
		return name?.[1] ? [name[1]] : [];
	});
	return [
		...manifests.map((path) => ({ path, pattern: /("version":\s*")([^"]*)(")/ })),
		{ path: 'packages/engine/src/index.ts', pattern: /(export const VERSION = ')([^']*)(')/ },
		{ path: 'Cargo.toml', pattern: /(\[workspace\.package\][^[]*?\nversion = ")([^"]*)(")/ },
		// The agent skills' plugin: its version, and the release tag it fetches the skills from.
		{ path: '.claude-plugin/marketplace.json', pattern: /("version":\s*")([^"]*)(")/ },
		{ path: '.claude-plugin/marketplace.json', pattern: /("ref":\s*")([^"]*)(")/ },
		...crates.map((name) => ({
			path: 'Cargo.lock',
			pattern: new RegExp(`(name = "${escapeRegExp(name)}"\\nversion = ")([^"]*)(")`),
		})),
	];
}

export function readVersion(text: string, copy: VersionCopy): string | null {
	return copy.pattern.exec(text)?.[2] ?? null;
}

export function writeVersion(text: string, copy: VersionCopy, version: string): string {
	if (!copy.pattern.test(text))
		throw new Error(`${copy.path} has no version where the release expects one (${copy.pattern})`);
	return text.replace(copy.pattern, `$1${version}$3`);
}
