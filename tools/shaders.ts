// Builds the shader modules unless they match their inputs (tools/lib/shader-modules.ts). Run from
// anywhere in the repository:
//   bun tools/shaders.ts
// `--cache-keys` builds nothing. It prints the two shared shader caches' folders and the keys that a
// build of this checkout reads them by, as name=value lines, so CI keeps those folders under the
// same keys:
//   bun tools/shaders.ts --cache-keys >> "$GITHUB_OUTPUT"
// `--entries-shard i/n` compiles only shard i of n, counted from 0, of the manifest's entries, split
// by estimated build cost, into the per-entry cache that a normal build reads, at
// `<entries-dir>/<stamp>`. It writes no module. With `--entries-out <folder>`, it also copies the
// entries that it stored there, and none that the cache held before, so each of several CI jobs can
// upload its own new entries, and the job that builds the modules can put them all back into that
// folder first and compile none of them:
//   bun tools/shaders.ts --entries-shard 0/8 --entries-out target/shader-entries
import { join } from 'node:path';
import {
	buildEntriesShard,
	compilerStamp,
	ensureShaderModules,
	entryCacheDir,
	inputHash,
	MODULE_DIR,
	modulesCacheDir,
} from './lib/shader-modules';

const root = join(import.meta.dirname, '..');

/** The value after the flag `name`, or undefined when the flag is absent. */
function option(name: string): string | undefined {
	const at = process.argv.indexOf(name);
	if (at < 0) return undefined;
	const value = process.argv[at + 1];
	if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
	return value;
}

try {
	const shard = option('--entries-shard');
	const out = option('--entries-out');
	if (process.argv.includes('--cache-keys')) {
		console.log(`modules-dir=${modulesCacheDir()}`);
		console.log(`entries-dir=${entryCacheDir()}`);
		console.log(`inputs=${inputHash(root)}`);
		console.log(`stamp=${compilerStamp(root)}`);
	} else if (shard !== undefined) {
		const stored = buildEntriesShard(root, shard, out);
		console.log(
			`Shard ${shard} stored ${stored.length} new shader entries in ${join(entryCacheDir(), compilerStamp(root))}${out === undefined ? '.' : `, and copied them to ${out}.`}`,
		);
	} else if (out !== undefined) {
		throw new Error('--entries-out goes with --entries-shard');
	} else if (!ensureShaderModules(root))
		console.log(`The shader modules in ${MODULE_DIR} are up to date.`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
