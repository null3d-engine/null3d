// Builds the shader modules unless they match their inputs (tools/lib/shader-modules.ts). Run from
// anywhere in the repository:
//   bun tools/shaders.ts
// `--cache-keys` builds nothing. It prints the two shared shader caches' folders and the keys that a
// build of this checkout reads them by, as name=value lines, so CI keeps those folders under the
// same keys. It also prints the Actions cache's key of the two folders, `key`, and the prefixes
// that a job falls back on, `branch-keys` and then `stamp-keys`. Each branch keeps its own
// entries, so the next push to it restores what the last one built, and restores another
// branch's entries of the same compiler when it has none. A pull request's run keeps them under
// its merge ref, which the next push to it shares, and main keeps them with no branch in the key.
// The branch and the runner's system come from the runner's GITHUB_REF_NAME and RUNNER_OS:
//   bun tools/shaders.ts --cache-keys >> "$GITHUB_OUTPUT"
// `--entries-shard i/n` compiles only shard i of n, counted from 0, of the manifest's entries, split
// by estimated build cost, into the per-entry cache that a normal build reads, at
// `<entries-dir>/<stamp>`. An entry that costs more than an even share goes to the shards in parts,
// which the cache keeps beside the entry's key and a later build joins. It writes no module. With `--entries-out <folder>`, it also copies the
// entries that it stored there, and none that the cache held before, so each of several CI jobs can
// upload its own new entries, and the job that builds the modules can put them all back into that
// folder first and compile none of them. Shard 0 also copies the shader build's program, which the
// cache keeps beside its compiler's entries, so that job runs it without compiling it:
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
		const inputs = inputHash(root);
		const stamp = compilerStamp(root);
		const branch = process.env.GITHUB_REF_NAME ?? '';
		const scope = branch === '' || branch === 'main' ? '' : `branch-${branch}-`;
		const prefix = `shaders-${process.env.RUNNER_OS ?? process.platform}-${stamp}-`;
		console.log(`modules-dir=${modulesCacheDir()}`);
		console.log(`entries-dir=${entryCacheDir()}`);
		console.log(`inputs=${inputs}`);
		console.log(`stamp=${stamp}`);
		console.log(`key=${prefix}${scope}${inputs}`);
		console.log(`branch-keys=${prefix}${scope}`);
		console.log(`stamp-keys=${prefix}`);
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
