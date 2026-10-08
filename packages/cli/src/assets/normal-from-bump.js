// null3d assets normal-from-bump: makes a normal map from a height map, such as a three.js
// material's bump map. The engine reads normal maps, which cost less to draw than bump maps.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readArguments, UsageError } from '../args.js';
import { counted, shownPath } from '../text.js';
import { readHeights } from './image-files.js';
import { MAX_TEXTURE_SIDE } from './images.js';
import { mapFile, mapFormat, normalsFromHeights, readInput, readMaxSide } from './maps.js';
import { shownBytes } from './report.js';

/** The strength of the slopes when the command names none: three.js's default bumpScale. */
export const DEFAULT_SCALE = 1;

const OPTIONS = /** @type {const} */ ({
	scale: { type: 'string', default: String(DEFAULT_SCALE) },
	clamp: { type: 'boolean', default: false },
	'max-texture-size': { type: 'string', default: String(MAX_TEXTURE_SIDE) },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli assets normal-from-bump <height image> <output.ktx2|output.png> [options]

Makes a normal map from a height map, such as a three.js material's bump map: white stands high
and black low. The height map is a PNG, JPEG or TGA image, read from its red channel; a 16-bit
PNG keeps its full depth. The normal map follows glTF: X to the right, Y up the image.

A .ktx2 output is UASTC with every mip level, each side at its nearest power of two, as
assets optimize encodes normal maps. A .png output keeps the height map's size.

Options:
  --scale <number>             The strength of the slopes, as three.js's bumpScale: at 1, a rise
                               of the whole height range per texel tilts the surface 45 degrees
                               (${DEFAULT_SCALE})
  --clamp                      The map does not tile: the edge texels take no neighbors from the
                               opposite edge
  --max-texture-size <pixels>  The largest side of a .ktx2 texture: a power of two up to 2048
                               (2048)`;

/**
 * @typedef {object} BumpArgs
 * @property {string} input
 * @property {string} output
 * @property {'png' | 'ktx2'} format
 * @property {number} scale
 * @property {boolean} wrap
 * @property {number} maxSide
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {BumpArgs}
 */
export function parseBumpArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (values.help)
		return { input: '', output: '', format: 'png', scale: 1, wrap: true, maxSide: 1, help: true };
	if (positionals.length !== 2)
		throw new UsageError(
			`it takes a height image and an output file, not ${counted(positionals.length, 'argument')}`,
		);
	const scale = values.scale.trim() === '' ? Number.NaN : Number(values.scale);
	if (!(Number.isFinite(scale) && scale > 0))
		throw new UsageError(`--scale takes a number above 0, such as 2.5, not "${values.scale}"`);
	const output = resolve(/** @type {string} */ (positionals[1]));
	return {
		input: resolve(/** @type {string} */ (positionals[0])),
		output,
		format: mapFormat(output),
		scale,
		wrap: !values.clamp,
		maxSide: readMaxSide(values['max-texture-size']),
		help: false,
	};
}

/**
 * Runs the command, and returns its exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const { input, output, format, scale, wrap, maxSide, help } = parseBumpArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	const bytes = readInput(input);
	const start = performance.now();
	let heights;
	try {
		heights = readHeights(bytes, input);
	} catch (error) {
		console.error(`${shownPath(input)}: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
	const file = await mapFile(normalsFromHeights(heights, scale, wrap), format, 'normal', maxSide);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, file);
	console.log(
		`${shownPath(input)} to ${shownPath(output)}: ${heights.width} x ${heights.height}, ${format === 'ktx2' ? 'UASTC, ' : ''}${shownBytes(file.byteLength)}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
	);
	return 0;
}
