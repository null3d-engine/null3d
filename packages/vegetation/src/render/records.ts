// The records texture's header: one rgba32float data texture per species, 1024 texels wide, whose
// first rows hold the species' constants (leaf optics, texture means, the quantisation box, extras'
// colours, bark tile metres) and the wind field's steady settings, and whose later rows hold every
// variant's wind records. The header is built in the kit stage, in a job worker, so this file holds
// no engine import. It throws until the header is built.
import type { SpeciesBox } from '../core/box';
import { notBuilt } from '../core/not-built';
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';

/**
 * Texels across the records texture.
 *
 * @category api/vegetation
 */
export const RECORDS_WIDTH = 1024;

/**
 * Rows of the records texture that the header takes before the wind records start.
 *
 * @category api/vegetation
 */
export const HEADER_ROWS = 2;

/**
 * The records texture's header rows of a species, four floats a texel.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param box The species box.
 * @returns The header, `HEADER_ROWS` rows of `RECORDS_WIDTH` texels.
 */
export function speciesHeader(
	record: Species,
	manifest: TextureManifest,
	box: SpeciesBox,
): Float32Array {
	void record;
	void manifest;
	void box;
	throw notBuilt('the records header');
}
