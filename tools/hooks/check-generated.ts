// Pre-commit guard: every generated file (docs placeholders, the page list, the three.js mapping
// page and copies, the .claude/skills copy, and the shader module) must match what its generator
// makes now, and must be staged. Generated files then never lag the code and data they come from.
import { execFileSync, execSync } from 'node:child_process';
import { generateDocs, staleFiles } from '../lib/docs';
import { expectedSkillCopies, skillCopyProblems } from '../lib/skills';
import { stagedFiles } from './commit-ack';

const SHADER_MODULE = 'packages/engine/src/generated/shaders.ts';

/** True when a commit stages shader sources, the shader tool, or the module it generates. */
export function touchesShaders(files: string[]): boolean {
	return files.some((f) => f.startsWith('crates/sokko3d-shaders/') || f === SHADER_MODULE);
}

/** Problems with the shader module: the tool rebuilds it in memory and compares. */
function shaderProblems(): string[] {
	if (!touchesShaders(stagedFiles())) return [];
	try {
		execFileSync(
			'cargo',
			['run', '-q', '-p', 'sokko3d-shaders', '--bin', 'shader-build', '--', '--check'],
			{
				stdio: 'inherit',
			},
		);
		return [];
	} catch {
		return [`${SHADER_MODULE} is out of date or a shader does not build; run \`bun run shaders\``];
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
	const docs = generateDocs(root);
	const problems = [
		...staleFiles(root, docs).map((p) => `${p} is out of date`),
		...skillCopyProblems(root),
		...shaderProblems(),
	];
	const generated = new Set([...docs.keys(), ...expectedSkillCopies(root).keys(), SHADER_MODULE]);
	const porcelain = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' });
	for (const path of unstagedPaths(porcelain)) {
		if (generated.has(path)) problems.push(`${path} has changes that are not staged`);
	}
	if (problems.length === 0) return;
	console.error('\ncommit rejected: generated files are out of date or not staged:\n');
	for (const p of problems) console.error(`  ${p}`);
	console.error(
		'\nRun `bun run docs`, `bun run skills` or `bun run shaders`, then stage the results.\n',
	);
	process.exit(1);
}

if (import.meta.main) main();
