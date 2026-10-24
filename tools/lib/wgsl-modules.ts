// The repository's own modules that hold WGSL: the `.wgsl` files and the scripts with tagged WGSL
// of the test pages, the fixtures and the demos. The plugin's packing test compiles each one, and
// CI keys that test's pass on their contents, so a change that touches no shader passes it again:
//   bun tools/lib/wgsl-modules.ts    print `hash=<sha-256>` of those modules, for $GITHUB_OUTPUT
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WGSL_TAG } from '../../packages/vite-plugin/src/wgsl';
import { hashFiles } from './build-cache';

/** The folders whose modules hold the repository's own WGSL: the test sketches and the demos. */
const WGSL_FOLDERS = ['tests/pages', 'tests/fixtures', 'examples'];

/**
 * Every module of those folders with WGSL, as the plugin compiles it: scripts and `.wgsl` files,
 * as paths from `root`, in order.
 */
export function wgslModules(root: string): string[] {
	const files: string[] = [];
	for (const folder of WGSL_FOLDERS)
		for (const file of readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })) {
			if (file.includes('node_modules')) continue;
			const path = join(folder, file);
			if (
				path.endsWith('.wgsl') ||
				(/\.[cm]?[jt]sx?$/.test(path) && WGSL_TAG.test(readFileSync(join(root, path), 'utf8')))
			)
				files.push(path);
		}
	return files.sort();
}

if (import.meta.main) {
	const root = join(import.meta.dirname, '../..');
	console.log(`hash=${hashFiles(root, wgslModules(root))}`);
}
