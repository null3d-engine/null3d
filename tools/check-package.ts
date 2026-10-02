// Packs the engine's npm package as `npm publish` would, without writing the tarball, and fails
// unless the package holds every shader module. Git does not keep the modules, so the package
// gets them only from the build that its prepack script runs. Run from the repository root:
//   bun tools/check-package.ts
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isShaderModule, MODULE_DIR } from './shaders';

const PACKAGE_DIR = 'packages/engine';

function main(): void {
	const root = join(import.meta.dirname, '..');
	const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], {
		cwd: join(root, PACKAGE_DIR),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	if (pack.status !== 0) throw new Error(`npm pack failed with status ${pack.status}`);
	// The prepack script's output can come before npm's JSON.
	const json = pack.stdout.slice(Math.max(0, pack.stdout.search(/^\[/m)));
	const [result] = JSON.parse(json) as { files: { path: string }[] }[];
	const packed = new Set(result?.files.map((file) => file.path));
	// The prepack script has built the modules by now.
	const modules = readdirSync(join(root, MODULE_DIR)).filter(isShaderModule);
	if (!modules.includes('shaders.ts')) throw new Error(`${MODULE_DIR} holds no shader modules`);
	const folder = MODULE_DIR.slice(PACKAGE_DIR.length + 1);
	const missing = modules.map((name) => `${folder}/${name}`).filter((path) => !packed.has(path));
	if (missing.length > 0)
		throw new Error(`the engine's npm package lacks these shader modules: ${missing.join(', ')}`);
	console.log(`The engine's npm package holds all ${modules.length} shader modules.`);
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
