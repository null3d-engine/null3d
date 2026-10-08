// Computes the next release version and its changelog from the Conventional Commits since the last
// release tag (AGENTS.md, "Releases"). The Release workflow runs `--apply` on a release branch and
// opens a pull request; merging that pull request tags the version and publishes it.
//   bun tools/release.ts [--release-type auto|patch|minor|major]
//                                   print the next version and its changelog, and change nothing
//   bun tools/release.ts --apply    also write every version copy and add the section to
//                                   CHANGELOG.md; in CI, write `version` and `changelog` to
//                                   $GITHUB_OUTPUT
//   bun tools/release.ts --notes <version>
//                                   print that version's section of CHANGELOG.md
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readIfExists } from './lib/files';
import {
	applyOverride,
	computeBump,
	extractReleaseNotes,
	isReleaseCommit,
	nextVersion,
	type ParsedCommit,
	pageStatuses,
	parseCommit,
	prependChangelog,
	type ReleaseType,
	releaseProblems,
	renderChangelog,
	versionCopies,
	writeVersion,
} from './lib/release';

const root = process.cwd();
const CHANGELOG = 'CHANGELOG.md';
const RELEASE_TYPES: readonly ReleaseType[] = ['auto', 'patch', 'minor', 'major'];
/** Release tags are plain versions, with no `v` prefix and no pre-release part. */
const TAG_RE = /^\d+\.\d+\.\d+$/;

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function previousTag(): string | null {
	return (
		git('tag', '--list', '--sort=-v:refname')
			.split('\n')
			.map((t) => t.trim())
			.find((t) => TAG_RE.test(t)) ?? null
	);
}

/** Commits since the tag, newest first. Git fills the fields in with NUL and record separators. */
function commitsSince(tag: string | null): ParsedCommit[] {
	const log = git(
		'log',
		tag ? `${tag}..HEAD` : 'HEAD',
		'--no-merges',
		'--format=%h%x00%s%x00%b%x1e',
	);
	return log
		.split('\x1e')
		.map((record) => record.replace(/^\n/, ''))
		.filter((record) => record.trim().length > 0)
		.map((record) => {
			const [hash = '', subject = '', body = ''] = record.split('\x00');
			return parseCommit({ hash: hash.trim(), subject, body });
		})
		.filter((c) => !isReleaseCommit(c));
}

function repoUrl(): string | undefined {
	const { GITHUB_SERVER_URL, GITHUB_REPOSITORY } = process.env;
	if (GITHUB_SERVER_URL && GITHUB_REPOSITORY) return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`;
	try {
		const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin').trim());
		return match ? `https://github.com/${match[1]}` : undefined;
	} catch {
		return undefined;
	}
}

function apply(version: string, changelog: string): void {
	for (const copy of versionCopies(root)) {
		const path = join(root, copy.path);
		writeFileSync(path, writeVersion(readFileSync(path, 'utf8'), copy, version));
	}
	writeFileSync(
		join(root, CHANGELOG),
		prependChangelog(readIfExists(root, CHANGELOG) ?? '', changelog),
	);
	const output = process.env.GITHUB_OUTPUT;
	if (output)
		appendFileSync(
			output,
			`version=${version}\nchangelog<<RELEASE_EOF\n${changelog}\nRELEASE_EOF\n`,
		);
}

function main(): void {
	const { values } = parseArgs({
		options: {
			'release-type': { type: 'string', default: 'auto' },
			apply: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			notes: { type: 'string' },
		},
	});

	if (values.notes !== undefined) {
		const notes = extractReleaseNotes(readIfExists(root, CHANGELOG) ?? '', values.notes);
		if (notes === null) fail(`${CHANGELOG} has no section for ${values.notes}`);
		console.log(notes);
		return;
	}

	const releaseType = values['release-type'] as ReleaseType;
	if (!RELEASE_TYPES.includes(releaseType))
		fail(`--release-type must be one of ${RELEASE_TYPES.join(', ')}, not "${releaseType}"`);

	try {
		git('fetch', '--tags', '--force');
	} catch (e) {
		console.warn(`Could not fetch tags: ${(e as Error).message}`);
	}
	const tag = previousTag();
	const commits = commitsSince(tag);
	let bump = applyOverride(computeBump(commits), releaseType);
	// A release someone starts by hand always releases, even with nothing to list.
	if (bump === 'none') {
		console.warn(`No releasable commits since ${tag ?? 'the first commit'}; releasing a patch.`);
		bump = 'patch';
	}
	const version = nextVersion(tag ?? '0.0.0', bump);

	const problems = releaseProblems(
		version,
		pageStatuses(root),
		readIfExists(root, 'README.md') ?? '',
	);
	if (problems.length > 0)
		fail(`${version} cannot be released yet:\n${problems.map((p) => `  ${p}`).join('\n')}`);

	const changelog = renderChangelog({
		version,
		date: new Date().toISOString().slice(0, 10),
		commits,
		previousTag: tag,
		repoUrl: repoUrl(),
	});
	if (values.apply) {
		apply(version, changelog);
		console.log(`Prepared release ${version} (bump: ${bump}, previous: ${tag ?? 'none'}).`);
	} else {
		console.log(`version: ${version} (bump: ${bump}, previous: ${tag ?? 'none'})\n`);
		console.log(changelog);
	}
}

main();
