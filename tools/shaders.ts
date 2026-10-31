// Builds the shader modules unless they match their inputs (tools/lib/shader-modules.ts). Run from
// anywhere in the repository:
//   bun tools/shaders.ts
// `--cache-keys` builds nothing. It prints the two shared shader caches' folders and the keys that a
// build of this checkout reads them by, as name=value lines, so CI keeps those folders under the
// same keys. `stamp` names the folder that a run with an empty entries cache writes; a build that
// finds entries of a compiler with the same program bytes reads that compiler's folder instead.
// It also prints the Actions cache's key of the two folders, `key`, and the prefixes that a job
// falls back on, in this order: `branch-keys`, `stamp-keys`, then `any-stamp-keys`, which names no
// source stamp. Each branch keeps its own entries, so the next push to it restores what the last
// one built. A change of the compiler's sources changes the stamp, so the first two prefixes find
// nothing; the last one then restores entries that an earlier stamp saved, and the build reuses
// every entry whose compiler program has the same bytes. A pull request's run keeps them under its
// merge ref, which the next push to it shares, and main keeps them with no branch in the key. The
// branch and the runner's system come from the runner's GITHUB_REF_NAME and RUNNER_OS:
//   bun tools/shaders.ts --cache-keys >> "$GITHUB_OUTPUT"
// `--entry-folder` builds nothing. It prints `folder=<path>`, the entry folder that this checkout's
// compiler reads and writes, so a CI job can read, save or report the folder that a reused run
// uses instead of the source stamp's folder. A checkout that has kept no program answers with the
// folder that its build writes.
// `--entries-shard i/n` compiles only shard i of n, counted from 0, of the manifest's entries, split
// by estimated build cost, into the per-entry cache that a normal build reads, in the folder that
// the shader build program's bytes choose. A run that starts with an empty cache, as each CI job
// does, writes the folder that `stamp` names. An entry that costs more than an even share goes to the shards in parts,
// which the cache keeps beside the entry's key and a later build joins. It writes no module. With `--entries-out <folder>`, it also copies the
// entries that it stored there, and none that the cache held before, under the name of the cache's
// folder that holds them. So each of several CI jobs can upload its own new entries, and the job
// that builds the modules can put them all back into its per-entry cache first, each in the folder
// that its build reads, and compile none of them. Shard 0 also copies the shader build's program,
// under the stamp's folder, where a build looks for it first, so that job runs it without compiling
// it:
//   bun tools/shaders.ts --entries-shard 0/8 --entries-out target/shader-entries
import { join } from 'node:path';
import { refuseInQuietWindow } from './lib/quiet-window';
import {
	buildEntriesShard,
	compilerStamp,
	ensureShaderModules,
	entryCacheDir,
	entryCacheFolder,
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
		// A cache of any source stamp, because a stamp change may leave the program identical and
		// its entries reusable. The entries are checked by their own keys and dependencies.
		console.log(`any-stamp-keys=shaders-${process.env.RUNNER_OS ?? process.platform}-`);
	} else if (process.argv.includes('--entry-folder')) {
		console.log(`folder=${entryCacheFolder(root)}`);
	} else if (shard !== undefined) {
		refuseInQuietWindow('The shader build');
		const { stored, folder } = buildEntriesShard(root, shard, out);
		console.log(
			`Shard ${shard} stored ${stored.length} new shader entries in ${folder}${out === undefined ? '.' : `, and copied them to ${out}.`}`,
		);
	} else if (out !== undefined) {
		throw new Error('--entries-out goes with --entries-shard');
	} else if (!ensureShaderModules(root))
		console.log(`The shader modules in ${MODULE_DIR} are up to date.`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
