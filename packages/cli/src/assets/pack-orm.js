// null3d assets pack-orm: packs occlusion, roughness and metalness maps into one texture, in the
// channels where glTF reads them: occlusion in red, roughness in green and metalness in blue. A
// material then reads the one texture as its metal-rough map and as its occlusion map.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readArguments, UsageError } from '../args.js';
import { counted, shownPath } from '../text.js';
import { readPixels } from './image-files.js';
import { MAX_TEXTURE_SIDE } from './images.js';
import { mapFile, mapFormat, packChannels, packedSize, readInput, readMaxSide } from './maps.js';
import { shownBytes } from './report.js';

/** @import { Pixels } from './images.js' */
/** @import { ChannelSource } from './maps.js' */

const OPTIONS = /** @type {const} */ ({
	occlusion: { type: 'string' },
	roughness: { type: 'string' },
	metalness: { type: 'string' },
	'max-texture-size': { type: 'string', default: String(MAX_TEXTURE_SIDE) },
	help: { type: 'boolean', short: 'h', default: false },
});

/** The maps in channel order, and the value of each that a command leaves out. */
const CHANNELS = /** @type {const} */ ([
	['occlusion', 255],
	['roughness', 255],
	['metalness', 0],
]);

export const HELP = `Usage: bunx @null3d/cli assets pack-orm <output.ktx2|output.png> [maps] [options]

Packs an occlusion map, a roughness map and a metalness map into one texture, in the channels
where glTF reads them: occlusion in red, roughness in green and metalness in blue. A material
reads the texture as its metal-rough map, and as its occlusion map when it has one. Each map is a
PNG, JPEG or TGA image, read from its red channel, as gray maps hold their values. The texture
takes the size of the largest map, and the others stretch to it, so the maps must have one shape.

A .ktx2 output is UASTC with every mip level, each side at its nearest power of two, as
assets optimize encodes data maps. A .png output keeps the size of the largest map.

Maps (at least one):
  --occlusion <image>          Light that reaches each point, white for all. Without it: white
  --roughness <image>          White for rough. Without it: white, so the material's roughness
                               applies as it is
  --metalness <image>          White for metal. Without it: black, for no metal

Options:
  --max-texture-size <pixels>  The largest side of a .ktx2 texture: a power of two up to 2048
                               (2048)`;

/**
 * @typedef {object} PackArgs
 * @property {Partial<Record<'occlusion' | 'roughness' | 'metalness', string>>} maps
 * @property {string} output
 * @property {'png' | 'ktx2'} format
 * @property {number} maxSide
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {PackArgs}
 */
export function parsePackArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (values.help) return { maps: {}, output: '', format: 'png', maxSide: 1, help: true };
	if (positionals.length !== 1)
		throw new UsageError(
			`it takes one output file, and the maps as options, not ${counted(positionals.length, 'argument')}`,
		);
	/** @type {PackArgs['maps']} */
	const maps = {};
	for (const [name] of CHANNELS) {
		const path = values[name];
		if (path !== undefined) maps[name] = resolve(path);
	}
	if (Object.keys(maps).length === 0)
		throw new UsageError('it needs at least one of --occlusion, --roughness and --metalness');
	const output = resolve(/** @type {string} */ (positionals[0]));
	return {
		maps,
		output,
		format: mapFormat(output),
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
	const { maps, output, format, maxSide, help } = parsePackArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	const start = performance.now();
	/** @type {Pixels[]} */
	const images = [];
	/** @type {ChannelSource[]} */
	const channels = [];
	for (const [name, value] of CHANNELS) {
		const path = maps[name];
		if (path === undefined) {
			channels.push({ value });
			continue;
		}
		const bytes = readInput(path);
		try {
			const image = readPixels(bytes, path);
			images.push(image);
			channels.push({ image });
		} catch (error) {
			console.error(
				`${shownPath(path)}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	}
	const [width, height] = packedSize(channels);
	for (const image of images)
		if (Math.abs(image.width * height - image.height * width) > Math.max(width, height))
			throw new UsageError(
				`its maps must have one shape, but one is ${image.width} x ${image.height} and the largest ${width} x ${height}`,
			);
	const packed = packChannels(
		/** @type {[ChannelSource, ChannelSource, ChannelSource]} */ (channels),
	);
	const file = await mapFile(packed, format, 'data', maxSide);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, file);
	const named = CHANNELS.filter(([name]) => maps[name] !== undefined).map(([name]) => name);
	console.log(
		`${named.join(', ')} to ${shownPath(output)}: ${format === 'ktx2' ? 'UASTC, ' : ''}${shownBytes(file.byteLength)}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
	);
	return 0;
}
