// The CDN build: the files that a page loads from another origin with no bundler, in the layout of
// the engine package. Every file that the engine loads at run time keeps its place beside the
// entry point: the workers' scripts, both WebAssembly builds, the vendor files and the generated
// shader modules.
//
// The npm package carries no built shader JavaScript: the Vite plugin supplies it to a project's
// build from the release asset (D-54). A page with no build step has no plugin, so this build
// writes the modules into `lib/generated` itself, from the shader set that this machine's build
// wrote. That is the one thing the package lacks and the reason this build exists.
//
// The build also carries each add-on under `addons/<name>/`, in the layout of its own package, so
// a page with no build step loads an add-on the same way it loads the engine. An add-on's built
// code imports the engine and other add-ons by package name, which no page and no worker resolves
// without a bundler, so the copy imports them from the build by relative addresses instead.
//
// No bundler defines the engine's build constants for such a page, so the build defines them
// itself, in two entries (D-305). `lib/index.js` is a production build: the development checks
// never run and the page's address switches do nothing, as in a production build with the Vite
// plugin. `lib-dev/index.js` is a development build, with the checks and the switches on. The
// development entry holds a copy of only the code files that differ between the two: each file
// that names a build constant, and each file that reaches one through the addresses that it
// imports or loads. Every other file, the shader modules among them, stays in one place for both.

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
import { dirname, join, posix } from 'node:path';
import { CORE_FILES, NOTICES_FILE } from '../../packages/vite-plugin/src/index.ts';
import { refuseStaleCore } from './core-sources.ts';
import { walkFiles } from './files.ts';
import { buildPackageLibraries, PACKAGES } from './packages.ts';

/** The engine package that the build copies. */
const ENGINE = 'packages/engine';

/**
 * The folders of the engine package that a page loads files from: the level planner that the
 * engine shares with the asset tool sits in `levels`.
 */
export const CDN_FOLDERS: readonly string[] = ['lib', 'dist/wasm', 'vendor', 'levels'];

/** The default folder that the build writes. */
export const CDN_OUT = 'target/cdn';

/** The address of the production entry point inside the build, relative to its folder. */
export const CDN_ENTRY = 'lib/index.js';

/**
 * The folder beside each package's `lib` that holds the development entry's copies. It sits at the
 * same depth as `lib`, so an address that leaves the folder, such as the WebAssembly's, stays the
 * same in both entries.
 */
export const DEV_FOLDER = 'lib-dev';

/** The address of the development entry point inside the build, relative to its folder. */
export const CDN_DEV_ENTRY = `${DEV_FOLDER}/index.js`;

/**
 * The constants that a bundler defines in the engine's code, with their value in each entry. The
 * production entry ignores the page's address switches unless the build is made for benchmark
 * pages, as the Vite plugin's `urlSwitches` option makes a production build that reads them.
 */
const BUILD_CONSTANTS = ['__NULL3D_DEV__', '__NULL3D_URL_SWITCHES__'] as const;

/** The value of each build constant in one entry. */
export type ConstantValues = Readonly<Record<(typeof BUILD_CONSTANTS)[number], boolean>>;

/** The bytes that every build constant's name starts with, to find the files that name one. */
const CONSTANT_MARK = Buffer.from('__NULL3D_');

/**
 * The add-ons that the build carries, each under `addons/<name>/`: every public package that builds
 * on the engine, vegetation among them by the owner's ruling. A unit test fails when a package of
 * the workspace is missing here.
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
	/** The files of the development entry's own copies, and their bytes. */
	readonly devFiles: number;
	readonly devBytes: number;
	/** True when the folder already held this build and nothing was written. */
	readonly reused: boolean;
}

/** How to make a CDN build. */
export interface CdnOptions {
	/**
	 * Lets the production entry read the page's address switches, for benchmark pages that time a
	 * production build with switches. A page that ships never takes this build.
	 */
	readonly urlSwitches?: boolean;
}

/**
 * A hash of the files that the build copies and of the sources that it compiles, so a second run
 * in the same checkout writes nothing. Sizes and times are enough: the compile rewrites every file
 * whose source changed. The build's own code counts too, since it decides the layout.
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
	addFile('tools/lib/cdn.ts');
	addFolder(`${ENGINE}/src`);
	addFolder(`${ENGINE}/dist/wasm`);
	addFolder(`${ENGINE}/vendor`);
	addFolder(`${ENGINE}/levels`);
	addFile(`${ENGINE}/THIRD-PARTY-NOTICES.txt`);
	for (const name of CDN_ADDONS) {
		addFolder(`packages/${name}/src`);
		// The files that an add-on loads by address, such as the terrain builder's WebAssembly.
		const dist = `packages/${name}/dist`;
		if (existsSync(join(root, dist))) addFolder(dist);
		addFile(`packages/${name}/package.json`);
		for (const wasm of PACKAGES[name]?.wasm ?? []) addFile(`packages/${name}/${wasm}`);
		const notices = `packages/${name}/THIRD-PARTY-NOTICES.txt`;
		if (existsSync(join(root, notices))) addFile(notices);
	}
	return hash.digest('hex');
}

/** What a build folder's stamp records. */
interface Stamp {
	readonly sources?: string;
	readonly urlSwitches?: boolean;
}

/** The stamp of the build that a folder holds, or null when it holds none. */
function stampOf(out: string): Stamp | null {
	try {
		return JSON.parse(readFileSync(stampPath(out), 'utf8')) as Stamp;
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
	// An add-on's WebAssembly comes from the engine's build, and its code cannot start without it.
	for (const name of CDN_ADDONS)
		for (const wasm of PACKAGES[name]?.wasm ?? [])
			if (!existsSync(join(root, 'packages', name, wasm))) missing.push(`packages/${name}/${wasm}`);
	return missing;
}

/** Every file under `dir`, relative to it, with its size. */
function filesUnder(dir: string): CdnFile[] {
	return walkFiles(dir, '').map((path) => ({ path, bytes: statSync(join(dir, path)).size }));
}

/**
 * The place in the build of each file that a package exports, by the name that code imports it
 * with: the engine at the build's root and each add-on under `addons/<name>/`, read from the
 * `exports` of each package's manifest.
 */
export function packageEntries(root: string): Record<string, string> {
	const entries: Record<string, string> = {};
	for (const name of ['engine', ...CDN_ADDONS]) {
		const manifest = JSON.parse(
			readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'),
		) as { exports?: Record<string, string | { default?: string }> };
		const folder = name === 'engine' ? '' : `addons/${name}/`;
		for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
			const file = typeof target === 'string' ? target : target.default;
			if (file === undefined || !file.endsWith('.js')) continue;
			entries[posix.join(`@null3d/${name}`, subpath)] = `${folder}${posix.normalize(file)}`;
		}
	}
	return entries;
}

/**
 * The text of a built add-on file with its package imports made relative, so a page and its
 * workers read the engine and the other add-ons from the build. A page's import map does not reach
 * a worker, and an add-on's code runs in the sketch and job workers, so a package name would not
 * resolve there. A name that the build does not carry stays as it is.
 */
export function packageImportsMadeRelative(
	text: string,
	fileInBuild: string,
	entries: Readonly<Record<string, string>>,
): string {
	return text.replace(
		/(['"])(@null3d\/[a-z0-9-]+(?:\/[^'"\s]*)?)\1/g,
		(match: string, quote: string, name: string) => {
			const target = entries[name];
			if (target === undefined) return match;
			return `${quote}${relativeAddress(fileInBuild, target)}${quote}`;
		},
	);
}

/** The relative address from one file of the build to another, as a module names it. */
function relativeAddress(from: string, to: string): string {
	const address = posix.relative(posix.dirname(from), to);
	return address.startsWith('.') ? address : `./${address}`;
}

/** A relative address in quotes, as an import, a dynamic import or `new URL(…)` names a file. */
const RELATIVE_ADDRESS = /(['"])(\.\.?\/[^'"\s`$?#]*)\1/g;

/**
 * The text with each build constant replaced by its value, as a bundler's define replaces it. Code
 * that reads `typeof` a constant then reads the type of the value.
 */
export function constantsDefined(text: string, values: ConstantValues): string {
	return text.replace(
		/\b(__NULL3D_DEV__|__NULL3D_URL_SWITCHES__)\b/g,
		(name) => `${values[name as keyof ConstantValues]}`,
	);
}

/** True for a file of code that a page or a worker loads as a module. */
const isCode = (path: string) => path.endsWith('.js') || path.endsWith('.mjs');

/**
 * The folder of code that holds a file of the build: `lib` for the engine's and `addons/<name>/lib`
 * for an add-on's, or null for a file outside them, such as the WebAssembly and the vendor files.
 */
function codeFolderOf(path: string): string | null {
	if (path.startsWith('lib/')) return 'lib';
	const addon = /^addons\/[^/]+\/lib\//.exec(path);
	return addon === null ? null : addon[0].slice(0, -1);
}

/** The place of a code file's copy in the development entry. */
export function devPathOf(path: string): string {
	const folder = codeFolderOf(path);
	if (folder === null) throw new Error(`${path} is not code of the engine or an add-on`);
	return `${folder.slice(0, -'lib'.length)}${DEV_FOLDER}${path.slice(folder.length)}`;
}

/** The code files of a build folder that name a build constant, by their path in the build. */
export function filesNamingConstants(out: string): string[] {
	return walkFiles(out, '', isCode).filter((path) =>
		readFileSync(join(out, path)).includes(CONSTANT_MARK),
	);
}

/** How a build's code files depend on the build constants. */
interface CodeGraph {
	/** The code files that name a build constant. */
	readonly naming: readonly string[];
	/** Each code file that another code file names by a relative address, with the files naming it. */
	readonly namedBy: ReadonlyMap<string, readonly string[]>;
}

/** Reads every code file of the build once, for the files that name a constant and the addresses. */
function readCodeGraph(out: string, files: readonly string[]): CodeGraph {
	const known = new Set(files);
	const naming: string[] = [];
	const namedBy = new Map<string, string[]>();
	for (const path of files) {
		const bytes = readFileSync(join(out, path));
		if (bytes.includes(CONSTANT_MARK)) naming.push(path);
		for (const [, , address] of bytes.toString('utf8').matchAll(RELATIVE_ADDRESS)) {
			const target = posix.join(posix.dirname(path), address as string);
			if (!known.has(target)) continue;
			const list = namedBy.get(target);
			if (list === undefined) namedBy.set(target, [path]);
			else if (list[list.length - 1] !== path) list.push(path);
		}
	}
	return { naming, namedBy };
}

/**
 * The code files that the development entry holds a copy of: each file that names a build
 * constant, each public entry file, so that every address a page imports exists in both entries,
 * and each file that names one of those by a relative address, to any depth. Every other file runs
 * the same in both entries, so they share it.
 */
export function differingFiles(graph: CodeGraph, publicEntries: Iterable<string>): Set<string> {
	const differ = new Set([...graph.naming, ...publicEntries]);
	const queue = [...differ];
	for (let file = queue.pop(); file !== undefined; file = queue.pop())
		for (const by of graph.namedBy.get(file) ?? [])
			if (!differ.has(by)) {
				differ.add(by);
				queue.push(by);
			}
	return differ;
}

/**
 * The text of a code file's copy in the development entry: each relative address names the copy of
 * a file that differs, and the shared file otherwise.
 */
export function devText(
	text: string,
	path: string,
	differ: ReadonlySet<string>,
	isFile: (path: string) => boolean,
): string {
	const devPath = devPathOf(path);
	return text.replace(RELATIVE_ADDRESS, (match: string, quote: string, address: string) => {
		const target = posix.join(posix.dirname(path), address);
		if (!isFile(target)) return match;
		const placed = differ.has(target) ? devPathOf(target) : target;
		return `${quote}${relativeAddress(devPath, placed)}${quote}`;
	});
}

/**
 * Makes the two entries in a build folder whose code names the build constants undefined. Each
 * file that differs gets the production values in place and a copy with the development values in
 * the development entry. `publicEntries` are the files that pages import, by their path in the
 * build. Fails when a file outside the folders of code names a constant, since no entry could hold
 * its two forms, and when a written file still names one.
 */
export function splitEntries(
	out: string,
	production: ConstantValues,
	publicEntries: Iterable<string>,
): { devFiles: number; devBytes: number } {
	const all = walkFiles(out, '', isCode);
	const outside = all.filter((path) => codeFolderOf(path) === null);
	const naming = outside.filter((path) => readFileSync(join(out, path)).includes(CONSTANT_MARK));
	if (naming.length > 0)
		throw new Error(
			`${naming.join(', ')} name a build constant outside the engine's and the add-ons' code, so no entry can define it`,
		);
	const graph = readCodeGraph(
		out,
		all.filter((path) => codeFolderOf(path) !== null),
	);
	const differ = differingFiles(
		graph,
		// A public entry outside the folders of code, such as the level planner that the asset tool
		// shares, names no build constant, so both entries share it.
		[...publicEntries].filter((path) => existsSync(join(out, path)) && codeFolderOf(path) !== null),
	);
	const isFile = (path: string) =>
		statSync(join(out, path), { throwIfNoEntry: false })?.isFile() === true;
	const development: ConstantValues = { __NULL3D_DEV__: true, __NULL3D_URL_SWITCHES__: true };
	let devBytes = 0;
	const written: string[] = [];
	for (const path of [...differ].sort()) {
		const text = readFileSync(join(out, path), 'utf8');
		const devPath = devPathOf(path);
		const dev = constantsDefined(devText(text, path, differ, isFile), development);
		mkdirSync(dirname(join(out, devPath)), { recursive: true });
		writeFileSync(join(out, devPath), dev);
		devBytes += Buffer.byteLength(dev);
		written.push(devPath);
		const shipped = constantsDefined(text, production);
		if (shipped !== text) {
			writeFileSync(join(out, path), shipped);
			written.push(path);
		}
	}
	const left = written.filter((path) => readFileSync(join(out, path)).includes(CONSTANT_MARK));
	if (left.length > 0)
		throw new Error(`${left.join(', ')} still name a build constant after the build defined them`);
	return { devFiles: differ.size, devBytes };
}

/** Copies an add-on's built package into the build, with the packages it imports beside it. */
function copyAddon(
	root: string,
	out: string,
	name: string,
	entries: Readonly<Record<string, string>>,
): void {
	const from = join(root, 'packages', name);
	const to = join(out, 'addons', name);
	cpSync(join(from, 'lib'), join(to, 'lib'), { recursive: true });
	const dist = join(from, 'dist');
	if (existsSync(dist)) cpSync(dist, join(to, 'dist'), { recursive: true });
	// The WebAssembly that a task loads sits beside the code, at the address that the code names.
	for (const wasm of PACKAGES[name]?.wasm ?? []) {
		const file = join(from, wasm);
		if (existsSync(file)) {
			mkdirSync(dirname(join(to, wasm)), { recursive: true });
			copyFileSync(file, join(to, wasm));
		}
	}
	for (const path of walkFiles(to, ''))
		if (path.endsWith('.js')) {
			const file = join(to, path);
			const before = readFileSync(file, 'utf8');
			const after = packageImportsMadeRelative(before, `addons/${name}/${path}`, entries);
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

/** What a build folder holds, with the sizes of the development entry's own copies. */
function described(out: string, reused: boolean): CdnBuild {
	const files = filesUnder(out);
	const bytes = files.reduce((total, file) => total + file.bytes, 0);
	const dev = files.filter((file) => file.path.split('/').includes(DEV_FOLDER));
	const devBytes = dev.reduce((total, file) => total + file.bytes, 0);
	return { out, files, bytes, devFiles: dev.length, devBytes, reused };
}

/**
 * Writes the CDN build into `out`: the engine package's built JavaScript and declarations, both
 * WebAssembly builds, the vendor files and the generated shader modules; the add-ons beside the
 * engine; the development entry's copies; and the notices of every package in it. Fails when this
 * checkout lacks a file that a page loads, with the step that writes it.
 */
export async function buildCdn(
	root: string,
	out: string,
	options: CdnOptions = {},
): Promise<CdnBuild> {
	refuseStaleCore(root);
	const sources = cdnSourcesHash(root);
	const urlSwitches = options.urlSwitches === true;
	const stamp = stampOf(out);
	if (
		stamp?.sources === sources &&
		(stamp.urlSwitches ?? false) === urlSwitches &&
		existsSync(join(out, CDN_ENTRY)) &&
		existsSync(join(out, CDN_DEV_ENTRY))
	)
		return described(out, true);
	await buildPackageLibraries(root, ['engine', ...CDN_ADDONS], { shaderJs: true });
	const missing = missingCdnSources(root);
	if (missing.length > 0)
		throw new Error(
			`the engine lacks ${missing.join(', ')}. Run bun run build first, which builds the WebAssembly core and the shader modules.`,
		);
	const engine = join(root, ENGINE);
	rmSync(stampPath(out), { force: true });
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	for (const folder of CDN_FOLDERS)
		cpSync(join(engine, folder), join(out, folder), { recursive: true });
	const entries = packageEntries(root);
	for (const name of CDN_ADDONS) copyAddon(root, out, name, entries);
	splitEntries(
		out,
		{ __NULL3D_DEV__: false, __NULL3D_URL_SWITCHES__: urlSwitches },
		Object.values(entries),
	);
	writeNotices(root, out);
	writeFileSync(stampPath(out), `${JSON.stringify({ sources, urlSwitches })}\n`);
	return described(out, false);
}

/** A size as a message shows it, in the unit that keeps it short. */
export function shownSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
