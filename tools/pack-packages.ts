// Packs every public package as the publish job does, with `bun pm pack`, and checks each tarball:
// public with provenance, no `workspace:` versions, and every file that its manifest names or that
// its code loads by address (tools/lib/packages.ts). Run `bun run build` first, for the WebAssembly
// files. Run from the repository root:
//   bun tools/pack-packages.ts [--out <folder>]    the folder defaults to target/packages
import { join, resolve } from 'node:path';
import { DEFAULT_PACK_DIR, packPackages } from './lib/packages';

try {
	const args = process.argv.slice(2);
	const at = args.indexOf('--out');
	const out = at === -1 ? DEFAULT_PACK_DIR : args[at + 1];
	if (!out || args.length !== (at === -1 ? 0 : 2))
		throw new Error('usage: bun tools/pack-packages.ts [--out <folder>]');
	const root = join(import.meta.dirname, '..');
	for (const { name, version, tarball } of packPackages(root, resolve(root, out)))
		console.log(`${name}@${version}: ${tarball}`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
