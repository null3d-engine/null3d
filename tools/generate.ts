// Writes every generated file that git does not keep: the docs generator's output and the skills
// copy in .claude/skills (tools/lib/generated.ts). Run from the repository root:
//   bun tools/generate.ts           write them; `bun install` and the git hooks after a checkout,
//                                   merge or rebase run this
//   bun tools/generate.ts --stage   also stage every generated file, for a commit that holds them,
//                                   such as a release's tagged commit
// It never builds Rust. Without the shader modules, the engine's API reference lacks the names of
// the shader features until `bun run shaders` or `bun run build` and the next run of this.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const stage = process.argv.includes('--stage');

try {
	const { writeGenerated } = await import('./lib/generated');
	const { files, written, problems } = writeGenerated(root);
	console.log(`generated files: ${written.length} of ${files.size} changed`);
	for (const p of problems) console.log(`warning: ${p}`);
	if (!existsSync(join(root, 'packages/engine/src/generated/shader-features.ts')))
		console.log(
			'note: the shader modules are missing, so the engine API reference lacks the shader features; run bun run shaders, then bun tools/generate.ts',
		);
	if (stage)
		execFileSync('git', ['add', '-f', '--', ...files.keys()], { cwd: root, stdio: 'inherit' });
} catch (e) {
	console.error(`generated files not written: ${(e as Error).message}`);
	console.error('Run bun install, which installs the packages that the generators need.');
	if (stage) process.exit(1);
}
