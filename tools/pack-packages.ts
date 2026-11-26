// Packs every public package as the publish job does, with `bun pm pack`, and checks each tarball:
// public with provenance, no `workspace:` versions, each sibling package pinned at the package's
// own version, and every file that its manifest names or that its code loads by address
// (tools/lib/pack.ts). `--version` also requires every package to carry that release version.
// Run `bun run build` first, for the WebAssembly files. Run from the repository root:
//   bun tools/pack-packages.ts [--out <folder>] [--version <version>]
//                                   the folder defaults to target/packages
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PACK_DIR, packPackages } from './lib/pack';

try {
	const { values } = parseArgs({
		options: {
			out: { type: 'string', default: DEFAULT_PACK_DIR },
			version: { type: 'string' },
		},
	});
	const root = join(import.meta.dirname, '..');
	for (const { name, version, tarball } of await packPackages(
		root,
		resolve(root, values.out),
		values.version,
	))
		console.log(`${name}@${version}: ${tarball}`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
