// Pre-commit guard: every committed generated file (docs placeholders, the API reference, the page
// list, the error pages, the three.js mapping page and copies, the tables of tested devices, and
// the .claude/skills copy) must match what its generator makes now, and must be staged. The files
// of the record of tested devices must follow its rules. Every public export of the engine must
// also have the doc comments the API reference needs. Generated files then never lag the code and
// data they come from. Git does not keep the shader modules; the type check that runs before this
// guard builds them, and fails when a shader does not build.
import { execSync } from 'node:child_process';
import { readApi } from '../lib/api-docs';
import { generateDocs, referenceProblems, staleFiles } from '../lib/docs';
import { expectedSkillCopies, skillCopyProblems } from '../lib/skills';
import { readRecord, recordFiles } from '../lib/tested-devices';

/** Paths whose working-tree state differs from the index, from `git status --porcelain` output. */
export function unstagedPaths(porcelain: string): string[] {
	return porcelain
		.split('\n')
		.filter((line) => line.length > 3 && line[1] !== ' ')
		.map((line) => line.slice(3));
}

function main(): void {
	const root = process.cwd();
	const api = readApi(root);
	const docs = generateDocs(root, api);
	const problems = [
		...referenceProblems(api),
		...staleFiles(root, docs).map((p) => `${p} is out of date`),
		...skillCopyProblems(root),
		...readRecord(recordFiles(root)).problems,
	];
	const generated = new Set([...docs.keys(), ...expectedSkillCopies(root).keys()]);
	const porcelain = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' });
	for (const path of unstagedPaths(porcelain)) {
		if (generated.has(path)) problems.push(`${path} has changes that are not staged`);
	}
	if (problems.length === 0) return;
	console.error('\ncommit rejected: generated files are out of date or not staged:\n');
	for (const p of problems) console.error(`  ${p}`);
	console.error(
		'\nAdd any missing doc comments, run `bun run docs` or `bun run skills`, then stage the results.\n',
	);
	process.exit(1);
}

if (import.meta.main) main();
