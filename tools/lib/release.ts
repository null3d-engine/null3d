// Release versions and changelogs from Conventional Commits (AGENTS.md, "Releases"). Parsing,
// version arithmetic, changelog rendering and the release checks are pure, so the release script
// and its tests share them. Reading the version copies and the docs pages is the only file access.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, pagePath } from './docs';
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
	/** Short commit hash. */
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

/** True for the commit a release pull request adds, which no changelog lists. */
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

/** Changelog sections in order, by commit type. Other types and plain subjects go under "Other". */
const SECTIONS: readonly (readonly [type: string, heading: string])[] = [
	['feat', 'Features'],
	['fix', 'Bug fixes'],
	['perf', 'Performance'],
	['refactor', 'Refactors'],
	['docs', 'Documentation'],
	['build', 'Build system'],
	['test', 'Tests'],
	['chore', 'Chores'],
];
const KNOWN_TYPES = new Set(SECTIONS.map(([type]) => type));

export interface ChangelogOptions {
	version: string;
	/** The release date as YYYY-MM-DD. */
	date: string;
	commits: readonly ParsedCommit[];
	/** The previous release tag, or null for the first release. */
	previousTag: string | null;
	/** The repository URL, such as https://github.com/owner/repo, for pull request and compare links. */
	repoUrl?: string;
}

function renderLine(c: ParsedCommit, repoUrl?: string): string {
	const scope = c.scope ? `**${c.scope}:** ` : '';
	const pr =
		c.pr === null ? '' : repoUrl ? ` ([#${c.pr}](${repoUrl}/pull/${c.pr}))` : ` (#${c.pr})`;
	return `- ${scope}${c.description}${pr}`;
}

function renderSection(
	heading: string,
	commits: readonly ParsedCommit[],
	repoUrl?: string,
): string {
	if (commits.length === 0) return '';
	return `### ${heading}\n\n${commits.map((c) => renderLine(c, repoUrl)).join('\n')}\n`;
}

/** One release's changelog section, which is also the GitHub Release body. */
export function renderChangelog({
	version,
	date,
	commits,
	previousTag,
	repoUrl,
}: ChangelogOptions): string {
	const blocks = [
		`## ${version} - ${date}\n`,
		renderSection(
			'Breaking changes',
			commits.filter((c) => c.breaking),
			repoUrl,
		),
		...SECTIONS.map(([type, heading]) =>
			renderSection(
				heading,
				commits.filter((c) => c.type === type),
				repoUrl,
			),
		),
		renderSection(
			'Other',
			commits.filter((c) => !KNOWN_TYPES.has(c.type)),
			repoUrl,
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every copy of the release version: each package manifest, the engine's `VERSION` export, the
 * Rust workspace version (which the core reports), and the workspace crates in the lockfile.
 */
export function versionCopies(root: string): VersionCopy[] {
	const manifests = readdirSync(join(root, 'packages'))
		.map((name) => `packages/${name}/package.json`)
		.filter((path) => existsSync(join(root, path)));
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
