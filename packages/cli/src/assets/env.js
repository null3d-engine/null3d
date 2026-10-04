// null3d assets env: turns an HDR environment image into the engine's environment map. The map is
// one KTX2 file: a cube map of the light, filtered for each roughness level of the engine's
// materials, and nine spherical harmonics coefficients of its diffuse light.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readArguments, UsageError } from '../args.js';
import { counted, shownPath } from '../text.js';
import { ENVIRONMENT_FORMATS, environmentMap } from './formats.js';
import { shownBytes } from './report.js';

/** @import { EnvironmentFormat, EnvironmentSettings } from './formats.js' */

/** The width of the largest faces when the command names none. */
export const DEFAULT_SIZE = 256;

/** The built-in environments that `--builtin` writes. */
export const BUILTINS = /** @type {const} */ (['room']);

/** The key of the map's data in the file's key-value data. */
export const ENVIRONMENT_KEY = 'null3d.environment';

const OPTIONS = /** @type {const} */ ({
	size: { type: 'string', default: String(DEFAULT_SIZE) },
	format: { type: 'string', default: ENVIRONMENT_FORMATS[0] },
	builtin: { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli assets env <input.hdr|input.exr> <output.ktx2> [options]
       bunx @null3d/cli assets env --builtin room <output.ktx2> [options]

Makes an environment map for image-based light from an equirectangular HDR image: a Radiance
(.hdr) or OpenEXR (.exr) file, such as those from Poly Haven. The output is one KTX2 file that
holds a cube map and the diffuse light:

- Level 0 of the cube map holds the image. Each smaller level holds the light that a rougher
  surface reflects, filtered with the GGX distribution of the engine's materials, down to faces of
  8 x 8 texels. The roughness of the levels rises evenly from 0 to 1.
- Nine spherical harmonics coefficients hold the light that diffuse surfaces take.

The same input gives the same bytes on every machine.

Options:
  --size <texels>        The width of the largest faces: a power of 2 from 32 to 2048 (256)
  --format <format>      rgb9e5ufloat, 4 bytes per texel, or rgba16float, 8 bytes per texel
                         (rgb9e5ufloat). Both filter on every GPU the engine supports
  --builtin <name>       Write one of the engine's built-in environments instead of reading an
                         image: ${BUILTINS.join(', ')}`;

/**
 * @typedef {object} EnvArgs
 * @property {{ path: string } | { builtin: string }} source
 * @property {string} output
 * @property {EnvironmentSettings} settings
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {EnvArgs}
 */
export function parseEnvArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	const settings = { size: DEFAULT_SIZE, format: ENVIRONMENT_FORMATS[0] };
	if (values.help) return { source: { path: '' }, output: '', settings, help: true };
	const builtin = values.builtin;
	if (builtin !== undefined && !BUILTINS.includes(/** @type {never} */ (builtin)))
		throw new UsageError(
			`--builtin takes the name of a built-in environment, ${BUILTINS.join(' or ')}, not "${builtin}"`,
		);
	const wanted = builtin === undefined ? 2 : 1;
	if (positionals.length !== wanted)
		throw new UsageError(
			builtin === undefined
				? `it takes an input .hdr or .exr file and an output .ktx2 file, not ${counted(positionals.length, 'argument')}`
				: `with --builtin it takes only an output .ktx2 file, not ${counted(positionals.length, 'argument')}`,
		);
	const size = Number(values.size);
	if (!Number.isInteger(size) || size < 32 || size > 2048 || (size & (size - 1)) !== 0)
		throw new UsageError(
			`--size takes a power of 2 from 32 to 2048, such as 256, not "${values.size}"`,
		);
	const format = /** @type {EnvironmentFormat} */ (values.format);
	if (!ENVIRONMENT_FORMATS.includes(format))
		throw new UsageError(
			`--format takes ${ENVIRONMENT_FORMATS.join(' or ')}, not "${values.format}"`,
		);
	const output = resolve(/** @type {string} */ (positionals[wanted - 1]));
	if (!/\.ktx2$/i.test(output))
		throw new UsageError(`its output must be a .ktx2 file, not ${shownPath(output)}`);
	return {
		source:
			builtin === undefined
				? { path: resolve(/** @type {string} */ (positionals[0])) }
				: { builtin },
		output,
		settings: { size, format },
		help: false,
	};
}

/**
 * @typedef {object} EnvironmentFile
 * @property {number} vkFormat The Vulkan format number: 123 for rgb9e5ufloat, 97 for rgba16float.
 * @property {number} size The width of level 0's faces.
 * @property {{ offset: number, length: number }[]} levels Each level's bytes, level 0 first.
 * @property {number[]} sh The nine coefficients' red, green and blue values, in three.js's order.
 * @property {number[]} roughness Each level's perceptual roughness.
 */

/**
 * The layout and the data of an environment map's KTX2 file.
 *
 * @param {Uint8Array} file
 * @returns {EnvironmentFile}
 */
export function readEnvironment(file) {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const word = (/** @type {number} */ at) => view.getUint32(at, true);
	const long = (/** @type {number} */ at) => Number(view.getBigUint64(at, true));
	const levels = Array.from({ length: word(40) }, (_, i) => ({
		offset: long(80 + 24 * i),
		length: long(88 + 24 * i),
	}));
	let data;
	for (let at = word(56), end = at + word(60); at < end; ) {
		const length = word(at);
		const entry = file.subarray(at + 4, at + 4 + length);
		const split = entry.indexOf(0);
		if (new TextDecoder().decode(entry.subarray(0, split)) === ENVIRONMENT_KEY)
			data = JSON.parse(new TextDecoder().decode(entry.subarray(split + 1, entry.length - 1)));
		at += 4 + length + ((4 - (length % 4)) % 4);
	}
	if (!data) throw new Error(`the file has no ${ENVIRONMENT_KEY} data`);
	return { vkFormat: word(12), size: word(20), levels, sh: data.sh, roughness: data.roughness };
}

/**
 * Runs the command, and returns its exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const { source, output, settings, help } = parseEnvArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	let input;
	if ('path' in source) {
		if (!/\.(hdr|exr)$/i.test(source.path))
			throw new UsageError(`its input must be a .hdr or .exr file, not ${shownPath(source.path)}`);
		try {
			input = { file: new Uint8Array(readFileSync(source.path)) };
		} catch {
			throw new UsageError(`its input ${shownPath(source.path)} does not exist`);
		}
	} else input = source;
	const start = performance.now();
	const name = 'path' in source ? shownPath(source.path) : `the built-in ${source.builtin}`;
	let file;
	try {
		file = environmentMap(input, settings);
	} catch (error) {
		console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, file);
	const { levels, roughness, sh } = readEnvironment(file);
	const gpu = levels.reduce((sum, level) => sum + level.length, 0);
	const average = (/** @type {number} */ c) => (sh[c] ?? 0) * 0.282095;
	console.log(
		[
			`${name} to ${shownPath(output)}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
			`  cube map: ${settings.size} x ${settings.size} faces, ${settings.format}, ${counted(levels.length, 'level')} for roughness ${roughness.map((r) => r.toFixed(2)).join(', ')}`,
			`  file: ${shownBytes(file.byteLength)}; GPU memory: ${shownBytes(gpu)}`,
			`  average light: ${[0, 1, 2].map((c) => average(c).toFixed(3)).join(', ')} (red, green, blue)`,
		].join('\n'),
	);
	return 0;
}
