// The cover grass as a species record gives it: the blade the species grows and the colour its
// upper face reflects. A page passes the pair to `createGrass`, so the ground cover meets a plant
// of that species with the same blade shape and the same green, and the two read as one meadow.
import { color } from '@null3d/engine';
import type { GrassBlade, Species } from '../core/record';

/**
 * A cover grass's blade shape and colour, which `createGrass` takes.
 *
 * @category api/vegetation
 */
export interface GrassCover {
	/** The blades' colour, from the mean reflectance of the species' upper face. */
	readonly color: string;
	/** The species' blade, whose width, profile and tip the cover's blades take. */
	readonly blade: GrassBlade;
}

/**
 * The cover grass's shape and colour as a species record gives them: the blade the species grows,
 * and the colour that its upper face reflects under flat light. A page gives the result to
 * `createGrass`, so a field of cover and a plant of that species meet without a seam.
 *
 * @param record The species' record, which must be a grass with a blade.
 * @returns The colour and the blade to pass to `createGrass`.
 * @category api/vegetation
 */
export function grassCover(record: Species): GrassCover {
	const { foliage } = record;
	if (foliage.kind !== 'grass-blade')
		throw new Error(`the species ${record.id} has no grass blade to cover the ground with`);
	const [r, g, b] = foliage.blade.optics.reflectance;
	return {
		color: `#${channel(r)}${channel(g)}${channel(b)}`,
		blade: foliage.blade,
	};
}

/** One colour channel as two hex digits, from a linear value. */
function channel(linear: number): string {
	const srgb = Math.round(255 * color.linearToSrgb(linear));
	return Math.min(255, Math.max(0, srgb)).toString(16).padStart(2, '0');
}
