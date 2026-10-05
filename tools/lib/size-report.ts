// The size report's measuring: raw, gzip and Brotli sizes, and the parts of the engine's JavaScript
// in a production build. Vite names each built file after a module and adds a content hash, so the
// report names each part by the engine module that its file holds, a file loaded on demand by the
// part that loads it, and a shader file by the module of the shader build that it holds: a device
// module of the start, the module of a feature that loads on first use, or the module of a shader
// that loads on a feature's first use as a whole, such as the texture generators'.
// tools/lib/size-check.ts judges how the sizes changed against a base build. The
// functions here do no file or process work: tools/build-wasm.ts builds, reads and prints.
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * The ways a host can send a file, as the report's columns: as it is, with gzip, or with Brotli.
 * Most hosts send Brotli to browsers that accept it. Some send only gzip, such as GitHub Pages and
 * nginx with its gzip module alone, and a plain static server sends files as they are.
 */
export const COLUMNS = ['raw', 'gzip', 'brotli'] as const;
export type Column = (typeof COLUMNS)[number];

/** A size in bytes in each column. */
export type SizeEntry = Record<Column, number>;

/** A budget in bytes for each column. */
export type Budget = Readonly<Record<Column, number>>;

/**
 * A file's size as it is, after gzip at level 9 and after Brotli at quality 11: the highest levels,
 * as a host that compresses its files once, when it deploys them, sends them.
 */
export function measure(bytes: Buffer): SizeEntry {
	const gzip = gzipSync(bytes, { level: 9 }).length;
	const brotli = brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
	return { raw: bytes.length, gzip, brotli };
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
	/** True for a part that every page may load after its first frame, with no feature to ask for it. */
	afterFirstFrame?: boolean;
}

/**
 * The parts of the engine's JavaScript. The renderer loads on demand on the page and in the sketch
 * worker, so a page downloads it only for the thread that draws. The sketch runner and the scene API
 * load on demand on the page, which runs the sketch only in single-threaded mode. The KTX2 loader
 * loads on demand in the thread that runs the sketch, when the sketch loads its first KTX2 file.
 * The glTF loader loads there too with the sketch's first glTF file, and starts the glTF worker,
 * which parses files. The glTF worker loads the meshopt decoder with the first file that holds
 * meshopt data. The readers of color grading tables load in the thread that runs the sketch with
 * the first table, the sprite code with the first sprite batch, and the line code with the first
 * line batch.
 * The preset check loads after the first frame, in the thread that runs the sketch, so no download
 * before the first frame counts it. The stats overlay loads on the page when the sketch first asks
 * for it, and the frame figures that it and `debug.frameStats` read load with it, or in the thread
 * that runs the sketch at the first call of `debug.frameStats`. No download counts them either.
 * The loop that moves label elements loads on the page with the first `engine.labels.bind`.
 * The WebGL call timing of benchmark pages loads in the thread that draws, only with ?gl-timing.
 * The built-in environments' numbers load in the thread that runs the sketch with the first one,
 * and the texture generators that make their maps on the GPU load in the thread that draws.
 */
export const ENGINE_PARTS: readonly EnginePart[] = [
	{ name: 'page.js', module: 'page/engine.ts' },
	{ name: 'page-renderer.js', module: 'render/draw.ts', loadedBy: 'page.js' },
	{
		name: 'page-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'page-renderer.js',
	},
	{
		name: 'page-environment-generator.js',
		module: 'gpu/environment-steps.ts',
		loadedBy: 'page-renderer.js',
	},
	{ name: 'page-sketch-runner.js', module: 'sketch/runner.ts', loadedBy: 'page.js' },
	{ name: 'page-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-gltf.js', module: 'scene/gltf.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-lut.js', module: 'scene/lut-files.ts', loadedBy: 'page-sketch-runner.js' },
	{
		name: 'page-environment.js',
		module: 'scene/environment-file.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{
		name: 'page-builtin-environments.js',
		module: 'scene/builtin-environments.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{ name: 'page-sprites.js', module: 'scene/sprites.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-lines.js', module: 'scene/lines.ts', loadedBy: 'page-sketch-runner.js' },
	{
		name: 'page-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'page-sketch-runner.js',
		afterFirstFrame: true,
	},
	{ name: 'page-stats-overlay.js', module: 'debug/overlay.ts', loadedBy: 'page.js' },
	{ name: 'page-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'page-stats-overlay.js' },
	{ name: 'page-label-loop.js', module: 'page/label-loop.ts', loadedBy: 'page.js' },
	{ name: 'sketch-worker.js', module: 'workers/sketch-worker.ts' },
	{ name: 'sketch-worker-renderer.js', module: 'render/draw.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'sketch-worker-renderer.js',
	},
	{
		name: 'sketch-worker-environment-generator.js',
		module: 'gpu/environment-steps.ts',
		loadedBy: 'sketch-worker-renderer.js',
	},
	{ name: 'sketch-worker-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-gltf.js', module: 'scene/gltf.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'gltf-worker.js', module: 'workers/gltf-worker.ts', loadedBy: 'sketch-worker-gltf.js' },
	{ name: 'gltf-meshopt.js', module: 'scene/gltf-meshopt.ts', loadedBy: 'gltf-worker.js' },
	{ name: 'sketch-worker-lut.js', module: 'scene/lut-files.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-environment.js',
		module: 'scene/environment-file.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-builtin-environments.js',
		module: 'scene/builtin-environments.ts',
		loadedBy: 'sketch-worker.js',
	},
	{ name: 'sketch-worker-sprites.js', module: 'scene/sprites.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-lines.js', module: 'scene/lines.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'sketch-worker.js',
		afterFirstFrame: true,
	},
	{ name: 'sketch-worker-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'render-worker.js', module: 'workers/render-worker.ts' },
	{
		name: 'render-worker-call-timing.js',
		module: 'gpu/webgl2/call-timing.ts',
		loadedBy: 'render-worker.js',
	},
	{
		name: 'render-worker-environment-generator.js',
		module: 'gpu/environment-steps.ts',
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
	'shaders-wgsl-half.js',
	'shaders-wgsl-tone-map-half.js',
	'shaders-glsl-half.js',
	'shaders-glsl-tone-map-half.js',
	'shaders-glsl-draw-index-half.js',
	'shaders-glsl-draw-index-tone-map-half.js',
];

/**
 * True for the part of a shader module that loads on a feature's first use: a device module of a
 * feature, which the shader build names after the feature, then the target and the bits, as
 * `shaders-sprites-glsl-draw-index.js`, or the module of a shader that loads on first use as a
 * whole, named after the shader and the target, as `shaders-environment-wgsl.js`. A page downloads
 * one the first time it uses the feature, so no start counts it. The manifest's
 * `[first_use.<feature>]` tables and `first_use` shaders name them, and the parts follow from them.
 */
export function isFirstUseShaderPart(name: string): boolean {
	return (
		!SHADER_PARTS.includes(name) &&
		/^shaders-[a-z][a-z0-9-]*?-(wgsl|glsl)(-[a-z-]+)?\.js$/.test(name)
	);
}

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

/**
 * The parts that no thread mode downloads at its start. Each loads on a feature's first use, or
 * after the first frame, so no start budget counts it, and each has a budget of its own.
 */
export const LATER_PARTS: readonly EnginePart[] = ENGINE_PARTS.filter(
	({ name }) => !DOWNLOADS.some(({ parts }) => parts.includes(name)),
);

/** True for a source file of a page that uses the engine, such as a test page. */
const isPageSource = (source: string) => /^(tests|bench|examples|templates)\//.test(source);

/** The part name of the shader build's device module that a file holds alone, or undefined. */
function shaderPartOf(file: BuiltFile): string | undefined {
	const engine = file.sources.filter((source) => source.startsWith(ENGINE_SOURCE));
	const module = engine.length === 1 ? engine[0]!.slice(ENGINE_SOURCE.length) : '';
	const match = /^generated\/(shaders-[a-z-]+)\.[jt]s$/.exec(module);
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
		if (!shaderParts.includes(part) && !isFirstUseShaderPart(part))
			throw new Error(
				`${file.file} holds the shader build's module of ${part}, which the size report does not name: add it to SHADER_PARTS in tools/lib/size-report.ts`,
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
	const firstUse = [...shaders.keys()].filter((part) => !shaderParts.includes(part)).sort();
	for (const part of firstUse) found.set(part, shaders.get(part)!);
	const names = [...parts.map(({ name }) => name), ...shaderParts, ...firstUse];
	return new Map(names.flatMap((name) => (found.has(name) ? [[name, found.get(name)!]] : [])));
}

/** The sum of the sizes of files that a server sends one by one, each compressed on its own. */
export function totalSize(sizes: Iterable<SizeEntry>): SizeEntry {
	const total = { raw: 0, gzip: 0, brotli: 0 };
	for (const size of sizes) for (const column of COLUMNS) total[column] += size[column];
	return total;
}

/**
 * What a page downloads in each thread mode: the total size of the parts it loads, and of the
 * largest shader part of the start that it may load, the largest in each column. A part that the
 * build lacks adds nothing.
 */
export function downloadSizes(
	sizes: ReadonlyMap<string, SizeEntry>,
	downloads: readonly Download[] = DOWNLOADS,
): { mode: string; size: SizeEntry }[] {
	return downloads.map(({ mode, parts, shaders }) => {
		const size = totalSize(parts.flatMap((part) => sizes.get(part) ?? []));
		const shaderSizes = [...sizes].filter(
			([part]) => part.startsWith(shaders) && !isFirstUseShaderPart(part),
		);
		for (const column of COLUMNS)
			size[column] += Math.max(0, ...shaderSizes.map(([, shader]) => shader[column]));
		return { mode, size };
	});
}

/**
 * The budget for the engine's JavaScript that a page downloads at its start, in whichever thread
 * mode downloads the most. The core's generated glue counts with the WebAssembly files instead.
 * Brotli's budget is the owner's. The gzip and raw budgets hold today's start with about a tenth to
 * spare. The shader file fills most of it, so per-feature shader files bring both down. Until then
 * they stop a start that grows on a gzip host, or on a host that sends files as they are.
 */
export const START_BUDGET: Budget = { raw: 3_328 * 1024, gzip: 448 * 1024, brotli: 140 * 1024 };

/** The budget for each part that loads after the start. */
export const LATER_BUDGET: Budget = { raw: 64 * 1024, gzip: 24 * 1024, brotli: 16 * 1024 };

/** A column's name as a problem names it. */
const COLUMN_NAMES: Readonly<Record<Column, string>> = {
	raw: 'uncompressed',
	gzip: 'after gzip',
	brotli: 'after Brotli',
};

/** A problem for each column of `size` over its budget, each starting with `what`. */
function overBudget(what: string, size: SizeEntry, budget: Budget): string[] {
	return COLUMNS.filter((column) => size[column] > budget[column]).map(
		(column) =>
			`${what} is ${size[column].toLocaleString('en-US')} bytes ${COLUMN_NAMES[column]}, over its ${budget[column] / 1024} KB budget`,
	);
}

/**
 * The budget for each device module of a feature that loads on first use. Such a module is shader
 * data, as the modules of the start are, so its limits started at the size of a start shader
 * file. Shader text shrinks far more under compression than code does, so these limits do not keep
 * the start budget's proportions. The owner set them on 4 October 2026, and on 5 October raised
 * the Brotli limit for the shadow filter's growth and the gzip limit, which only hosts without
 * Brotli meet, for the skinning and morph files of environment lighting (decision records D-14
 * and D-56).
 */
export const FIRST_USE_SHADER_BUDGET: Budget = {
	raw: 1_536 * 1024,
	gzip: 320 * 1024,
	brotli: 32 * 1024,
};

/**
 * A problem for each thread mode whose start passes the start budget in a column, for each part
 * that loads after the start and passes its own budget in a column, and for each device module of a
 * feature that loads on first use and passes its budget in a column.
 */
export function budgetProblems(
	sizes: ReadonlyMap<string, SizeEntry>,
	downloads: readonly Download[] = DOWNLOADS,
	later: readonly EnginePart[] = LATER_PARTS,
): string[] {
	return [
		...downloadSizes(sizes, downloads).flatMap(({ mode, size }) =>
			overBudget(
				`the engine JavaScript that a page downloads at its start in ${mode} mode`,
				size,
				START_BUDGET,
			),
		),
		...later.flatMap(({ name }) => {
			const size = sizes.get(name);
			return size ? overBudget(`js/${name}, which loads after the start,`, size, LATER_BUDGET) : [];
		}),
		...[...sizes].flatMap(([name, size]) =>
			isFirstUseShaderPart(name)
				? overBudget(
						`js/${name}, the shader builds of a feature that loads on first use,`,
						size,
						FIRST_USE_SHADER_BUDGET,
					)
				: [],
		),
	];
}
