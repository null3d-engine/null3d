// Writes every generated file that git does not keep: the docs generator's output and the skills
// copy in .claude/skills (tools/lib/generated.ts). Run from the repository root:
//   bun tools/generate.ts             write them; `bun install` and the git hooks after a
//                                     checkout, merge or rebase run this
//   bun tools/generate.ts --install   also set up the git filter that empties generated sections
//                                     in staged pages; the install step runs this
//   bun tools/generate.ts --stage     also stage every generated file in full, for a commit that
//                                     holds them, such as a release's tagged commit
// It never builds Rust. Without the shader modules, the engine page's reference lacks the names of
// the shader features until `bun run shaders` or `bun run build` and the next run of this.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);

try {
	const { configureFilter, FILTER, isWorkTree, writeGenerated } = await import('./lib/generated');
	if (args.includes('--install') && isWorkTree(root)) configureFilter(root);
	const { whole, sections, written, problems } = writeGenerated(root);
	console.log(`generated files: ${written.length} of ${whole.size + sections.size} changed`);
	for (const p of problems) console.log(`warning: ${p}`);
	if (!existsSync(join(root, 'packages/engine/src/generated/shader-features.ts')))
		console.log(
			'note: the shader modules are missing, so docs/api/engine.md lacks the shader features; run bun run shaders, then bun tools/generate.ts',
		);
	if (args.includes('--stage')) {
		const { execFileSync } = await import('node:child_process');
		const git = (...gitArgs: string[]) =>
			execFileSync('git', gitArgs, { cwd: root, stdio: 'inherit' });
		git('add', '-f', '--', ...whole.keys());
		// Git applies the filter again to a page whose file looks unchanged only on renormalize, and
		// the filter is turned off so that each page keeps its generated sections.
		git('-c', `filter.${FILTER}.clean=cat`, 'add', '--renormalize', '--', ...sections.keys());
	}
} catch (e) {
	console.error(`generated files not written: ${(e as Error).message}`);
	console.error('Run bun install, which installs the packages that the generators need.');
	if (args.includes('--stage')) process.exit(1);
}
