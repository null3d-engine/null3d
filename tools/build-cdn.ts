// Writes the CDN build: the engine's files that a page loads from another origin with no bundler,
// in the layout of the engine package, with the foundation add-ons under `addons/`. A page imports
// `lib/index.js`, the production entry, or `lib-dev/index.js`, the development entry, as
// docs/getting-started/cdn.md shows. Run from the repository root, after `bun run build`:
//   bun tools/build-cdn.ts [--out <folder>] [--url-switches]
// `--url-switches` lets the production entry read the page's address switches, for benchmark pages
// only (D-305).
import { join, resolve } from 'node:path';
import { buildCdn, CDN_DEV_ENTRY, CDN_ENTRY, CDN_OUT, shownSize } from './lib/cdn';
import { refuseInQuietWindow } from './lib/quiet-window';

const root = join(import.meta.dirname, '..');
const USAGE = 'usage: bun tools/build-cdn.ts [--out <folder>] [--url-switches]';

async function main(): Promise<void> {
	refuseInQuietWindow('The CDN build');
	const args = process.argv.slice(2);
	const at = args.indexOf('--out');
	if (at >= 0 && args[at + 1] === undefined) throw new Error(USAGE);
	const unknown = args.filter(
		(arg, index) => arg !== '--out' && arg !== '--url-switches' && (at < 0 || index !== at + 1),
	);
	if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}; ${USAGE}`);
	const urlSwitches = args.includes('--url-switches');
	const out = at < 0 ? join(root, CDN_OUT) : resolve(process.cwd(), args[at + 1] as string);
	const build = await buildCdn(root, out, { urlSwitches });
	console.log(
		`null3D CDN build: ${build.files.length} files, ${shownSize(build.bytes)} in ${build.out}${build.reused ? ', already up to date' : ''}`,
	);
	console.log(
		`The production entry is ${CDN_ENTRY} inside that folder${urlSwitches ? ', and it reads the address switches: use this build for benchmark pages only' : ''}.`,
	);
	console.log(
		`The development entry is ${CDN_DEV_ENTRY}: ${build.devFiles} files of its own, ${shownSize(build.devBytes)}, and it shares the rest.`,
	);
}

try {
	await main();
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
