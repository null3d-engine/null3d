// The crown's light after the shoots attach: a leaf-density grid splatted from the shoot rows, then
// the sky visibility and bent normal of each row and of the wood's vertices, counted once and on sky
// light only. It throws until the crown light is built.
import type { ShootRows } from '../asset';
import { notBuilt } from '../core/not-built';
import type { CrownLight, DressInput } from '../stages';

/**
 * Lights a variant's crown: writes each shoot row's sky visibility and bent normal in place, and
 * returns the grid that the wood's vertices read.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @param rows The shoot rows, whose `sky` and `bent` it writes.
 * @returns The crown's light.
 */
export function lightCrown(input: DressInput, rows: ShootRows): CrownLight {
	void input;
	void rows;
	throw notBuilt('crown light');
}
