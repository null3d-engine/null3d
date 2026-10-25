// The size report's measuring: raw, gzip and Brotli sizes, and the parts of the engine's JavaScript
// in a production build. Vite names each built file after a module and adds a content hash, so the
// report names each part by the engine module that its file holds, a file loaded on demand by the
// part that loads it, and a shader file by the module of the shader build that it holds: a device
// module of the start, the module of a feature that loads on first use, or the module of a shader
// that loads on a feature's first use as a whole, such as the texture generators'.
// tools/lib/size-check.ts judges how the sizes changed against a base build. The
// functions here do no file or process work of their own: tools/build-wasm.ts builds, reads and
// prints, and hands in each file's bytes as a function that reads them.
//
// CI can split the measuring into parts that run at the same time: each part builds the same page
// and measures its own share of the files, and one step merges the parts' sizes and judges them.
// A file's sizes depend only on its bytes and the compressors, so a measuring can take them from a
// memo of earlier measurings, by the hash of the bytes, and compress only the files that changed.
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, brotliCompressSync, constants, gzip, gzipSync } from 'node:zlib';

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
	const gzipped = gzipSync(bytes, GZIP_OPTIONS).length;
	const brotli = brotliCompressSync(bytes, BROTLI_OPTIONS).length;
	return { raw: bytes.length, gzip: gzipped, brotli };
}

const GZIP_OPTIONS = { level: 9 };
const BROTLI_OPTIONS = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/**
 * The compressors and their settings that a size memo's entries hold for. A memo made under
 * another stamp, such as by another runtime's zlib, holds no entry for this one.
 */
export const SIZE_MEMO_STAMP = JSON.stringify({
	gzip: GZIP_OPTIONS,
	brotli: BROTLI_OPTIONS,
	zlib: process.versions.zlib,
	runtime: process.versions.bun ?? process.version,
});

/**
 * The sizes that earlier measurings found, by the SHA-256 of a file's bytes, and the entries of the
 * files that this measuring met, which are what a later measuring needs.
 */
export interface SizeMemo {
	known: ReadonlyMap<string, SizeEntry>;
	met: Map<string, SizeEntry>;
	/** How many files this measuring compressed, because the memo held no entry for them. */
	compressed: number;
}

/** A memo of the given entries, by the hash of a file's bytes. */
export function sizeMemo(known: Readonly<Record<string, SizeEntry>> = {}): SizeMemo {
	return { known: new Map(Object.entries(known)), met: new Map(), compressed: 0 };
}

/** [`measure`]'s sizes, with both compressions on the runtime's worker threads. */
async function measureAsync(bytes: Buffer): Promise<SizeEntry> {
	const [gzipped, brotli] = await Promise.all([
		gzipAsync(bytes, GZIP_OPTIONS),
		brotliAsync(bytes, BROTLI_OPTIONS),
	]);
	return { raw: bytes.length, gzip: gzipped.length, brotli: brotli.length };
}

/** A file of a page's build that the size report measures. */
export interface ReportFile {
	/** The name that the report prints, such as `js/page.js` or `first-use/meshopt_decoder.wasm`. */
	name: string;
	/** The built file's own name, whose hash changes with its content. */
	built: string;
	/** The file's length, which balances the parts of a split measuring. */
	weight: number;
	/** Reads the file's bytes, only when the file is measured. */
	read: () => Buffer;
}

/**
 * The size of each of `files`, by name, in their order. `onMeasured` follows each file as it ends.
 * The files compress on every core at once: as many at a time as the machine has cores, each read
 * only when its turn comes, so the memory held stays a few files. With a memo, a file whose bytes
 * the memo knows takes its sizes from there, and every file's entry goes into the memo's `met`.
 */
export async function measureFiles(
	files: readonly ReportFile[],
	onMeasured?: (file: ReportFile) => void,
	memo?: SizeMemo,
): Promise<Map<string, SizeEntry>> {
	const measured = new Array<SizeEntry>(files.length);
	let next = 0;
	// Each set of bytes that the memo lacks compresses once, however many files hold it.
	const compressing = new Map<string, Promise<SizeEntry>>();
	const sizeOf = async (bytes: Buffer): Promise<SizeEntry> => {
		if (!memo) return measureAsync(bytes);
		const hash = createHash('sha256').update(bytes).digest('hex');
		const known = memo.known.get(hash);
		let size = known ? Promise.resolve(known) : compressing.get(hash);
		if (!size) {
			size = measureAsync(bytes);
			compressing.set(hash, size);
			memo.compressed++;
		}
		memo.met.set(hash, await size);
		return size;
	};
	const worker = async () => {
		for (let at = next++; at < files.length; at = next++) {
			const file = files[at] as ReportFile;
			measured[at] = await sizeOf(file.read());
			onMeasured?.(file);
		}
	};
	await Promise.all(Array.from({ length: Math.min(availableParallelism(), files.length) }, worker));
	return new Map(files.map(({ name }, at) => [name, measured[at] as SizeEntry]));
}

/** One part of a measuring split into `count` parts: `index` runs from 1 to `count`. */
export interface PartSpec {
	index: number;
	count: number;
}

/** Reads a part as `<i>/<n>`, such as `2/6`. */
export function parsePartSpec(text: string): PartSpec {
	const match = /^(\d+)\/(\d+)$/.exec(text);
	const index = Number(match?.[1]);
	const count = Number(match?.[2]);
	if (!match || index < 1 || index > count)
		throw new Error(`a part is <i>/<n>, with i from 1 to n, such as 2/6, not ${text}`);
	return { index, count };
}

/** The name of the file that a part writes its sizes to. */
export const sizePartFile = ({ index, count }: PartSpec) => `part-${index}-of-${count}.json`;

/** True for the name of a file that a part writes its sizes to. */
export const isSizePartFile = (name: string) => /^part-\d+-of-\d+\.json$/.test(name);

/**
 * The names of the files that part `index` of `count` measures. The files go out heaviest first,
 * each to the part with the least weight so far, so the parts take about equal time. Every part
 * that reads the same build makes the same split, so each file falls in exactly one part.
 */
export function partShare(
	files: readonly Pick<ReportFile, 'name' | 'weight'>[],
	{ index, count }: PartSpec,
): Set<string> {
	const loads = new Array<number>(count).fill(0);
	const share = new Set<string>();
	const order = files
		.map((file, at) => ({ file, at }))
		.sort((a, b) => b.file.weight - a.file.weight || a.at - b.at);
	for (const { file } of order) {
		let lightest = 0;
		for (let part = 1; part < count; part++) if (loads[part]! < loads[lightest]!) lightest = part;
		loads[lightest]! += file.weight;
		if (lightest === index - 1) share.add(file.name);
	}
	return share;
}

/** What one part of a split measuring writes, for the step that judges every part together. */
export interface SizePart {
	/** The part's number, from 1. */
	part: number;
	/** How many parts the measuring has. */
	of: number;
	/** A hash of every file's name and built name, the same only for parts of one build. */
	build: string;
	/** The name of every file that the build's report measures, in the report's order. */
	files: string[];
	/** The sizes of this part's own files, by name. */
	sizes: Record<string, SizeEntry>;
}

/** The hash that tells the files of one build from another's. */
function buildHash(files: readonly Pick<ReportFile, 'name' | 'built'>[]): string {
	const lines = files.map(({ name, built }) => `${name}\t${built}`).join('\n');
	return createHash('sha256').update(lines).digest('hex');
}

/** Measures the share of `files` that `spec` names, and returns the record that the part writes. */
export async function measureSizePart(
	files: readonly ReportFile[],
	spec: PartSpec,
	onMeasured?: (file: ReportFile) => void,
	memo?: SizeMemo,
): Promise<SizePart> {
	const share = partShare(files, spec);
	const own = files.filter(({ name }) => share.has(name));
	return {
		part: spec.index,
		of: spec.count,
		build: buildHash(files),
		files: files.map(({ name }) => name),
		sizes: Object.fromEntries(await measureFiles(own, onMeasured, memo)),
	};
}

/**
 * The size of every file, from the records of every part, in the report's order: the same map as
 * one measuring of every file gives. It throws when a part is missing or there twice, when the
 * parts read different builds or split into different counts, and when a file has no size or more
 * than one.
 */
export function mergeSizeParts(parts: readonly SizePart[]): Map<string, SizeEntry> {
	const first = parts[0];
	if (!first) throw new Error('there is no part of the size measuring to merge');
	const count = first.of;
	for (const { part, of, build } of parts) {
		if (of !== count) throw new Error(`part ${part} of ${of} cannot merge with parts of ${count}`);
		if (build !== first.build)
			throw new Error(
				`part ${part} of ${count} measured another build than part ${first.part}: every part must build the same commit`,
			);
	}
	const numbers = parts.map(({ part }) => part).sort((a, b) => a - b);
	if (numbers.join() !== Array.from({ length: count }, (_, i) => i + 1).join())
		throw new Error(`expected parts 1 to ${count}, each once, but found ${numbers.join(', ')}`);
	const files = new Set(first.files);
	const merged = new Map<string, SizeEntry>();
	for (const name of first.files) {
		const holders = parts.filter(({ sizes }) => Object.hasOwn(sizes, name));
		if (holders.length !== 1)
			throw new Error(`${name} has a size in ${holders.length} parts, not in exactly one`);
		merged.set(name, holders[0]!.sizes[name]!);
	}
	for (const { part, sizes } of parts)
		for (const name of Object.keys(sizes))
			if (!files.has(name)) throw new Error(`part ${part} measured ${name}, which no build lists`);
	return merged;
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
/** The engine package's folder, whose vendored scripts the parts may hold too. */
const ENGINE_PACKAGE = 'packages/engine/';

export interface EnginePart {
	/** The part's name in the report. */
	name: string;
	/** The engine module that marks the part's file, relative to the engine's source. */
	module: string;
	/** For a file that a thread loads on demand, the part that loads it. */
	loadedBy?: string;
	/** True for a part that every page may load after its first frame, with no feature to ask for it. */
	afterFirstFrame?: boolean;
	/**
	 * True for a part that loads at the first call that reads it, not with a feature's first use: the
	 * frame figures behind `measure()` and the fixes of the errors' messages. A page that makes
	 * neither call downloads neither part.
	 */
	onFirstCall?: boolean;
	/**
	 * True for a part whose module the start's own files also hold, which the bundler keeps inline:
	 * it writes a file of its own only for the thread that loads the module on demand. Every page
	 * downloads the module's code at its start in the start's files, so no first-use check watches
	 * it, and its own file carries the threads that load it on demand only.
	 */
	alsoInStart?: boolean;
}

/**
 * The parts of a thread's drawing code that it loads on demand, named after `prefix`, where
 * `drawing` names the part that holds the thread's frame loops. Each GPU path's renderers load once
 * the thread knows its path, with the code that both paths share beside them. The thread loads the
 * WebGL call timing, the texture generators' steps, the reader of the GPU-culled draws' counts and
 * the joiner of custom effects on first use.
 */
function drawingParts(prefix: string, drawing: string): EnginePart[] {
	const webgpu = `${prefix}-webgpu.js`;
	const shared = `${prefix}-gpu-shared.js`;
	return [
		{ name: webgpu, module: 'render/webgpu-renderers.ts', loadedBy: drawing },
		{ name: `${prefix}-webgl2.js`, module: 'render/webgl2-renderers.ts', loadedBy: drawing },
		{ name: shared, module: 'render/scene-renderer.ts', loadedBy: webgpu },
		{ name: `${prefix}-call-timing.js`, module: 'gpu/webgl2/call-timing.ts', loadedBy: drawing },
		{ name: `${prefix}-culled-counts.js`, module: 'gpu/webgpu/culled-counts.ts', loadedBy: webgpu },
		{
			name: `${prefix}-environment-generator.js`,
			module: 'gpu/environment-steps.ts',
			loadedBy: drawing,
		},
		{ name: `${prefix}-effect-joiner.js`, module: 'gpu/effect-joiner.ts', loadedBy: shared },
	];
}

/**
 * The parts of the engine's JavaScript. The early script that the Vite plugin adds to each page
 * starts the core's download, and every thread mode loads it. The probe worker's measurement of
 * the direct drawing path loads in a file of its own when the probe runs, so a device with WebGPU
 * downloads it whichever path the page draws with, and each start counts it. The renderer loads on demand on the
 * page and in the sketch worker, so a page downloads it only for the thread that draws. Each GPU
 * path's renderers load on demand in the thread that draws, so a page downloads one path's only
 * (`drawingParts`). The sketch runner and the scene API load on demand on the page, which runs the sketch only in single-threaded mode. The KTX2 loader
 * loads on demand in the thread that runs the sketch, when the sketch loads its first KTX2 file,
 * with the on-demand loader that it shares with the glTF loader. The KTX2 task, with the Basis
 * Universal transcoder's script, loads in a job worker, or in the task worker that the on-demand
 * loader starts where the engine has no job workers. The glTF loader loads in the thread that runs
 * the sketch with the sketch's first glTF file, and starts the glTF worker, which parses files.
 * The glTF worker loads the meshopt decoder's code with the first file that holds meshopt data, and
 * the engine's Draco code with the first file that holds Draco data, which then loads Draco's own
 * script, the one part that a module path outside the engine's source names.
 * The readers of color grading tables load in the thread that runs the sketch with
 * the first table, the sprite code with the first sprite batch, and the line code with the first
 * line batch. The code of a feature draw, and of the instance draw that a compute pass fills, loads
 * in the thread that runs the sketch with the first call that makes one.
 * The preset check loads after the first frame, in the thread that runs the sketch, so no download
 * before the first frame counts it. The stats overlay loads on the page when the sketch first asks
 * for it, and the frame figures that it and `debug.frameStats` read load with it, or in the thread
 * that runs the sketch at the first call of `debug.frameStats`. No download counts them either.
 * The measurement's own frame figures load on the page at the first `measure()`, and the fixes of
 * the errors' messages load in each thread at its first error, so a page that measures and throws
 * nothing downloads neither.
 * The loop that moves label elements loads on the page with the first `engine.labels.bind`.
 * The WebGL call timing of benchmark pages loads in the thread that draws, only with ?gl-timing.
 * Each GPU path's table of the shader files of builds that need several features that load on
 * first use loads in the thread that draws, the first time a pipeline or a preload needs one.
 * The reader of the counts of the draws that the GPU culls loads in the thread that draws on WebGPU,
 * at the first frame that samples, such as with the stats overlay shown.
 * The built-in environments' numbers load in the thread that runs the sketch with the first one,
 * and the texture generators that make their maps on the GPU load in the thread that draws. The
 * code that joins custom effects into fewer passes loads in the thread that draws with the first
 * effects that join. The area lights' tables' code loads in the thread that runs the sketch with
 * the first rectangle or tube light, which starts the tables' download.
 */
export const ENGINE_PARTS: readonly EnginePart[] = [
	{ name: 'early-core.js', module: 'page/early-core.ts' },
	{ name: 'page.js', module: 'page/engine.ts' },
	{
		name: 'page-message.js',
		module: 'errors/message.ts',
		loadedBy: 'page.js',
	},
	{
		// The engine's error type, which the page's start, its loader and its checks all raise, so the
		// bundler keeps it in a file of its own that every page loads.
		name: 'engine-error.js',
		module: 'errors/engine-error.ts',
		loadedBy: 'page.js',
	},
	{ name: 'page-gpu.js', module: 'generated/gpu.ts', loadedBy: 'page.js' },
	{ name: 'page-control.js', module: 'shared/control.ts', loadedBy: 'page.js' },
	{ name: 'page-renderer.js', module: 'render/draw.ts', loadedBy: 'page.js' },
	...drawingParts('page', 'page-renderer.js'),
	{ name: 'page-sketch-runner.js', module: 'sketch/runner.ts', loadedBy: 'page.js' },
	// A page records or replays only with a switch, so the format and the reader load then, and the
	// save button loads only for a page that records. The page and the sketch worker each bundle
	// their own copy of the format, as they do the glTF and KTX2 loaders, so each graph has a part.
	{
		name: 'page-recording.js',
		module: 'shared/recording.ts',
		loadedBy: 'page.js',
		onFirstCall: true,
	},
	{
		name: 'sketch-worker-recording.js',
		module: 'shared/recording.ts',
		loadedBy: 'sketch-worker.js',
		onFirstCall: true,
	},
	{
		name: 'page-record-button.js',
		module: 'page/record-button.ts',
		loadedBy: 'page.js',
		onFirstCall: true,
	},
	// A page that shows no video downloads none of the support that follows one.
	{ name: 'page-videos.js', module: 'page/videos.ts', loadedBy: 'page.js', onFirstCall: true },
	{ name: 'page-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-gltf.js', module: 'scene/gltf.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-assets.js', module: 'scene/assets.ts', loadedBy: 'page-sketch-runner.js' },
	// The built-in environments' descriptions load on first use: a sketch that names no built-in
	// environment, as most do not, downloads none of them.
	{ name: 'environment.js', module: 'scene/builtin-environments.ts', onFirstCall: true },
	{ name: 'page-baked-light.js', module: 'scene/baked-light.ts', loadedBy: 'page-assets.js' },
	// The half-float helpers are read by several of the start's own modules, so the bundler writes
	// them to a file of their own that every page loads: a part of the start, not a first-use file.
	{
		name: 'page-half-float.js',
		module: 'scene/half-float.ts',
		loadedBy: 'page-assets.js',
		alsoInStart: true,
	},
	// Modules that both the page's start and the file loader carry, which the bundler puts in files
	// of their own that every page loads: they are parts of the start, not first-use files.
	{ name: 'page-shader-features.js', module: 'generated/shader-features.ts', loadedBy: 'page.js' },
	{ name: 'page-check.js', module: 'quality/check.ts', loadedBy: 'page.js' },
	{ name: 'page-core.js', module: 'generated/core.ts', loadedBy: 'page.js' },
	{ name: 'page-tasks.js', module: 'shared/tasks.ts', loadedBy: 'page-ktx2.js' },
	{ name: 'task-worker.js', module: 'workers/task-worker.ts', loadedBy: 'page-tasks.js' },
	{ name: 'task-worker-ktx2.js', module: 'scene/ktx2-transcode.ts', loadedBy: 'task-worker.js' },
	{ name: 'task-worker-grade.js', module: 'scene/grade-task.ts', loadedBy: 'task-worker.js' },
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
	{ name: 'page-panorama.js', module: 'scene/panorama.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-sprites.js', module: 'scene/sprites.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-lines.js', module: 'scene/lines.ts', loadedBy: 'page-sketch-runner.js' },
	{ name: 'page-particles.js', module: 'scene/particles.ts', loadedBy: 'page-sketch-runner.js' },
	{
		name: 'page-feature-draws.js',
		module: 'scene/feature-draws.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{
		name: 'page-feature-instances.js',
		module: 'scene/feature-instances.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{
		name: 'page-area-light-tables.js',
		module: 'scene/area-light-tables.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{
		name: 'page-light-images.js',
		module: 'scene/light-images.ts',
		loadedBy: 'page-sketch-runner.js',
	},
	{
		name: 'page-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'page-sketch-runner.js',
		afterFirstFrame: true,
	},
	{ name: 'page-stats-overlay.js', module: 'debug/overlay.ts', loadedBy: 'page.js' },
	{ name: 'page-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'page-stats-overlay.js' },
	{
		name: 'page-frame-figures.js',
		module: 'page/frame-stats.ts',
		loadedBy: 'page.js',
		onFirstCall: true,
	},
	{
		name: 'page-error-fixes.js',
		module: 'errors/fixes.ts',
		loadedBy: 'page.js',
		onFirstCall: true,
	},
	{
		name: 'sketch-worker-error-fixes.js',
		module: 'errors/fixes.ts',
		loadedBy: 'sketch-worker.js',
		onFirstCall: true,
	},
	{ name: 'page-label-loop.js', module: 'page/label-loop.ts', loadedBy: 'page.js' },
	{ name: 'sketch-worker.js', module: 'workers/sketch-worker.ts' },
	{ name: 'sketch-worker-renderer.js', module: 'render/draw.ts', loadedBy: 'sketch-worker.js' },
	...drawingParts('sketch-worker', 'sketch-worker-renderer.js'),
	{ name: 'sketch-worker-ktx2.js', module: 'scene/ktx2.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-gltf.js', module: 'scene/gltf.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-assets.js', module: 'scene/assets.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-baked-light.js',
		module: 'scene/baked-light.ts',
		loadedBy: 'sketch-worker-assets.js',
	},
	{
		name: 'sketch-worker-shader-features.js',
		module: 'generated/shader-features.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-images.js',
		module: 'shared/images.ts',
		loadedBy: 'sketch-worker.js',
	},
	{ name: 'sketch-worker-gpu.js', module: 'generated/gpu.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-tasks.js', module: 'shared/tasks.ts', loadedBy: 'sketch-worker-ktx2.js' },
	// The worker bootstrap, which the first feature of a worker that starts one of its own loads.
	{
		// The page's start imports this module too, so every page downloads its code in the start's
		// own files; the worker's copy loads on demand in the thread that starts a worker of its own.
		name: 'sketch-worker-worker-start.js',
		module: 'shared/worker-start.ts',
		loadedBy: 'sketch-worker-tasks.js',
		alsoInStart: true,
	},
	{ name: 'gltf-worker.js', module: 'workers/gltf-worker.ts', loadedBy: 'sketch-worker-gltf.js' },
	{ name: 'gltf-meshopt.js', module: 'scene/gltf-meshopt.ts', loadedBy: 'gltf-worker.js' },
	{ name: 'gltf-draco.js', module: 'scene/gltf-draco.ts', loadedBy: 'gltf-worker.js' },
	{
		name: 'gltf-draco-decoder.js',
		module: '../vendor/draco/draco_wasm_wrapper_gltf.js',
		loadedBy: 'gltf-draco.js',
	},
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
	{
		name: 'sketch-worker-panorama.js',
		module: 'scene/panorama.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'panorama-worker.js',
		module: 'workers/panorama-worker.ts',
		loadedBy: 'sketch-worker-panorama.js',
	},
	{ name: 'sketch-worker-sprites.js', module: 'scene/sprites.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'sketch-worker-lines.js', module: 'scene/lines.ts', loadedBy: 'sketch-worker.js' },
	{
		name: 'sketch-worker-particles.js',
		module: 'scene/particles.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-feature-draws.js',
		module: 'scene/feature-draws.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-feature-instances.js',
		module: 'scene/feature-instances.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-area-light-tables.js',
		module: 'scene/area-light-tables.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-light-images.js',
		module: 'scene/light-images.ts',
		loadedBy: 'sketch-worker.js',
	},
	{
		name: 'sketch-worker-preset-check.js',
		module: 'sketch/preset-check.ts',
		loadedBy: 'sketch-worker.js',
		afterFirstFrame: true,
	},
	{ name: 'sketch-worker-frame-stats.js', module: 'debug/stats.ts', loadedBy: 'sketch-worker.js' },
	{ name: 'render-worker.js', module: 'workers/render-worker.ts' },
	...drawingParts('render-worker', 'render-worker.js'),
	{ name: 'job-worker.js', module: 'workers/job-worker.ts' },
	{ name: 'job-worker-ktx2.js', module: 'scene/ktx2-transcode.ts', loadedBy: 'job-worker.js' },
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
 * True for the shared table of a target's device modules of one value of the bits a device fixes,
 * as `shader-paragraphs-glsl-draw-index.js`. A paragraph that many of the kind's device modules
 * hold is written once there instead of inside every module that uses it. The shader build's name
 * carries no `shaders-` prefix, so that the list of a build's files for offline play reads a table
 * as no feature of its own.
 */
export function isParagraphTable(name: string): boolean {
	return /^shader-paragraphs-[a-z0-9-]+\.js$/.test(name);
}

/**
 * True for the loader table of the combinations of one feature family, as
 * `shaders-glsl-combos-bump.js`. A page loads the table of the family of the build it asks for, so
 * a feature's combinations never grow another feature's file past its budget (D-190).
 */
export function isCombosPart(name: string): boolean {
	return /^shaders-(wgsl|glsl)-combos(-[a-z0-9-]+)*\.js$/.test(name);
}

/**
 * True for the part of a shader module that loads on a feature's first use: a device module of a
 * feature, which the shader build names after the feature, then the target and the bits, as
 * `shaders-sprites-glsl-draw-index.js`, or the module of a shader that loads on first use as a
 * whole, named after the shader and the target, as `shaders-environment-wgsl.js`. A page downloads
 * one the first time it uses the feature, so no start counts it. The manifest's
 * `[first_use.<feature>]` tables and `first_use` shaders name them, and the parts follow from them.
 *
 * A table of shared paragraphs loads with the first feature whose modules of its kind name it, and
 * the start never names one, so it belongs to this group too.
 */
export function isFirstUseShaderPart(name: string): boolean {
	if (isParagraphTable(name)) return true;
	return (
		!SHADER_PARTS.includes(name) &&
		/^shaders-[a-z][a-z0-9-]*?-(wgsl|glsl)(-[a-z-]+)?\.js$/.test(name)
	);
}

/**
 * The files besides code that load on first use: the WebAssembly modules that the on-demand
 * loader compiles, and the area lights' tables. They are the KTX2 transcoder, with a page's first
 * KTX2 file, the meshopt decoder, with its first glTF file that holds meshopt data, Draco's
 * decoder, with its first glTF file that holds Draco data, and the tables, with the first
 * rectangle or tube light. A build copies each as it is, under its name with a hash. Draco's
 * decoder and the tables are recorded exceptions to the limit of files that load on first use
 * (D-14, D-145).
 */
export const FIRST_USE_FILES = [
	'basis_transcoder.wasm',
	'meshopt_decoder.wasm',
	'draco_decoder_gltf.wasm',
	'area-light-tables.bin',
] as const;

/** Every file that the size report measures, by the name that the report prints. */
export const REPORTED_FILES: readonly string[] = [
	...CORE_BUILDS.flatMap((build) => CORE_FILES.map((file) => `${build}/${file}`)),
	...ENGINE_PARTS.map(({ name }) => `js/${name}`),
	...SHADER_PARTS.map((name) => `js/${name}`),
	...FIRST_USE_FILES.map((file) => `first-use/${file}`),
];

/**
 * The built name of each file of `FIRST_USE_FILES`, by its own name, from the names of a build's
 * files. A build adds a hash of 8 characters to each name. Throws when a file is missing or there
 * twice, since the engine would then fetch no file or the wrong one.
 */
export function findFirstUseFiles(builtNames: readonly string[]): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of FIRST_USE_FILES) {
		const dot = file.lastIndexOf('.');
		const [stem, extension] = [file.slice(0, dot), file.slice(dot)];
		const matches = builtNames.filter(
			(name) =>
				name.startsWith(`${stem}-`) && name.endsWith(extension) && name.length === file.length + 9,
		);
		if (matches.length !== 1)
			throw new Error(`${file}: expected one built copy of the file, found ${matches.length}`);
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

/** A thread mode: the parts that a page downloads in it, and the prefix of its drawing parts. */
interface ThreadMode {
	mode: string;
	parts: readonly string[];
	/** The prefix of the names of the parts that the thread that draws loads for its GPU path. */
	drawing: string;
}

/** The parts that a page downloads in each thread mode of the engine, on either GPU path. */
const THREAD_MODES: readonly ThreadMode[] = [
	{
		mode: 'pipelined',
		drawing: 'render-worker',
		parts: [
			'early-core.js',
			'page.js',
			'probe-worker.js',
			'sketch-worker.js',
			'sketch-worker-gpu.js',
			'sketch-worker-images.js',
			'sketch-worker-shader-features.js',
			'render-worker.js',
			'job-worker.js',
		],
	},
	{
		mode: 'low latency',
		drawing: 'sketch-worker',
		parts: [
			'early-core.js',
			'page.js',
			'probe-worker.js',
			'sketch-worker.js',
			'sketch-worker-gpu.js',
			'sketch-worker-images.js',
			'sketch-worker-shader-features.js',
			'sketch-worker-renderer.js',
			'job-worker.js',
		],
	},
	{
		mode: 'drawing on the main thread',
		drawing: 'page',
		parts: [
			'early-core.js',
			'page.js',
			'page-renderer.js',
			'probe-worker.js',
			'sketch-worker.js',
			'sketch-worker-gpu.js',
			'sketch-worker-images.js',
			'sketch-worker-shader-features.js',
			'job-worker.js',
		],
	},
	{
		mode: 'single-threaded',
		drawing: 'page',
		parts: [
			'early-core.js',
			'page.js',
			'page-sketch-runner.js',
			'page-renderer.js',
			'probe-worker.js',
		],
	},
	{
		mode: 'sketch on the main thread',
		drawing: 'render-worker',
		parts: [
			'early-core.js',
			'page.js',
			'page-sketch-runner.js',
			'probe-worker.js',
			'render-worker.js',
			'job-worker.js',
		],
	},
];

/** The GPU paths: the name of each path's drawing parts, and the start of its shader parts' names. */
const GPU_PATHS = [
	{ name: 'WebGPU', part: 'webgpu', shaders: 'shaders-wgsl' },
	{ name: 'WebGL2', part: 'webgl2', shaders: 'shaders-glsl' },
] as const;

/**
 * The parts that a page downloads in each thread mode on each GPU path. The thread that draws loads
 * the renderers of its own path only, with the code that both paths share, and its path's shader
 * file.
 */
export const DOWNLOADS: readonly Download[] = THREAD_MODES.flatMap(({ mode, parts, drawing }) =>
	GPU_PATHS.map((path) => ({
		mode: `${mode}, ${path.name}`,
		shaders: path.shaders,
		parts: [
			...parts,
			// Small modules that many files share, which the bundler puts in files of their own that
			// every page loads.
			'engine-error.js',
			'page-message.js',
			'page-gpu.js',
			'page-check.js',
			'page-core.js',
			'page-shader-features.js',
			'page-control.js',
			'page-half-float.js',
			`${drawing}-${path.part}.js`,
			`${drawing}-gpu-shared.js`,
		],
	})),
);

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
	const match = /^generated\/(shaders-[a-z-]+|shader-paragraphs-[a-z0-9-]+)\.[jt]s$/.exec(module);
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
	const holds = (file: BuiltFile, module: string) =>
		file.sources.includes(posix.join(ENGINE_SOURCE, module));
	for (const part of parts) {
		if (part.loadedBy) continue;
		const matches = files.filter((file) => holds(file, part.module));
		if (matches.length !== 1)
			throw new Error(
				`${part.name}: expected one built file that holds ${part.module}, found ${matches.length}`,
			);
		found.set(part.name, matches[0]!);
	}
	// A loader names the files that it loads, and each of those names more: a feature's loader loads
	// the loaders of the files that the feature reads. So a part's file is named in the text of the
	// loader, or of a file that the loader names, two steps down.
	// The files that each file names, read once: a loader names the files it loads, and each of
	// those may name more, as a feature's loader loads the loaders of the files that feature reads.
	const mentions = new Map<string, string[]>();
	const byName = new Map(files.map((file) => [file.file, file]));
	for (const file of files) mentions.set(file.file, file.text.match(/[A-Za-z0-9_.-]+\.js/g) ?? []);
	const namedCache = new Map<string, Set<string>>();
	/** The names of the files that a loader fetches, two steps down its chain of loaders. */
	const named = (loader: BuiltFile): Set<string> => {
		const cached = namedCache.get(loader.file);
		if (cached) return cached;
		const names = new Set<string>();
		const reached = new Set<string>([loader.file]);
		let frontier = [loader.file];
		for (let step = 0; step < 2 && frontier.length > 0; step++) {
			const next: string[] = [];
			for (const file of frontier)
				for (const name of mentions.get(file) ?? []) {
					names.add(name);
					if (!reached.has(name) && byName.has(name)) {
						reached.add(name);
						next.push(name);
					}
				}
			frontier = next;
		}
		namedCache.set(loader.file, names);
		return names;
	};
	// Each part that a loader loads takes a file that the loader names, in the parts' order, and
	// then a file that the loader reaches through the files it names: a feature's loader loads the
	// loaders of the files that the feature reads, as the file loader loads the glTF loader. A
	// round repeats while a loader that was found names the file of a part that waited for it.
	const loaded = parts.filter((part) => part.loadedBy);
	for (let round = 0; round < 4; round++) {
		let foundOne = false;
		for (const part of loaded) {
			if (found.has(part.name)) continue;
			const loader = found.get(part.loadedBy as string);
			if (!loader) continue;
			const claimed = new Set(found.values());
			const direct = new Set(mentions.get(loader.file) ?? []);
			const file = files.find(
				(f) => !claimed.has(f) && holds(f, part.module) && direct.has(f.file),
			);
			if (file) {
				found.set(part.name, file);
				foundOne = true;
			}
		}
		for (const part of loaded) {
			if (found.has(part.name)) continue;
			const loader = found.get(part.loadedBy as string);
			if (!loader) continue;
			const claimed = new Set(found.values());
			const file = files.find(
				(f) => !claimed.has(f) && holds(f, part.module) && named(loader).has(f.file),
			);
			if (file) {
				found.set(part.name, file);
				foundOne = true;
			}
		}
		if (!foundOne) break;
	}
	const claimed = new Set(found.values());
	const shaders = new Map<string, BuiltFile>();
	for (const file of files) {
		const part = claimed.has(file) ? undefined : shaderPartOf(file);
		if (!part) continue;
		if (!shaderParts.includes(part) && !isFirstUseShaderPart(part) && !isCombosPart(part))
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
		if (claimed.has(file) || !file.sources.some((s) => s.startsWith(ENGINE_PACKAGE))) continue;
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
			([part]) => part.startsWith(shaders) && !isFirstUseShaderPart(part) && !isCombosPart(part),
		);
		for (const column of COLUMNS)
			size[column] += Math.max(0, ...shaderSizes.map(([, shader]) => shader[column]));
		return { mode, size };
	});
}

/**
 * The budget for the engine's JavaScript that a page downloads at its start, in whichever thread
 * mode downloads the most. The core's generated glue counts with the WebAssembly files instead.
 * Each column's budget is the owner's, and decision record D-14 holds its figures and approvals.
 * The gzip and raw budgets stop a start that grows on a gzip host, or on a host that sends files as
 * they are. The start's shader file fills most of each column.
 *
 * The owner raised the Brotli figure from 165 KB to 166 KB on 18 October 2026, for the screen-space
 * reflections: their code adds about 1.6 KB of real start code, and the branch sat 50 bytes over
 * the old line. The owner chose the raise over trimming. The owner raised it again to 176 KB the
 * same day, for the still view, the surfaces that let light through and the skin scatter, with the
 * draw probe back in its worker's script: the branch measured 170,517 bytes against 169,984 and the
 * reflection probes still to land add about 1.4 KB. The raise comes with the reclaim the owner asked
 * for: the frame figures behind `measure()` and the error-fix table load on their first use.
 *
 * The owner raised it to 178 KB on 22 October 2026, for the level bias, the canvas textures and the
 * sharpening value, which took the largest start to 181,238 bytes against the old 176 KB line. The
 * trim that pays it back is in hand: the fog write, the picks and the pointer events move to files
 * that load on first use and save about 2.6 KB, which needs the size report to follow the chunks the
 * bundler splits out.
 *
 * The owner gave standing permission to raise it without asking on 22 October 2026. It went to
 * 182 KB the same morning, because the night's work left the largest start at 181,958 bytes, 314
 * bytes under the line, and the next feature would have stopped every build on the machine for as
 * long as a raise waited. The trim above is still owed and still pays it back.
 *
 * The cluster levels' culling pass draws its shader into the start of every page, 2.7 KB after
 * Brotli, although only the WebGPU path builds its pipeline: the measured start moved by 650 bytes
 * and stays inside this budget. The trim it owes is to load that shader on the feature's first use,
 * as a material's shader loads, which returns the whole shader to pages that never draw a cluster
 * tree and keeps WebGL2's start as it was.
 *
 * It went to 186 KB on 23 October 2026, because compute passes and the draws that read the count a
 * GPU writes put their Rust and their glue into every start: WebGL2's pipelined start reached
 * 189,064 bytes, 648 bytes over the old line, and the shader build and every picture run after it
 * stop until the budget names the cost. The trim owed, beyond the cluster shader's, is to load the
 * compute pass and the instance draw's adapter with their first use rather than with the page.
 *
 * It went to 188 KB on 24 October 2026: WebGL2's pipelined start reached 191,594 bytes, 106 bytes
 * over the old line, after that day's landings. A hundred bytes is below the noise of one module's
 * change, so the raise costs less than finding them, and the trims owed above still pay it back.
 *
 * It went to 190 KB on 24 October 2026: WebGL2's pipelined start reached 193,396 bytes, 884 bytes
 * over the old line, for the timed script that hold mode performs. The script's steps and the scene
 * property reads and writes that they use are in the sketch runner, and the page and a script share
 * one writer of input records. The rise leaves 1,164 bytes of room.
 *
 * It went to 191 KB on 25 October 2026: the recording and its replay added 722 bytes after Brotli
 * to the start, for the page's replay switch, the download and check of a recording, and the offer
 * to save one. The day's other landings had already filled most of the room: the base reached
 * 194,126 bytes of the 194,560 line, so the feature landed 288 bytes over. The rise leaves 736
 * bytes.
 *
 * It went to 192 KB the same day, because the 191 KB figure was a local build's against a stale
 * base: CI measured the same commit's pipelined WebGL2 start at 196,106 bytes, 522 over that line,
 * and every run stopped on it. The time of a GPU frame as the span of its passes had also grown the
 * frame figures and the stats overlay. The rise leaves 502 bytes. The start went from 186 KB to
 * 192 KB in two days, and the owner ruled on 25 October 2026 to keep raising the line as needed for
 * now. A trim that wins bytes back runs beside the raises, and no crossing waits for it.
 *
 * It went to 194 KB on 25 October 2026: a local build of the grading work's branch measured
 * WebGL2's pipelined start at 197,411 bytes, 803 bytes over the old line. The grading controls added
 * the switch that picks the table's input and the values that the 8-bit path's shaders read. The
 * rise leaves 1,245 bytes of room.
 */
export const START_BUDGET: Budget = { raw: 3_328 * 1024, gzip: 448 * 1024, brotli: 194 * 1024 };

/**
 * The budget for each part that loads after the start. The Brotli figure rose on 22 October 2026,
 * from 16 KB, because the glTF worker drew the thin film's and the stretched lobe's options, their
 * map slots and their loader notes: it went from 14,737 to 16,832 bytes after Brotli (D-215). The
 * figure is the cap of every file that loads after the start, so the raise loosens each of them by
 * the same kilobyte; no other file is near it.
 */
export const LATER_BUDGET: Budget = { raw: 64 * 1024, gzip: 24 * 1024, brotli: 17 * 1024 };

/**
 * The budget for a generated combination table, whose name holds `-combos`: the list of module
 * addresses for the builds that need several features. The table gains a line set with every
 * combination that a feature's bits can form, so its uncompressed size grows with the engine's
 * features while its compressed figure, which is what a page downloads, stays small. The owner
 * approved this figure on 18 October 2026, for the four tables that the translucency builds grew
 * past 64 KB. The compressed figures date from that approval and did not follow the later
 * raise of [`LATER_BUDGET`], which the glTF worker alone outgrew.
 */
export const COMBOS_BUDGET: Budget = { raw: 96 * 1024, gzip: 24 * 1024, brotli: 16 * 1024 };

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
			`${what} is ${size[column].toLocaleString('en-US')} bytes ${COLUMN_NAMES[column]}, over its ${budget[column] / 1024} KB budget set in tools/lib/size-report.ts`,
	);
}

/**
 * The budget for each device module of a feature that loads on first use. Such a module is shader
 * data, as the modules of the start are. Shader text shrinks far more under compression than code
 * does, so these limits do not keep the start budget's proportions. Only hosts without Brotli meet
 * the gzip limit. Each limit is the owner's, and decision record D-14 holds its figures and
 * approvals.
 *
 * These are the caps of a file that a feature loads on its first use, and not of the JavaScript
 * that a page loads at its start, whose own figures are [`START_BUDGET`]. The raw and Brotli
 * figures rose on 22 October 2026 for the coat and sheen family, which gained iridescence's and
 * anisotropy's code (D-215). That code rides the family's builds, which the largest combinations
 * fill with over a hundred builds: the largest file went from 1,332,440 to 1,752,865 bytes
 * uncompressed and from 39,341 to 49,501 bytes after Brotli. A separate permutation value would
 * have doubled the lit builds instead, past the build budget.
 *
 * The Brotli figure rose to 56 KB on 24 October 2026 for the water add-on (D-14's addendum of that
 * date). Its surface function rides every build of the standard material, and the largest set is
 * 1,204.5 KB uncompressed and 53.3 KB after Brotli, so the add-on's own gate would have failed on a
 * feature that works as the engine's own materials do.
 *
 * The grading controls' code over light, which every WebGL2 tone-map build carries, measured
 * 53,325 bytes in its largest file, the half-precision draw-index tone-map set. That fits inside
 * the line the water add-on set, so it moved no figure.
 */
export const FIRST_USE_SHADER_BUDGET: Budget = {
	raw: 1_792 * 1024,
	gzip: 320 * 1024,
	brotli: 56 * 1024,
};

/**
 * The share of the start budget that a start may reach before the build prints a warning: 97%. A
 * start that passes it has little room for the next feature, so the report names it while the
 * build still passes. The owner asked for this warning in M3-T1.
 */
export const NEAR_BUDGET_SHARE = 0.97;

/**
 * A warning for each start that passes [`NEAR_BUDGET_SHARE`] of its Brotli budget without passing
 * the budget itself, which [`budgetProblems`] reports instead. The warning names the bytes left, so
 * a person can see how much room the next feature has.
 */
export function budgetWarnings(
	sizes: ReadonlyMap<string, SizeEntry>,
	downloads: readonly Download[] = DOWNLOADS,
): string[] {
	const near = Math.floor(START_BUDGET.brotli * NEAR_BUDGET_SHARE);
	return downloadSizes(sizes, downloads).flatMap(({ mode, size }) =>
		size.brotli > near && size.brotli <= START_BUDGET.brotli
			? [
					`the engine JavaScript that a page downloads at its start in ${mode} mode is ${size.brotli.toLocaleString('en-US')} bytes after Brotli, past ${Math.round(NEAR_BUDGET_SHARE * 100)}% of its ${START_BUDGET.brotli / 1024} KB budget, with ${(START_BUDGET.brotli - size.brotli).toLocaleString('en-US')} bytes left`,
				]
			: [],
	);
}

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
			if (!size) return [];
			// A combination table grows with every feature's bit pairs, so it has a raw limit of its
			// own; its compressed figure, which a page downloads, stays within the shared one.
			const budget = name.includes('-combos') ? COMBOS_BUDGET : LATER_BUDGET;
			return overBudget(`js/${name}, which loads after the start,`, size, budget);
		}),
		...[...sizes].flatMap(([name, size]) =>
			isCombosPart(name)
				? overBudget(`js/${name}, which loads after the start,`, size, COMBOS_BUDGET)
				: isFirstUseShaderPart(name)
					? overBudget(
							`js/${name}, the shader builds of a feature that loads on first use,`,
							size,
							FIRST_USE_SHADER_BUDGET,
						)
					: [],
		),
	];
}
