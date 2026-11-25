// The files of a baked impostor atlas, which `bunx @null3d/cli assets impostor` writes from a model:
// a JSON file that describes the bake, and two PNG images that hold its colour and surface atlases.
// The command and `loadImpostorAtlas` share this module, so the writer and the reader agree on one
// format. The module imports nothing from the engine, so the command runs it in Node.
//
// Each PNG holds its atlas upright: the image's top row is the atlas's top row, as the bake's cells
// count from the top left. `loadTexture` puts an image's top row at v = 1 by default, which is
// where `textures.fromData` puts the last row of the bake's own data, so both routes give one
// texture.

import type { OctahedralAtlas } from './octahedral';

/**
 * The `format` field of an impostor atlas file.
 *
 * @category api/impostors
 */
export const IMPOSTOR_FILE_FORMAT = 'null3d-impostor';

/** The version of the impostor atlas file's format that this package reads and writes. */
export const IMPOSTOR_FILE_VERSION = 1;

/**
 * What an impostor atlas file holds: the bake's grid and figures, and the names of its two images.
 *
 * @category api/impostors
 */
export interface ImpostorAtlasFile {
	/** Always `"null3d-impostor"`. */
	readonly format: typeof IMPOSTOR_FILE_FORMAT;
	/** The format's version: 1. */
	readonly version: number;
	/** The cells across and down. */
	readonly atlas: OctahedralAtlas;
	/** The texels on each side of a cell. */
	readonly texels: number;
	/** The colour atlas's PNG file, next to this file: sRGB colour, with the coverage in alpha. */
	readonly color: string;
	/** The surface atlas's PNG file, next to this file: linear normals, depth and coverage. */
	readonly surface: string;
	/** The card's width and height at scale 1, as the bake's `size`. */
	readonly size: readonly [number, number];
	/** How much taller a view's picture is than the card's height, as the bake's `room`. */
	readonly room: number;
	/** The object's depth along a view, in world units, as the bake's `depth`. */
	readonly depth: number;
	/** The object's bounds in its own frame: the smallest corner. */
	readonly min: readonly [number, number, number];
	/** The object's bounds in its own frame: the largest corner. */
	readonly max: readonly [number, number, number];
}

/**
 * The impostor atlas file that `value` holds, checked, or an error that names `name` and the field
 * that is wrong.
 *
 * @param value The parsed JSON.
 * @param name The file's name or address, for the error.
 */
export function checkImpostorFile(value: unknown, name: string): ImpostorAtlasFile {
	const file = value as Partial<ImpostorAtlasFile> | null;
	const fail = (what: string): never => {
		throw new Error(`${name} is not an impostor atlas file: ${what}.`);
	};
	if (file === null || typeof file !== 'object') return fail('it holds no JSON object');
	if (file.format !== IMPOSTOR_FILE_FORMAT)
		return fail(`its format is not "${IMPOSTOR_FILE_FORMAT}"`);
	if (file.version !== IMPOSTOR_FILE_VERSION)
		return fail(
			`its version is ${String(file.version)}, and this package reads version ${IMPOSTOR_FILE_VERSION}. Bake it again with the command of this version`,
		);
	const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1;
	const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
	const triple = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(finite);
	if (!(file.atlas && whole(file.atlas.columns) && whole(file.atlas.rows)))
		return fail('its atlas needs whole numbers of columns and rows');
	if (!whole(file.texels)) return fail('its texels need a whole number from 1');
	if (typeof file.color !== 'string' || typeof file.surface !== 'string')
		return fail('it needs the names of its color and surface images');
	if (!(Array.isArray(file.size) && file.size.length === 2 && file.size.every(finite)))
		return fail('its size needs a width and a height');
	if (!(finite(file.room) && finite(file.depth))) return fail('it needs a room and a depth');
	if (!(triple(file.min) && triple(file.max))) return fail('its bounds need two corners');
	return file as ImpostorAtlasFile;
}
