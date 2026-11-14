// The surface atlas of an impostor bake: the normal and the depth of every texel of every view,
// beside the colour atlas. The card material reads red and green as the octahedral code of the
// view's normal, blue as the depth from the view's front to its back, and alpha as the coverage.
// It decodes the normal and lights the card with it, so the bake stores the surface instead of
// shading it.

import { type Direction, encodeOctahedral, type OctahedralUv } from './octahedral';

/** The code that `encodeImpostorSurface` fills, kept so that a bake allocates nothing per texel. */
const code: OctahedralUv = [0, 0];

/** The code of an octahedral coordinate, from -1 to 1, as a byte from 0 to 255. */
function byte(value: number): number {
	return Math.max(0, Math.min(255, Math.round((value * 0.5 + 0.5) * 255)));
}

/**
 * Writes the surface atlas's texel for a point of a view: the normal in the view's space, where x
 * and y lie across and up the picture and z points at the viewer, the point's depth from the
 * view's front, 0, to its back, 1, and its coverage. `out` takes the four bytes, and is returned,
 * so a bake writes one buffer without allocating.
 *
 * @category api/impostors
 */
export function encodeImpostorSurface(
	normal: Direction,
	depth: number,
	coverage = 1,
	out: Uint8Array = new Uint8Array(4),
): Uint8Array {
	const uv = encodeOctahedral(normal, code);
	out[0] = byte(uv[0]);
	out[1] = byte(uv[1]);
	out[2] = Math.max(0, Math.min(255, Math.round(depth * 255)));
	out[3] = Math.max(0, Math.min(255, Math.round(coverage * 255)));
	return out;
}
