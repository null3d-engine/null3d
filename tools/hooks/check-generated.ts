// Pre-commit guard: every generated file (docs placeholders, the page list, the three.js mapping
// page and copies, and the .claude/skills copy) must match what its generator makes now, and must
// be staged. Generated pages then never lag the code and data they come from.
import { execSync } from 'node:child_process';
import { generateDocs, staleFiles } from '../lib/docs';
import { expectedSkillCopies, skillCopyProblems } from '../lib/skills';

/** Paths whose working-tree state differs from the index, from `git status --porcelain` output. */
export function unstagedPaths(porcelain: string): string[] {
	return porcelain
		.split('\n')
		.filter((line) => line.length > 3 && line[1] !== ' ')
		.map((line) => line.slice(3));
}

function main(): void {
	const root = process.cwd();
	const docs = generateDocs(root);
	const problems = [
		...staleFiles(root, docs).map((p) => `${p} is out of date`),
		...skillCopyProblems(root),
	];
	const generated = new Set([...docs.keys(), ...expectedSkillCopies(root).keys()]);
	const porcelain = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' });
	for (const path of unstagedPaths(porcelain)) {
		if (generated.has(path)) problems.push(`${path} has changes that are not staged`);
	}
	if (problems.length === 0) return;
	console.error('\ncommit rejected: generated files are out of date or not staged:\n');
	for (const p of problems) console.error(`  ${p}`);
	console.error('\nRun `bun run docs` and `bun run skills`, then stage the results.\n');
	process.exit(1);
}

if (import.meta.main) main();
