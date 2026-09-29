// Checks that AGENTS.md documents every command in package.json, and that every command AGENTS.md,
// the README and the maintainer guides name exists. The pre-commit hook and the docs check run it:
//   bun tools/hooks/check-commands.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandProblems } from '../lib/commands';
import { guideFiles } from '../lib/files';

function main(): void {
	const root = process.cwd();
	/** The files that name the repository's commands. */
	const FILES = ['AGENTS.md', 'README.md', ...guideFiles(root)];
	const read = (file: string) => readFileSync(join(root, file), 'utf8');
	const scripts = Object.keys(
		(JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {},
	);
	const problems = commandProblems(
		scripts,
		Object.fromEntries(FILES.map((file) => [file, read(file)])),
	);
	if (problems.length === 0) return;
	for (const problem of problems) console.error(problem);
	console.error(
		'\nAdd each command to the table in AGENTS.md, "Commands", or fix the name (AGENTS.md, "Commit gates").',
	);
	process.exit(1);
}

if (import.meta.main) main();
