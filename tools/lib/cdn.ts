// The CDN build: the files that a page loads from another origin with no bundler, in the layout of
// the engine package. A page imports `lib/index.js` from the CDN, and every file that the engine
// loads at run time keeps its place beside it: the workers' scripts, both WebAssembly builds, the
// vendor files and the generated shader modules.
//
// The npm package carries no built shader JavaScript: the Vite plugin supplies it to a project's
// build from the release asset (D-54). A page with no build step has no plugin, so this build
// writes the modules into `lib/generated` itself, from the shader set that this machine's build
// wrote. That is the one thing the package lacks and the reason this build exists.

import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CORE_FILES } from '../../packages/vite-plugin/src/index.ts';
import { walkFiles } from './files.ts';
import { buildPackageLibrary } from './packages.ts';

/** The engine package that the build copies. */
const ENGINE = 'packages/engine';

/** The folders of the engine package that a page loads files from. */
export const CDN_FOLDERS: readonly string[] = ['lib', 'dist/wasm', 'vendor'];

/** The default folder that the build writes. */
export const CDN_OUT = 'target/cdn';

/** The address of the engine's entry point inside the build, relative to its folder. */
export const CDN_ENTRY = 'lib/index.js';

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
 * A hash of the files that the build copies and of the engine's source files, so a second run in
 * the same checkout writes nothing. Sizes and times are enough: the compile rewrites every file
 * whose source changed.
 */
export function cdnSourcesHash(root: string): string {
	const hash = createHash('sha256');
	const add = (folder: string, relative: string) => {
		for (const path of walkFiles(join(root, folder), relative)) {
			const stat = statSync(join(root, folder, path));
			hash.update(`${folder}/${path}\0${stat.size}\0${stat.mtimeMs}\n`);
		}
	};
	add(ENGINE, 'src');
	add(ENGINE, 'dist/wasm');
	add(ENGINE, 'vendor');
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
function filesUnder(dir: string, relative = ''): CdnFile[] {
	const out: CdnFile[] = [];
	for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
		const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory()) out.push(...filesUnder(dir, path));
		else out.push({ path, bytes: statSync(join(dir, path)).size });
	}
	return out;
}

/**
 * Writes the CDN build into `out`: the engine package's built JavaScript and declarations, both
 * WebAssembly builds, the vendor files and the generated shader modules. Fails when this checkout
 * lacks a file that a page loads, with the step that writes it.
 */
export function buildCdn(root: string, out: string): CdnBuild {
	const sources = cdnSourcesHash(root);
	if (stampOf(out) === sources && existsSync(join(out, CDN_ENTRY))) {
		const files = filesUnder(out);
		const bytes = files.reduce((total, file) => total + file.bytes, 0);
		return { out, files, bytes, reused: true };
	}
	buildPackageLibrary(root, 'engine');
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
