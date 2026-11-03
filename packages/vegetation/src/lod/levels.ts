// The level switches: the distance at which each level starts, from the record's switch pixels at a
// reference view. A page turns the same pixels into its own distances from its render height and
// field of view. It throws until the levels are built.
import { notBuilt } from '../core/not-built';
import type { MeshInput } from '../stages';

/**
 * The view the asset's level distances are measured for: a 1080-pixel render at 60 degrees.
 *
 * @category api/vegetation
 */
export const REFERENCE_VIEW = { height: 1080, fov: 60 } as const;

/**
 * Metres at which the first card level, the second card level and the impostor start, at the
 * reference view.
 *
 * @param input The dressed variant.
 * @returns The three distances.
 */
export function levelStarts(input: MeshInput): readonly [number, number, number] {
	void input;
	throw notBuilt('level distances');
}
