// null3d assets optimize: optimizes glTF models for the engine. Each model becomes one binary glTF
// file with quantized, reordered meshes, compressed with meshopt by default, and its textures
// become KTX2 files in a folder beside it. It prints a budget report for each model.
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readArguments, UsageError } from '../args.js';
import { counted, shownPath } from '../text.js';
import { defaultJobs, encodeOnce, encoderPool } from './encoder-pool.js';
import { MAX_TEXTURE_SIDE } from './images.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';
import { reportLines, shownBytes } from './report.js';
import { TEXTURE_FOLDER } from './textures.js';

/** @import { OptimizeOptions } from './pipeline.js' */
/** @import { ModelReport } from './report.js' */

const OPTIONS = /** @type {const} */ ({
	lod: { type: 'boolean', default: false },
	simplify: { type: 'string', default: String(DEFAULT_OPTIONS.simplify) },
	'simplify-error': { type: 'string', default: String(DEFAULT_OPTIONS.simplifyError) },
	'max-texture-size': { type: 'string', default: String(MAX_TEXTURE_SIDE) },
	'texture-quality': { type: 'string', default: DEFAULT_OPTIONS.textureQuality },
	compression: { type: 'string', default: DEFAULT_OPTIONS.meshopt ? 'meshopt' : 'none' },
	'no-blockers': { type: 'boolean', default: false },
	bvh: { type: 'string', default: String(DEFAULT_OPTIONS.bvh) },
	jobs: { type: 'string' },
	report: { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli assets optimize <input> <output folder> [options]

Optimizes glTF models for the engine. The input is a .glb or .gltf file, or a folder, whose .glb
and .gltf files it takes with those in its subfolders. Each model becomes one .glb file in the
output folder, at the place it had in the input folder. Its textures become KTX2 files in the
output folder's textures folder, named by their contents, so models that share a texture share
its file.

Meshes: equal meshes, materials and textures merged into one, vertices reordered for the GPU's
vertex cache, then stored as 8-bit and 16-bit integers (KHR_mesh_quantization).
Clips: keys at the rate the engine keeps them, 16-bit rotations, one key for a track that never
changes, so the engine copies them at load. No key or track is dropped.
Textures: PNG and JPEG images encoded to KTX2 with every mip level, each side at its nearest
power of two. Normal maps take UASTC; color and data maps take ETC1S, or UASTC with
--texture-quality high. Every texture encodes on its own worker thread, and the same input gives
the same bytes on every machine.

Options:
  --lod                        Add levels of detail to meshes of 64 triangles or more, each
                               with about half the triangles of the level above, and store each
                               level's error for the engine to pick by (MSFT_lod)
  --simplify <share>           Keep this share of each mesh's triangles, from 0 to 1, as far as
                               --simplify-error allows (1)
  --simplify-error <share>     The most that --simplify may move the surface, as a share of each
                               mesh's size (0.01)
  --max-texture-size <pixels>  The largest side of a texture: a power of two up to 2048 (2048)
  --texture-quality <size|high> ETC1S for color and data maps, or UASTC, several times
                               larger with less loss (size)
  --compression <none|meshopt> Compress the file's buffers with meshopt
                               (EXT_meshopt_compression), or leave them as they are (meshopt)
  --no-blockers                Give no mesh a blocker for software occlusion culling
                               (NULL3D_occluder)
  --bvh <triangles>            Store the tree that raycasts walk for each mesh part of at least
                               this many triangles, or for none with 0 (NULL3D_mesh_bvh) (20000)
  --jobs <count>               The worker threads that encode textures (one per CPU core)
  --report <file.json>         Also write the budget report as a JSON file`;

/**
 * @typedef {object} OptimizeArgs
 * @property {string} input
 * @property {string} output
 * @property {Omit<OptimizeOptions, 'textureFolder'>} options
 * @property {number} jobs
 * @property {string} [report]
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {OptimizeArgs}
 */
export function parseOptimizeArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	const help = values.help;
	if (help) return { input: '', output: '', options: DEFAULT_OPTIONS, jobs: 1, help };
	if (positionals.length !== 2)
		throw new UsageError(
			`it takes an input file or folder and an output folder, not ${counted(positionals.length, 'argument')}`,
		);
	const side = Number(values['max-texture-size']);
	if (!Number.isInteger(side) || side < 1 || side > MAX_TEXTURE_SIDE || (side & (side - 1)) !== 0)
		throw new UsageError(
			`--max-texture-size takes a power of two from 1 to ${MAX_TEXTURE_SIDE}, such as 1024, not "${values['max-texture-size']}"`,
		);
	const quality = values['texture-quality'];
	if (quality !== 'size' && quality !== 'high')
		throw new UsageError(`--texture-quality takes size or high, not "${quality}"`);
	const compression = values.compression;
	if (compression !== 'none' && compression !== 'meshopt')
		throw new UsageError(`--compression takes none or meshopt, not "${compression}"`);
	const simplify = Number(values.simplify);
	if (!(simplify > 0 && simplify <= 1))
		throw new UsageError(
			`--simplify takes a share of the triangles above 0 and up to 1, such as 0.5, not "${values.simplify}"`,
		);
	const simplifyError = Number(values['simplify-error']);
	if (!(simplifyError >= 0 && simplifyError <= 1))
		throw new UsageError(
			`--simplify-error takes a share of a mesh's size from 0 to 1, such as 0.05, not "${values['simplify-error']}"`,
		);
	const bvh = Number(values.bvh);
	if (!Number.isInteger(bvh) || bvh < 0)
		throw new UsageError(
			`--bvh takes a whole number of triangles from 0, such as 5000, not "${values.bvh}"`,
		);
	const jobs = values.jobs === undefined ? defaultJobs() : Number(values.jobs);
	if (!Number.isInteger(jobs) || jobs < 1)
		throw new UsageError(`--jobs takes a whole number from 1, such as 4, not "${values.jobs}"`);
	if (values.report !== undefined && !/\.json$/i.test(values.report))
		throw new UsageError(`--report must name a .json file, not "${values.report}"`);
	return {
		input: resolve(/** @type {string} */ (positionals[0])),
		output: resolve(/** @type {string} */ (positionals[1])),
		options: {
			lod: values.lod,
			simplify,
			simplifyError,
			maxTextureSize: side,
			textureQuality: quality,
			meshopt: compression === 'meshopt',
			blockers: !values['no-blockers'],
			bvh,
		},
		jobs,
		...(values.report !== undefined && { report: resolve(values.report) }),
		help,
	};
}

/** True for a glTF file's name. */
const MODEL_FILE = /\.(glb|gltf)$/i;

/**
 * The models to optimize: the input file, or every model file in the input folder and its
 * subfolders, in name order, each with its path from the folder. Files in the output folder stay
 * out, so a second run into a folder inside the input does not take its own output.
 *
 * @param {string} input
 * @param {string} output
 * @returns {{ path: string, place: string }[]}
 */
export function findModels(input, output) {
	let stats;
	try {
		stats = statSync(input);
	} catch {
		throw new UsageError(`its input ${shownPath(input)} does not exist`);
	}
	if (stats.isFile()) {
		if (!MODEL_FILE.test(input))
			throw new UsageError(
				`its input must be a .glb or .gltf file, or a folder, not ${shownPath(input)}`,
			);
		return [{ path: input, place: basename(input) }];
	}
	const models = readdirSync(input, { recursive: true, encoding: 'utf8' })
		.filter((name) => MODEL_FILE.test(name))
		.map((name) => ({ path: join(input, name), place: name }))
		.filter(({ path }) => !path.startsWith(output + sep))
		.sort((a, b) => (a.place < b.place ? -1 : a.place > b.place ? 1 : 0));
	if (models.length === 0)
		throw new UsageError(`its input folder ${shownPath(input)} has no .glb or .gltf file`);
	return models;
}

/**
 * Runs the command, and returns its exit code. Several models optimize at once, as many as the
 * encoder has threads, so a model with few textures leaves no thread idle.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const { input, output, options, jobs, report, help } = parseOptimizeArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	const models = findModels(input, output);
	const textures = join(output, TEXTURE_FOLDER);
	const pool = encoderPool(jobs);
	const encode = encodeOnce((job) => pool.encode(job));
	/** @type {(ModelReport | undefined)[]} */
	const reports = [];
	/** @type {Map<string, number>} */
	const written = new Map();
	let next = 0;
	const start = performance.now();
	const worker = async () => {
		for (let k = next++; k < models.length; k = next++) {
			const { path, place } = /** @type {{ path: string, place: string }} */ (models[k]);
			const out = join(output, `${place.slice(0, -extname(place).length)}.glb`);
			const folder = relative(dirname(out), textures).split(sep).join('/');
			try {
				const model = await optimizeModel(path, { ...options, textureFolder: folder }, encode);
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, model.glb);
				written.set(out, model.glb.byteLength);
				if (model.files.size > 0) mkdirSync(textures, { recursive: true });
				for (const [name, bytes] of model.files) {
					writeFileSync(join(textures, name), bytes);
					written.set(join(textures, name), bytes.byteLength);
				}
				reports[k] = model.report;
				console.log(reportLines(model.report).join('\n'));
			} catch (error) {
				console.error(
					`${shownPath(path)}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(jobs, models.length) }, worker));
	} finally {
		await pool.close();
	}
	const done = /** @type {ModelReport[]} */ (reports.filter((r) => r !== undefined));
	if (models.length > 1) {
		const inputBytes = done.reduce((sum, r) => sum + r.inputBytes, 0);
		const outputBytes = [...written.values()].reduce((sum, bytes) => sum + bytes, 0);
		console.log(
			`${counted(done.length, 'model')}: ${shownBytes(inputBytes)} to ${shownBytes(outputBytes)} in ${shownPath(output)}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
		);
	}
	if (report) {
		mkdirSync(dirname(report), { recursive: true });
		writeFileSync(report, `${JSON.stringify({ options, models: done }, null, '\t')}\n`);
	}
	const failed = models.length - done.length;
	if (failed > 0) console.error(`${counted(failed, 'model')} failed`);
	return failed > 0 ? 1 : 0;
}
