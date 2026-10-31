// The repository's own modules that hold WGSL: the `.wgsl` files and the scripts with tagged WGSL
// of the test pages, the fixtures and the demos. The plugin's packing test compiles each one, and
// CI keys that test's pass on their contents, so a change that touches no shader passes it again.
// CI runs the test in parts, each with a share of the modules and a pass of its own:
//   bun tools/lib/wgsl-modules.ts         print `hash=<sha-256>` of those modules, for $GITHUB_OUTPUT
//   bun tools/lib/wgsl-modules.ts <k/n>   print the hash of part k of n's share
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

/**
 * The modules of part `k` of `n`, from a share written `k/n`: every n-th module from the k-th, so
 * the parts split the set evenly by count. Without a share, every module.
 */
export function moduleShare(modules: readonly string[], share?: string): string[] {
	if (!share) return [...modules];
	const match = /^(\d+)\/(\d+)$/.exec(share);
	const part = Number(match?.[1]);
	const parts = Number(match?.[2]);
	if (!match || part < 1 || part > parts)
		throw new Error(
			`a share of the modules is k/n with k from 1 to n, such as 1/4, not '${share}'`,
		);
	return modules.filter((_, i) => i % parts === part - 1);
}

if (import.meta.main) {
	const root = join(import.meta.dirname, '../..');
	console.log(`hash=${hashFiles(root, moduleShare(wgslModules(root), process.argv[2]))}`);
}
