// Commit-msg guard: the mechanical half of the writing rules, on published Markdown the commit
// changes and on the commit's subject, which becomes a changelog line. `--all` checks every
// published file, which CI runs because a hook can be skipped. `--subject <text>` checks one line
// as a changelog entry, which CI runs on the line a squash merge puts on main. Errors block;
// warnings print and never block.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDocsStyle, type DocsAudience, type StyleFinding } from '../lib/docs-style';
import { docsFiles, walkFiles } from '../lib/files';
import { ROOT_LINKED_FILES } from '../lib/links';
import { effectiveMessage, isExemptCommit, stagedFiles } from './commit-ack';

const CHANGELOG = 'CHANGELOG.md';

/** Files for contributors: they describe the maintainers' own process. */
const CONTRIBUTOR_FILES = new Set(['AGENTS.md']);

/**
 * Published Markdown: every docs page, the skills, the README, the package READMEs, the changelog
 * and AGENTS.md.
 */
export function isStyleChecked(path: string): boolean {
	return (
		ROOT_LINKED_FILES.includes(path) ||
		path === CHANGELOG ||
		/^(docs|skills)\/.+\.md$/.test(path) ||
		/^packages\/[^/]+\/README\.md$/.test(path)
	);
}

export function audienceOf(path: string): DocsAudience {
	return CONTRIBUTOR_FILES.has(path) ? 'contributors' : 'users';
}

function publishedFiles(root: string): string[] {
	const packageReadmes = readdirSync(join(root, 'packages'))
		.map((name) => `packages/${name}/README.md`)
		.filter((path) => existsSync(join(root, path)));
	return [
		...ROOT_LINKED_FILES,
		...(existsSync(join(root, CHANGELOG)) ? [CHANGELOG] : []),
		...packageReadmes,
		...docsFiles(root),
		...walkFiles(root, 'skills', (p) => p.endsWith('.md')),
	];
}

/** The subject line of a commit message, or null for a commit that git writes itself. */
export function subjectOf(rawMessage: string): string | null {
	const message = effectiveMessage(rawMessage);
	if (message.length === 0 || isExemptCommit(message)) return null;
	return message.split('\n')[0] ?? null;
}

interface Result {
	file: string;
	findings: StyleFinding[];
}

/** Prints warnings, then errors; exits when any error blocks. */
function report(results: Result[], rejection: string): void {
	const all = results.flatMap(({ file, findings }) => findings.map((f) => ({ file, f })));
	const warnings = all.filter(({ f }) => f.severity === 'warning');
	const errors = all.filter(({ f }) => f.severity === 'error');

	for (const { file, f } of warnings)
		console.error(`  ${file}:${f.line}  [${f.rule}] ${f.message}`);
	if (warnings.length > 0)
		console.error(`\n${warnings.length} writing warning(s) above. They do not block.\n`);

	if (errors.length === 0) return;
	console.error(`\n${rejection}\n`);
	for (const { file, f } of errors) {
		console.error(`  ${file}:${f.line}  [${f.rule}] ${f.message}`);
		console.error(`      ${f.excerpt}`);
	}
	console.error(
		'\nFix these rather than skipping the hook. The rules are in AGENTS.md, "Writing docs".\n',
	);
	process.exit(1);
}

function main(): void {
	const root = process.cwd();
	const args = process.argv.slice(2);

	const subjectFlag = args.indexOf('--subject');
	if (subjectFlag !== -1) {
		const subject = args[subjectFlag + 1] ?? '';
		report(
			[{ file: 'subject', findings: checkDocsStyle(subject) }],
			'rejected: this line becomes a public changelog entry and breaks the writing rules.',
		);
		return;
	}

	const all = args.includes('--all');
	const paths = all ? publishedFiles(root) : stagedFiles().filter(isStyleChecked);
	const results: Result[] = [];
	for (const file of paths) {
		let content: string;
		try {
			content = readFileSync(join(root, file), 'utf8');
		} catch {
			continue; // deleted in this commit
		}
		const findings = checkDocsStyle(content, audienceOf(file));
		if (findings.length > 0) results.push({ file, findings });
	}

	const messageFile = args.find((a) => !a.startsWith('--'));
	const subject = messageFile ? subjectOf(readFileSync(messageFile, 'utf8')) : null;
	if (subject !== null) {
		const findings = checkDocsStyle(subject);
		if (findings.length > 0) results.push({ file: 'commit subject', findings });
	}

	report(results, 'commit rejected: published text breaks the writing rules.');
}

if (import.meta.main) main();
