// The stamp of the engine core's Rust sources, which ties a WebAssembly build to the checkout that
// it came from. The WebAssembly build writes the stamp into each generated module, and the dev
// server serves the engine's stamp module with the stamps that the sources on disk accept.
// Development builds compare the two when the core loads, so a core built before a merge or an edit
// fails with E1402 and the advice to build again, before it can run with code that expects another
// core. The stamp digests the input files themselves, so it names what the core was built from and
// not the cache key of a build that reads them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { inputFiles, inputHash } from './shader-modules';

/** The crate that the engine core is built from. */
const CORE_CRATE = 'crates/null3d-wasm';
/** The engine's module that holds the stamp, relative to the repository. */
export const STAMP_MODULE = 'packages/engine/src/shared/core-sources.ts';
/** Hex digits of the sources' hash that the stamp keeps: enough to tell builds apart. */
const STAMP_DIGITS = 16;
/** The two builds of the engine core, by the name that their folders give them. */
const CORE_BUILDS = ['single', 'threaded'] as const;

/**
 * A digest of the given files' paths and bytes, in order. This module owns the digest, so a cache
 * key that changes elsewhere cannot change which sources a stamp names.
 */
function sourceDigest(root: string, files: readonly string[]): string {
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(`${file}\0`);
		hash.update(readFileSync(join(root, file)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** The stamp of the core's Rust sources in the checkout at `root`. */
export function coreSourcesStamp(root: string): string {
	return sourceDigest(root, inputFiles(root, CORE_CRATE)).slice(0, STAMP_DIGITS);
}

/**
 * The stamp of these sources that the shared input hash gives, with the lock narrowed to the
 * core's dependency closure. Cores built while that hash produced the stamp are cores of the
 * same sources, so the guard accepts it during the transition.
 *
 * Remove this function, and its entry in `acceptedSourcesStamps`, once this change has landed and
 * every machine that built an earlier core has run `bun run build` once, or at the release after.
 * The end state makes the current stamp hash the core's own lock closure and deletes this
 * function. The whole-file digest stays while the transition lasts, because it is what matches
 * cores built before the lock narrowing.
 */
function earlierSourcesStamp(root: string): string {
	return inputHash(root, CORE_CRATE).slice(0, STAMP_DIGITS);
}

/**
 * The stamps that a core of the sources at `root` may carry: the current stamp, and while the
 * transition lasts the stamp of the earlier build key. The set holds one stamp when the two agree,
 * as they do when the lock cannot resolve the core's closure and both read the whole file.
 */
export function acceptedSourcesStamps(root: string): string[] {
	const current = coreSourcesStamp(root);
	const earlier = earlierSourcesStamp(root);
	return earlier === current ? [current] : [current, earlier];
}

/**
 * The message that names the core build in `root` which came from other Rust sources than the
 * checkout holds, or null when each one matches. A production build ships the core's bytes as they
 * are and drops the check that a development build makes at load time. A core from before a change
 * then runs beside code that expects another core, and the page fails with a GPU error of its own.
 * A page build refuses that state with this message, so the fault names itself at build time.
 */
export function coreFromOtherSources(root: string): string | null {
	// A project that installs the engine package holds no core crate, so its core needs no check.
	if (!existsSync(join(root, CORE_CRATE, 'Cargo.toml'))) return null;
	const sources = acceptedSourcesStamps(root);
	for (const build of CORE_BUILDS) {
		const glue = join(root, 'packages/engine/dist/wasm', build, 'null3d.js');
		const stamp = existsSync(glue)
			? /export const coreSources = "([0-9a-f]+)";/.exec(readFileSync(glue, 'utf8'))?.[1]
			: undefined;
		if (stamp === undefined || !sources.includes(stamp))
			return `the ${build} engine core in ${root} was built from other Rust sources than this checkout holds. Run bun run build.`;
	}
	return null;
}

/** Stops a build with the message above when a core in `root` came from other sources. */
export function refuseStaleCore(root: string): void {
	const stale = coreFromOtherSources(root);
	if (stale) throw new Error(stale);
}

/** A generated module's text with the stamp of the sources that its core was built from. */
export function stampGlue(text: string, stamp: string): string {
	return `${text}\nexport const coreSources = ${JSON.stringify(stamp)};\n`;
}

/** The stamp module's text with the stamps that a core of these sources may carry. */
export const stampModule = (stamps: readonly string[]) =>
	`export const CORE_SOURCES = ${JSON.stringify(stamps)};\n`;

/**
 * Gives the stamps of the sources at `root` as they are at each call. It hashes them again only
 * when a file's size or time changed, or a file came or went, so a call mostly costs a listing.
 */
export function currentStamps(root: string): () => string[] {
	let seen = '';
	let stamps: string[] = [];
	return () => {
		const files = inputFiles(root, CORE_CRATE);
		const signature = files
			.map((file) => {
				const { size, mtimeMs } = statSync(join(root, file));
				return `${file}\0${size}\0${mtimeMs}`;
			})
			.join('\n');
		if (signature !== seen) {
			stamps = acceptedSourcesStamps(root);
			seen = signature;
		}
		return stamps;
	};
}

/**
 * Serves the engine's stamp module with the stamps of the checkout at `root`, ahead of Vite's own
 * handlers and with no caching, so each page load gets the stamps of the sources as they are then.
 * The server's watcher plays no part: it ignores worktrees under `.claude/`.
 */
export function coreSourcesServer(root: string): Plugin {
	const stamps = currentStamps(root);
	return {
		name: 'null3d-core-sources',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split(/[?#]/)[0] ?? '';
				if (!path.endsWith(`/${STAMP_MODULE}`)) return next();
				res.setHeader('Content-Type', 'text/javascript');
				res.setHeader('Cache-Control', 'no-store');
				res.end(stampModule(stamps()));
			});
		},
	};
}
