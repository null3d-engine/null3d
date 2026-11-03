// The card bake: each prototype drawn orthographically onto three planes through its attach point,
// front and back, into the card atlas on the CPU, with colour from the manifest's means and profiles.
// It throws until the bake is built.
import type { CardCell } from '../asset';
import { notBuilt } from '../core/not-built';
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { Detail } from '../core/types';
import type { UncardedPrototype } from '../leaf/shoot';
import type { CardAtlas } from '../stages';

/**
 * Bakes the card atlas of a species' prototypes, and each prototype's cells in it.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param detail The mesh tier, which sets the atlas's size.
 * @param prototypes The prototypes.
 * @returns The atlas, and one cell set per prototype.
 */
export function bakeCards(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	prototypes: readonly UncardedPrototype[],
): { readonly atlas: CardAtlas; readonly cells: readonly CardCell[] } {
	void record;
	void manifest;
	void detail;
	void prototypes;
	throw notBuilt('the card bake');
}
