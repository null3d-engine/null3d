// Pre-commit guard: every generated file (docs placeholders, the API reference, the page list, the
// error pages, the three.js mapping page and copies, the .claude/skills copy, and the shader modules)
// must match what its generator makes now, and must be staged. Every public export of the engine
// must also have the doc comments the API reference needs. Generated files then never lag the code
// and data they come from.
import { execFileSync, execSync } from 'node:child_process';
import { readApi } from '../lib/api-docs';
import { generateDocs, referenceProblems, staleFiles } from '../lib/docs';
import { expectedSkillCopies, skillCopyProblems } from '../lib/skills';
import { stagedFiles } from './commit-ack';

/** True for a module of the shader build: the main module or a device module beside it. */
export function isShaderModule(file: string): boolean {
	return /^packages\/engine\/src\/generated\/shaders(-[a-z-]+)?\.ts$/.test(file);
}

/** True when a commit stages shader sources, the shader tool, or the modules it generates. */
export function touchesShaders(files: string[]): boolean {
	return files.some((f) => f.startsWith('crates/null3d-shaders/') || isShaderModule(f));
}

/** Problems with the shader modules: the tool rebuilds them in memory and compares. */
function shaderProblems(): string[] {
	if (!touchesShaders(stagedFiles())) return [];
	try {
		execFileSync(
			'cargo',
			['run', '-q', '-p', 'null3d-shaders', '--bin', 'shader-build', '--', '--check'],
			{
				stdio: 'inherit',
			},
		);
		return [];
	} catch {
		return ['a shader module is out of date or a shader does not build; run `bun run shaders`'];
	}
}

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
		...shaderProblems(),
	];
	const generated = new Set([...docs.keys(), ...expectedSkillCopies(root).keys()]);
	const porcelain = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' });
	for (const path of unstagedPaths(porcelain)) {
		if (generated.has(path) || isShaderModule(path))
			problems.push(`${path} has changes that are not staged`);
	}
	if (problems.length === 0) return;
	console.error('\ncommit rejected: generated files are out of date or not staged:\n');
	for (const p of problems) console.error(`  ${p}`);
	console.error(
		'\nAdd any missing doc comments, run `bun run docs`, `bun run skills` or `bun run shaders`,\nthen stage the results.\n',
	);
	process.exit(1);
}

if (import.meta.main) main();
