// Quantisation: each part's floats into 16-bit positions inside the species box, 8-bit normals,
// plain 16-bit UVs and 8-bit colours. It throws until quantisation is built.
import type { MeshArrays, QuantisedArrays } from '../asset';
import type { SpeciesBox } from '../core/box';
import { notBuilt } from '../core/not-built';

/**
 * Steps of a wood UV per metre of bark.
 *
 * @category api/vegetation
 */
export const WOOD_UV_STEPS = 1024;

/**
 * Steps of a leaf or card UV across the texture.
 *
 * @category api/vegetation
 */
export const TEXTURE_UV_STEPS = 65535;

/**
 * One part's arrays, quantised against the species box.
 *
 * @param arrays The part's floats.
 * @param box The species box.
 * @param uvSteps Steps per unit of the part's UVs: `WOOD_UV_STEPS` or `TEXTURE_UV_STEPS`.
 * @returns The quantised arrays.
 */
export function quantise(arrays: MeshArrays, box: SpeciesBox, uvSteps: number): QuantisedArrays {
	void arrays;
	void box;
	void uvSteps;
	throw notBuilt('quantisation');
}
