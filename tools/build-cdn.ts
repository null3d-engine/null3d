// Writes the CDN build: the engine's files that a page loads from another origin with no bundler,
// in the layout of the engine package, with the foundation add-ons under `addons/`. A page imports
// `lib/index.js` from the CDN, as docs/getting-started/cdn.md shows. Run from the repository root,
// after `bun run build`:
//   bun tools/build-cdn.ts [--out <folder>]
import { join, resolve } from 'node:path';
import { buildCdn, CDN_ENTRY, CDN_OUT, shownSize } from './lib/cdn';

const root = join(import.meta.dirname, '..');

function main(): void {
	const args = process.argv.slice(2);
	const at = args.indexOf('--out');
	if (at >= 0 && args[at + 1] === undefined)
		throw new Error('usage: bun tools/build-cdn.ts [--out <folder>]');
	const out = at < 0 ? join(root, CDN_OUT) : resolve(process.cwd(), args[at + 1] as string);
	const build = buildCdn(root, out);
	console.log(
		`null3D CDN build: ${build.files.length} files, ${shownSize(build.bytes)} in ${build.out}${build.reused ? ', already up to date' : ''}`,
	);
	console.log(`The engine's entry point is ${CDN_ENTRY} inside that folder.`);
}

try {
	main();
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
