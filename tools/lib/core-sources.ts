// The stamp of the engine core's Rust sources, which ties a WebAssembly build to the checkout that
// it came from. The WebAssembly build writes the stamp into each generated module, and the dev
// server serves the engine's stamp module with the stamp of the sources on disk. Development builds
// compare the two when the core loads, so a core built before a merge or an edit fails with E1402
// and the advice to build again, before it can run with code that expects another core.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { inputFiles, inputHash } from './shader-modules';

/** The crate that the engine core is built from. */
const CORE_CRATE = 'crates/null3d-wasm';
/** The engine's module that holds the stamp, relative to the repository. */
export const STAMP_MODULE = 'packages/engine/src/shared/core-sources.ts';
/** Hex digits of the sources' hash that the stamp keeps: enough to tell builds apart. */
const STAMP_DIGITS = 16;

/** The stamp of the core's Rust sources in the checkout at `root`. */
export function coreSourcesStamp(root: string): string {
	return inputHash(root, CORE_CRATE).slice(0, STAMP_DIGITS);
}

/** A generated module's text with the stamp of the sources that its core was built from. */
export function stampGlue(text: string, stamp: string): string {
	return `${text}\nexport const coreSources = ${JSON.stringify(stamp)};\n`;
}

/** The stamp module's text with `stamp`. */
export const stampModule = (stamp: string) =>
	`export const CORE_SOURCES = ${JSON.stringify(stamp)};\n`;

/**
 * Gives the stamp of the sources at `root` as they are at each call. It hashes them again only
 * when a file's size or time changed, or a file came or went, so a call mostly costs a listing.
 */
export function currentStamp(root: string): () => string {
	let seen = '';
	let stamp = '';
	return () => {
		const files = inputFiles(root, CORE_CRATE);
		const signature = files
			.map((file) => {
				const { size, mtimeMs } = statSync(join(root, file));
				return `${file}\0${size}\0${mtimeMs}`;
			})
			.join('\n');
		if (signature !== seen) {
			stamp = coreSourcesStamp(root);
			seen = signature;
		}
		return stamp;
	};
}

/**
 * Serves the engine's stamp module with the stamp of the checkout at `root`, ahead of Vite's own
 * handlers and with no caching, so each page load gets the stamp of the sources as they are then.
 * The server's watcher plays no part: it ignores worktrees under `.claude/`.
 */
export function coreSourcesServer(root: string): Plugin {
	const stamp = currentStamp(root);
	return {
		name: 'null3d-core-sources',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split(/[?#]/)[0] ?? '';
				if (!path.endsWith(`/${STAMP_MODULE}`)) return next();
				res.setHeader('Content-Type', 'text/javascript');
				res.setHeader('Cache-Control', 'no-store');
				res.end(stampModule(stamp()));
			});
		},
	};
}
