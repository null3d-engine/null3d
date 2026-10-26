// The CDN build: the files that a page loads from another origin with no bundler, in the layout of
// the engine package. A page imports `lib/index.js` from the CDN, and every file that the engine
// loads at run time keeps its place beside it: the workers' scripts, both WebAssembly builds, the
// vendor files and the generated shader modules.
//
// The npm package carries no built shader JavaScript: the Vite plugin supplies it to a project's
// build from the release asset (D-54). A page with no build step has no plugin, so this build
// writes the modules into `lib/generated` itself, from the shader set that this machine's build
// wrote. That is the one thing the package lacks and the reason this build exists.
//
// The build also carries each add-on under `addons/<name>/`, in the layout of its own package, so
// a page with no build step loads an add-on the same way it loads the engine. An add-on's built
// code imports the engine by its package name, which no page and no worker resolves without a
// bundler, so the copy imports the engine beside it by a relative address instead.

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join, posix } from 'node:path';
import { CORE_FILES, NOTICES_FILE } from '../../packages/vite-plugin/src/index.ts';
import { refuseStaleCore } from './core-sources.ts';
import { walkFiles } from './files.ts';
import { buildPackageLibraries } from './packages.ts';

/** The engine package that the build copies. */
const ENGINE = 'packages/engine';

/** The folders of the engine package that a page loads files from. */
export const CDN_FOLDERS: readonly string[] = ['lib', 'dist/wasm', 'vendor'];

/** The default folder that the build writes. */
export const CDN_OUT = 'target/cdn';

/** The address of the engine's entry point inside the build, relative to its folder. */
export const CDN_ENTRY = 'lib/index.js';

/**
 * The add-ons that the build carries, each under `addons/<name>/`: every public package that builds
 * on the engine. A unit test fails when a package of the workspace is missing here, as vegetation
 * was until 25 October 2026, when the owner ruled that the build carries it.
 */
export const CDN_ADDONS: readonly string[] = [
	'controls',
	'geometry',
	'impostors',
	'particles',
	'splats',
	'terrain',
	'three-compat',
	'vegetation',
	'water',
	'wind',
];

/** The engine files that an add-on's code imports by package name, and their place in the build. */
const ENGINE_ENTRIES: Readonly<Record<string, string>> = {
	'@null3d/engine': CDN_ENTRY,
	'@null3d/engine/stats': 'lib/stats.js',
};

/**
 * The file beside the build folder that names the engine files it was made from, so a run whose
 * engine sources have not changed copies nothing. It stays outside the folder, which a page's host
 * publishes as it is.
 */
const stampPath = (out: string) => `${out}.stamp.json`;

/** A file that the build copied, with its size in bytes. */
export interface CdnFile {
	readonly path: string;
	readonly bytes: number;
}

/** What a CDN build wrote. */
export interface CdnBuild {
	/** The folder that holds the build. */
	readonly out: string;
	readonly files: readonly CdnFile[];
	readonly bytes: number;
	/** True when the folder already held this build and nothing was written. */
	readonly reused: boolean;
}

/**
 * A hash of the files that the build copies and of the sources that it compiles, so a second run
 * in the same checkout writes nothing. Sizes and times are enough: the compile rewrites every file
 * whose source changed.
 */
export function cdnSourcesHash(root: string): string {
	const hash = createHash('sha256');
	const addFile = (path: string) => {
		const file = join(root, path);
		if (!existsSync(file)) return;
		const stat = statSync(file);
		hash.update(`${path}\0${stat.size}\0${stat.mtimeMs}\n`);
	};
	const addFolder = (folder: string) => {
		for (const path of walkFiles(root, folder)) addFile(path);
	};
	addFolder(`${ENGINE}/src`);
	addFolder(`${ENGINE}/dist/wasm`);
	addFolder(`${ENGINE}/vendor`);
	addFile(`${ENGINE}/THIRD-PARTY-NOTICES.txt`);
	for (const name of CDN_ADDONS) {
		addFolder(`packages/${name}/src`);
		addFile(`packages/${name}/package.json`);
		const notices = `packages/${name}/THIRD-PARTY-NOTICES.txt`;
		if (existsSync(join(root, notices))) addFile(notices);
	}
	return hash.digest('hex');
}

/** The hash of the build that a folder holds, or null when it holds none. */
function stampOf(out: string): string | null {
	try {
		return (
			(JSON.parse(readFileSync(stampPath(out), 'utf8')) as { sources?: string }).sources ?? null
		);
	} catch {
		return null;
	}
}

/** The engine files that a page loads but that this checkout has not built, by their path. */
export function missingCdnSources(root: string): string[] {
	const engine = join(root, ENGINE);
	const missing: string[] = [];
	for (const file of CORE_FILES)
		if (!existsSync(join(engine, 'dist/wasm', file))) missing.push(`dist/wasm/${file}`);
	// The entry point and the shader modules are what the package build writes, and what a browser
	// cannot load without.
	for (const file of [`${CDN_ENTRY}`, 'lib/generated/shaders.js'])
		if (!existsSync(join(engine, file))) missing.push(file);
	return missing;
}

/** Every file under `dir`, relative to it, with its size. */
function filesUnder(dir: string): CdnFile[] {
	return walkFiles(dir, '').map((path) => ({ path, bytes: statSync(join(dir, path)).size }));
}

/**
 * The text of a built add-on file with its engine imports made relative, so a page and its workers
 * read the engine from the build. A page's import map does not reach a worker, and an add-on's
 * code runs in the sketch and job workers, so its package name would not resolve there.
 */
export function engineImportsMadeRelative(text: string, fileInBuild: string): string {
	return text.replace(
		/(['"])(@null3d\/engine(?:\/[^'"]*)?)\1/g,
		(match: string, quote: string, name: string) => {
			const target = ENGINE_ENTRIES[name];
			if (target === undefined) return match;
			return `${quote}${posix.relative(posix.dirname(fileInBuild), target)}${quote}`;
		},
	);
}

/** Copies an add-on's built package into the build, with the engine beside it. */
function copyAddon(root: string, out: string, name: string): void {
	const from = join(root, 'packages', name);
	const to = join(out, 'addons', name);
	cpSync(join(from, 'lib'), join(to, 'lib'), { recursive: true });
	for (const path of walkFiles(to, ''))
		if (path.endsWith('.js')) {
			const file = join(to, path);
			const before = readFileSync(file, 'utf8');
			const after = engineImportsMadeRelative(before, `addons/${name}/${path}`);
			if (after !== before) writeFileSync(file, after);
		}
	for (const file of ['LICENSE-MIT', 'LICENSE-APACHE', 'THIRD-PARTY-NOTICES.txt']) {
		const source = existsSync(join(from, file)) ? join(from, file) : join(root, file);
		if (existsSync(source)) copyFileSync(source, join(to, file));
	}
}

/**
 * Writes the notices of every package in the build beside it, the engine's first and the add-ons'
 * after it, as a production build writes them. A host that publishes the build redistributes the
 * code, and each license asks the notice to travel with it.
 */
function writeNotices(root: string, out: string): void {
	const texts = ['engine', ...CDN_ADDONS]
		.map((name) => join(root, 'packages', name, 'THIRD-PARTY-NOTICES.txt'))
		.filter((file) => existsSync(file))
		.map((file) => readFileSync(file, 'utf8').trimEnd());
	if (texts.length > 0) writeFileSync(join(out, NOTICES_FILE), `${texts.join('\n\n')}\n`);
}

/**
 * Writes the CDN build into `out`: the engine package's built JavaScript and declarations, both
 * WebAssembly builds, the vendor files and the generated shader modules; the add-ons beside the
 * engine; and the notices of every package in it. Fails when this checkout lacks a file that a
 * page loads, with the step that writes it.
 */
export async function buildCdn(root: string, out: string): Promise<CdnBuild> {
	refuseStaleCore(root);
	const sources = cdnSourcesHash(root);
	if (stampOf(out) === sources && existsSync(join(out, CDN_ENTRY))) {
		const files = filesUnder(out);
		const bytes = files.reduce((total, file) => total + file.bytes, 0);
		return { out, files, bytes, reused: true };
	}
	await buildPackageLibraries(root, ['engine', ...CDN_ADDONS], { shaderJs: true });
	const missing = missingCdnSources(root);
	if (missing.length > 0)
		throw new Error(
			`the engine lacks ${missing.join(', ')}. Run bun run build first, which builds the WebAssembly core and the shader modules.`,
		);
	const engine = join(root, ENGINE);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	for (const folder of CDN_FOLDERS)
		cpSync(join(engine, folder), join(out, folder), { recursive: true });
	for (const name of CDN_ADDONS) copyAddon(root, out, name);
	writeNotices(root, out);
	writeFileSync(stampPath(out), `${JSON.stringify({ sources })}\n`);
	const files = filesUnder(out);
	const bytes = files.reduce((total, file) => total + file.bytes, 0);
	return { out, files, bytes, reused: false };
}

/** A size as a message shows it, in the unit that keeps it short. */
export function shownSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
