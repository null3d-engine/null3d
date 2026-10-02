// The size report's measuring: raw and Brotli sizes, and the parts of the engine's JavaScript in a
// production build. Vite names each built file after a module and adds a content hash, so the report
// names each part by the engine module that its file holds, a file loaded on demand by the part
// that loads it, and a shader file by the device module of the shader build that it holds.
// tools/lib/size-check.ts judges how the sizes changed against a base build. The
// functions here do no file or process work: tools/build-wasm.ts builds, reads and prints.
import { brotliCompressSync, constants } from 'node:zlib';

/** A size in bytes, as the file is and after Brotli compression. */
export interface SizeEntry {
	raw: number;
	brotli: number;
}

/** The raw size and the size after Brotli at its highest quality, as a server would send it. */
export function measure(bytes: Buffer): SizeEntry {
	const brotli = brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
	return { raw: bytes.length, brotli };
}

/** The core's two builds: with threads and shared memory, and without. */
export const CORE_BUILDS = ['threaded', 'single'] as const;

/** The files of each core build that a page downloads: the module and its generated glue. */
export const CORE_FILES = ['null3d_bg.wasm', 'null3d.js'] as const;

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
	/** The part's name in the report. */
	name: string;
	/** The engine module that marks the part's file, relative to the engine's source. */
	module: string;
	/** For a file that a thread loads on demand, the part that loads it. */
	loadedBy?: string;
}

/**
 * The parts of the engine's JavaScript. The renderer loads on demand on the page and in the sketch
 * worker, so a page downloads it only for the thread that draws. The sketch runner and the scene API
 * load on demand on the page, which runs the sketch only in single-threaded mode. The KTX2 loader
 * loads on demand in the thread that runs the sketch, when the sketch loads its first KTX2 file.
 * The preset check loads after the first frame, in the thread that runs the sketch, so no download
 * before the first frame counts it. The stats overlay loads on the page when the sketch first asks
 * for it, and the frame figures that it and `debug.frameStats` read load with it, or in the thread
 * that runs the sketch at the first call of `debug.frameStats`. No download counts them either.
 * The WebGL call timing of benchmark pages loads in the thread that draws, only with ?gl-timing.
 */
export const ENGINE_PARTS: readonly EnginePart[] = [
	{ name: 'page.js', module: 'page/engine.ts' },
	{ name: 'page-renderer.js', module: 'render/draw.ts', loadedBy: 'page.js' },
	{
		name: 'page-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'page-renderer.js',
	},
	{ name: 'page-sketch-runner.js', module: 'sketch/runner.ts', loadedBy: 'page.js' },
	{ name: 'page-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'page-sketch-runner.js' },
	{
		name: 'page-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{ name: 'page-stats-overlay.js', module: 'debug/overlay.ts', loadedBy: 'page.js' },
	{ name: 'page-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'page-stats-overlay.js' },
	{ name: 'sketch-worker.js', module: 'workers/sketch-worker.ts' },
	{ name: 'sketch-worker-renderer.js', module: 'render/draw.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'sketch-worker-renderer.js',
	},
	{ name: 'sketch-worker-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'sketch-worker.js',
	},
	{ name: 'sketch-worker-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'render-worker.js', module: 'workers/render-worker.ts' },
	{
		name: 'render-worker-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'render-worker.js',
	},
	{ name: 'job-worker.js', module: 'workers/job-worker.ts' },
	{ name: 'probe-worker.js', module: 'workers/probe-worker.ts' },
];

/**
 * The shader build's device modules, by part name: one file for each target and each value of the
 * permutation bits that a device fixes, named after its module. The part that draws loads its
 * device's one on demand. Each build that draws holds a copy of each file, and the report measures
 * the largest copy.
 */
export const SHADER_PARTS: readonly string[] = [
	'shaders-wgsl.js',
	'shaders-wgsl-tone-map.js',
	'shaders-glsl.js',
	'shaders-glsl-tone-map.js',
	'shaders-glsl-draw-index.js',
	'shaders-glsl-draw-index-tone-map.js',
];

/**
 * The KTX2 transcoder's files, which a page downloads when it loads its first KTX2 file: the
 * engine's worker that runs the transcoder, and the official Basis Universal build's script and
 * WebAssembly module. A build copies each as it is, under its name with a hash.
 */
export const TRANSCODER_FILES = [
	'transcoder-worker.js',
	'basis_transcoder.js',
	'basis_transcoder.wasm',
] as const;

/** Every file that the size report measures, by the name that the report prints. */
export const REPORTED_FILES: readonly string[] = [
	...CORE_BUILDS.flatMap((build) => CORE_FILES.map((file) => `${build}/${file}`)),
	...ENGINE_PARTS.map(({ name }) => `js/${name}`),
	...SHADER_PARTS.map((name) => `js/${name}`),
	...TRANSCODER_FILES.map((file) => `ktx2/${file}`),
];

/**
 * The built name of each of the transcoder's files, by its own name, from the names of a build's
 * files. A build adds a hash of 8 characters to each name. Throws when a file is missing or there
 * twice, since the loader would then fetch no file or the wrong one.
 */
export function findTranscoderFiles(builtNames: readonly string[]): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of TRANSCODER_FILES) {
		const dot = file.lastIndexOf('.');
		const [stem, extension] = [file.slice(0, dot), file.slice(dot)];
		const matches = builtNames.filter(
			(name) =>
				name.startsWith(`${stem}-`) && name.endsWith(extension) && name.length === file.length + 9,
		);
		if (matches.length !== 1)
			throw new Error(
				`${file}: expected one built copy of the KTX2 transcoder's file, found ${matches.length}`,
			);
		found.set(file, matches[0] as string);
	}
	return found;
}

export interface Download {
	/** The thread mode, as the engine test names it. */
	mode: string;
	/** The parts that a page loads in this mode. */
	parts: readonly string[];
	/**
	 * The start of the names of the shader parts that a page in this mode may load, one of them: the
	 * mode's download counts the largest.
	 */
	shaders: string;
}

/** The parts that a page downloads in each thread mode of the engine. */
export const DOWNLOADS: readonly Download[] = [
	{
		mode: 'pipelined',
		shaders: 'shaders-',
		parts: ['page.js', 'probe-worker.js', 'sketch-worker.js', 'render-worker.js', 'job-worker.js'],
	},
	{
		mode: 'low latency',
		shaders: 'shaders-',
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
		shaders: 'shaders-',
		parts: ['page.js', 'page-renderer.js', 'probe-worker.js', 'sketch-worker.js', 'job-worker.js'],
	},
	{
		mode: 'single-threaded',
		shaders: 'shaders-',
		parts: ['page.js', 'page-sketch-runner.js', 'page-renderer.js', 'probe-worker.js'],
	},
	{
		mode: 'sketch on the main thread',
		shaders: 'shaders-',
		parts: [
			'page.js',
			'page-sketch-runner.js',
			'probe-worker.js',
			'render-worker.js',
			'job-worker.js',
		],
	},
];

/** True for a source file of a page that uses the engine, such as a test page. */
const isPageSource = (source: string) => /^(tests|bench|examples|templates)\//.test(source);

/** The part name of the shader build's device module that a file holds alone, or undefined. */
function shaderPartOf(file: BuiltFile): string | undefined {
	const engine = file.sources.filter((source) => source.startsWith(ENGINE_SOURCE));
	const module = engine.length === 1 ? engine[0]!.slice(ENGINE_SOURCE.length) : '';
	const match = /^generated\/(shaders-[a-z-]+)\.ts$/.exec(module);
	return match ? `${match[1]}.js` : undefined;
}

/**
 * The built file of each part of the engine, by the part's name, in the parts' order, then the
 * largest copy of each shader part. A part that loads on demand is absent when the build bundles
 * its code into the part that loads it. It throws when a part has no file or several, when a file
 * holds engine code that no part names, and when a part's file also holds a page's own code, whose
 * bytes the report would count as the engine's.
 */
export function findEngineParts(
	files: readonly BuiltFile[],
	parts: readonly EnginePart[] = ENGINE_PARTS,
	shaderParts: readonly string[] = SHADER_PARTS,
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
	const shaders = new Map<string, BuiltFile>();
	for (const file of files) {
		const part = claimed.has(file) ? undefined : shaderPartOf(file);
		if (!part) continue;
		if (!shaderParts.includes(part))
			throw new Error(
				`${file.file} holds the shader build's device module of ${part}, which the size report does not name: add it to SHADER_PARTS in tools/lib/size-report.ts`,
			);
		claimed.add(file);
		const copy = shaders.get(part);
		if (!copy || file.text.length > copy.text.length) shaders.set(part, file);
	}
	for (const part of shaderParts) {
		const file = shaders.get(part);
		if (file) found.set(part, file);
	}
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
	const names = [...parts.map(({ name }) => name), ...shaderParts];
	return new Map(names.flatMap((name) => (found.has(name) ? [[name, found.get(name)!]] : [])));
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
 * What a page downloads in each thread mode: the total size of the parts it loads, and of the
 * largest shader part that it may load. A part that the build lacks adds nothing.
 */
export function downloadSizes(
	sizes: ReadonlyMap<string, SizeEntry>,
	downloads: readonly Download[] = DOWNLOADS,
): { mode: string; size: SizeEntry }[] {
	return downloads.map(({ mode, parts, shaders }) => {
		const largest = [...sizes]
			.filter(([part]) => part.startsWith(shaders))
			.map(([, size]) => size)
			.sort((a, b) => b.brotli - a.brotli)
			.slice(0, 1);
		return {
			mode,
			size: totalSize([...parts.flatMap((part) => sizes.get(part) ?? []), ...largest]),
		};
	});
}
