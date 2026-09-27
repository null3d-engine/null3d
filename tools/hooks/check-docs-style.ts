// Commit-msg guard: the mechanical half of the writing rules, on published Markdown the commit
// changes. `--all` checks every published file, which CI runs because a hook can be skipped.
// Errors block; warnings print and never block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDocsStyle, type StyleFinding } from '../lib/docs-style';
import { docsFiles } from '../lib/files';
import { ROOT_LINKED_FILES } from '../lib/links';
import { stagedFiles } from './commit-ack';

/** Published Markdown: every docs page, the README and AGENTS.md. */
export function isStyleChecked(path: string): boolean {
	return ROOT_LINKED_FILES.includes(path) || (path.startsWith('docs/') && path.endsWith('.md'));
}

function main(): void {
	const root = process.cwd();
	const paths = process.argv.includes('--all')
		? [...ROOT_LINKED_FILES, ...docsFiles(root)]
		: stagedFiles().filter(isStyleChecked);

	const results: { file: string; findings: StyleFinding[] }[] = [];
	for (const file of paths) {
		let content: string;
		try {
			content = readFileSync(join(root, file), 'utf8');
		} catch {
			continue; // deleted in this commit
		}
		const findings = checkDocsStyle(content);
		if (findings.length > 0) results.push({ file, findings });
	}

	const warnings = results.flatMap(({ file, findings }) =>
		findings.filter((f) => f.severity === 'warning').map((f) => ({ file, f })),
	);
	const errors = results.flatMap(({ file, findings }) =>
		findings.filter((f) => f.severity === 'error').map((f) => ({ file, f })),
	);

	for (const { file, f } of warnings)
		console.error(`  ${file}:${f.line}  [${f.rule}] ${f.message}`);
	if (warnings.length > 0)
		console.error(`\n${warnings.length} writing warning(s) above. They do not block.\n`);

	if (errors.length === 0) return;
	console.error('\ncommit rejected: published Markdown breaks the writing rules.\n');
	for (const { file, f } of errors) {
		console.error(`  ${file}:${f.line}  [${f.rule}] ${f.message}`);
		console.error(`      ${f.excerpt}`);
	}
	console.error(
		'\nFix these rather than skipping the hook. The rules are in AGENTS.md, "Writing docs".\n',
	);
	process.exit(1);
}

if (import.meta.main) main();
