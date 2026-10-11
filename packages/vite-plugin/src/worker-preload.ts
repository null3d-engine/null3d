// Starts the downloads of the files that an on-demand file of a worker imports, together with the
// file. Vite does this on the page, where it loads such a file through its preload helper, and not
// in a worker. In a worker, the browser asks for a file's imports only once the file has arrived,
// one round trip later. The engine's drawing threads load their GPU path's renderers on demand, and
// the bundler puts the code that both paths share into a file of its own that each path's file
// imports. Without this plugin, a worker that draws would ask for that file a round trip after its
// path's file, at the start, while the core downloads.
import { posix } from 'node:path';
import MagicString from 'magic-string';
import type { Plugin, Rollup } from 'vite';

/** An import on demand of another file of the bundle, as the bundler writes it: `import("./x.js")`. */
const DYNAMIC_IMPORT = /\bimport\(\s*(["'`])(\.{1,2}\/[^"'`]+)\1\s*\)/g;

/** The chunks that a chunk imports, directly or through others, with the chunk itself. */
export function staticImports(
	fileName: string,
	chunks: Readonly<Record<string, { imports: readonly string[] }>>,
): Set<string> {
	const seen = new Set([fileName]);
	for (const name of seen) for (const imported of chunks[name]?.imports ?? []) seen.add(imported);
	return seen;
}

/** The address of `to` from the folder of `from`, as an import names it. */
function importAddress(from: string, to: string): string {
	const path = posix.relative(posix.dirname(from), to);
	return path.startsWith('.') ? path : `./${path}`;
}

/**
 * Rewrites each import on demand in a chunk's code so that it also starts the downloads of the
 * files that the imported file needs and the chunk has not loaded yet. Each of those downloads
 * ignores a failure, which the imported file's own import reports. Returns true when an import
 * changed.
 */
export function preloadImports(
	code: MagicString,
	fileName: string,
	chunks: Readonly<Record<string, { imports: readonly string[] }>>,
): boolean {
	const loaded = staticImports(fileName, chunks);
	let changed = false;
	for (const match of code.original.matchAll(DYNAMIC_IMPORT)) {
		const [text, quote, address] = match as unknown as [string, string, string];
		const target = posix.join(posix.dirname(fileName), address);
		if (!chunks[target]) continue;
		const missing = [...staticImports(target, chunks)].filter(
			(name) => name !== target && !loaded.has(name),
		);
		if (missing.length === 0) continue;
		const starts = missing
			.map((name) => `import(${quote}${importAddress(fileName, name)}${quote}).catch(()=>{}),`)
			.join('');
		code.prependLeft(match.index, `(${starts}`);
		code.appendRight(match.index + text.length, ')');
		changed = true;
	}
	return changed;
}

/** The plugin for each worker build. */
export function workerPreloadPlugin(): Plugin {
	return {
		name: 'null3d:worker-preload',
		renderChunk(code, chunk, _options, meta) {
			const chunks = (meta as { chunks?: Record<string, Rollup.RenderedChunk> }).chunks;
			if (!chunks || chunk.dynamicImports.length === 0) return null;
			const edited = new MagicString(code);
			if (!preloadImports(edited, chunk.fileName, chunks)) return null;
			return { code: edited.toString(), map: edited.generateMap({ hires: true }) };
		},
	};
}
