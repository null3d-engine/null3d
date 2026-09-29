// The size report's measuring and judging: raw and Brotli sizes, the growth check against the
// committed baseline, and the parts of the engine's JavaScript in a production build. Vite names
// each built file after a module and adds a content hash, so the report names each part by the
// engine module that its file holds, and a file loaded on demand by the part that loads it. The
// functions here do no file or process work: tools/build-wasm.ts builds, reads and prints.
import { brotliCompressSync, constants } from 'node:zlib';

/** A size in bytes, as the file is and after Brotli compression. */
export interface SizeEntry {
	raw: number;
	brotli: number;
}

/** Growth over the committed baseline that fails the size check. */
export const MAX_GROWTH = 0.02;

/** The raw size and the size after Brotli at its highest quality, as a server would send it. */
export function measure(bytes: Buffer): SizeEntry {
	const brotli = brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
	return { raw: bytes.length, brotli };
}

/** Files whose Brotli size grew more than the allowed margin over the baseline. */
export function growthProblems(
	current: Record<string, SizeEntry>,
	baseline: Record<string, SizeEntry>,
): string[] {
	const problems: string[] = [];
	for (const [file, size] of Object.entries(current)) {
		const before = baseline[file];
		if (!before) continue;
		const growth = (size.brotli - before.brotli) / before.brotli;
		if (growth > MAX_GROWTH) {
			problems.push(
				`${file} grew ${(growth * 100).toFixed(1)}% after Brotli (${before.brotli} to ${size.brotli} bytes). ` +
					'Explain the growth in the commit message and run bun tools/build-wasm.ts --update-size.',
			);
		}
	}
	return problems;
}

/** A built JavaScript file: its name, its text and the source files that its source map lists. */
export interface BuiltFile {
	/** The file's name in the build, with Vite's hash. */
	file: string;
	text: string;
	/** The files it was built from, relative to the repository. */
	sources: readonly string[];
}

/** Where the engine's TypeScript source lives, relative to the repository. */
export const ENGINE_SOURCE = 'packages/engine/src/';

export interface EnginePart {
	/** The part's name in the report and in the size baseline. */
	name: string;
	/** The engine module that marks the part's file, relative to the engine's source. */
	module: string;
	/** For a file that a thread loads on demand, the part that loads it. */
	loadedBy?: string;
}

/**
 * The parts of the engine's JavaScript. The renderer loads on demand on the page and in the sketch
 * worker, so a page downloads it only for the thread that draws. The sketch runner and the scene API
 * load on demand on the page, which runs the sketch only in single-threaded mode.
 */
export const ENGINE_PARTS: readonly EnginePart[] = [
	{ name: 'page.js', module: 'page/engine.ts' },
	{ name: 'page-renderer.js', module: 'render/draw.ts', loadedBy: 'page.js' },
	{ name: 'page-sketch-runner.js', module: 'sketch/runner.ts', loadedBy: 'page.js' },
	{ name: 'sketch-worker.js', module: 'workers/sketch-worker.ts' },
	{ name: 'sketch-worker-renderer.js', module: 'render/draw.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'render-worker.js', module: 'workers/render-worker.ts' },
	{ name: 'job-worker.js', module: 'workers/job-worker.ts' },
	{ name: 'probe-worker.js', module: 'workers/probe-worker.ts' },
];

export interface Download {
	/** The thread mode, as the engine test names it. */
	mode: string;
	/** The parts that a page loads in this mode. */
	parts: readonly string[];
}

/** The parts that a page downloads in each thread mode of the engine. */
export const DOWNLOADS: readonly Download[] = [
	{
		mode: 'pipelined',
		parts: ['page.js', 'probe-worker.js', 'sketch-worker.js', 'render-worker.js', 'job-worker.js'],
	},
	{
		mode: 'low latency',
		parts: [
			'page.js',
			'probe-worker.js',
			'sketch-worker.js',
			'sketch-worker-renderer.js',
			'job-worker.js',
		],
	},
	{
		mode: 'drawing on the main thread',
		parts: ['page.js', 'page-renderer.js', 'probe-worker.js', 'sketch-worker.js', 'job-worker.js'],
	},
	{
		mode: 'single-threaded',
		parts: ['page.js', 'page-sketch-runner.js', 'page-renderer.js', 'probe-worker.js'],
	},
];

/** True for a source file of a page that uses the engine, such as a test page. */
const isPageSource = (source: string) => /^(tests|bench|examples|templates)\//.test(source);

/**
 * The built file of each part of the engine, by the part's name, in the parts' order. A part that
 * loads on demand is absent when the build bundles its code into the part that loads it. It throws
 * when a part has no file or several, when a file holds engine code that no part names, and when a
 * part's file also holds a page's own code, whose bytes the report would count as the engine's.
 */
export function findEngineParts(
	files: readonly BuiltFile[],
	parts: readonly EnginePart[] = ENGINE_PARTS,
): Map<string, BuiltFile> {
	const found = new Map<string, BuiltFile>();
	const holds = (file: BuiltFile, module: string) => file.sources.includes(ENGINE_SOURCE + module);
	for (const part of parts) {
		if (part.loadedBy) continue;
		const matches = files.filter((file) => holds(file, part.module));
		if (matches.length !== 1)
			throw new Error(
				`${part.name}: expected one built file that holds ${part.module}, found ${matches.length}`,
			);
		found.set(part.name, matches[0]!);
	}
	for (const part of parts) {
		const loader = part.loadedBy ? found.get(part.loadedBy) : undefined;
		if (!loader) continue;
		const claimed = new Set(found.values());
		const file = files.find(
			(f) => !claimed.has(f) && holds(f, part.module) && loader.text.includes(f.file),
		);
		if (file) found.set(part.name, file);
	}
	const claimed = new Set(found.values());
	for (const file of files) {
		if (claimed.has(file) || !file.sources.some((s) => s.startsWith(ENGINE_SOURCE))) continue;
		throw new Error(
			`${file.file} holds engine code that the size report does not name: add its part to ENGINE_PARTS in tools/lib/size-report.ts`,
		);
	}
	for (const [name, file] of found) {
		const pageCode = file.sources.filter(isPageSource);
		if (pageCode.length > 0)
			throw new Error(
				`${name} (${file.file}) also holds a page's own code (${pageCode.join(', ')}), so its size is not the engine's`,
			);
	}
	return new Map(parts.flatMap(({ name }) => (found.has(name) ? [[name, found.get(name)!]] : [])));
}

/** The sum of the sizes of files that a server sends one by one, each compressed on its own. */
export function totalSize(sizes: Iterable<SizeEntry>): SizeEntry {
	const total = { raw: 0, brotli: 0 };
	for (const size of sizes) {
		total.raw += size.raw;
		total.brotli += size.brotli;
	}
	return total;
}

/**
 * What a page downloads in each thread mode: the total size of the parts it loads. A part that the
 * build lacks adds nothing.
 */
export function downloadSizes(
	sizes: ReadonlyMap<string, SizeEntry>,
	downloads: readonly Download[] = DOWNLOADS,
): { mode: string; size: SizeEntry }[] {
	return downloads.map(({ mode, parts }) => ({
		mode,
		size: totalSize(parts.flatMap((part) => sizes.get(part) ?? [])),
	}));
}
