// The instancer: a shoot row on each bud site of the finest macro axes, by the record's placement
// and the bud's vigor. It picks the class whose vigor range holds the bud's vigor and a prototype of
// that class by hash, orients it by the bud frame, rolls it by the phyllotaxis, turns its leaves
// toward the sky, bends it by the local tropism and scales it. It throws until the instancer is
// built.
import type { ShootRows } from '../asset';
import { notBuilt } from '../core/not-built';
import type { DressInput } from '../stages';

/**
 * The shoot rows of one variant, before the crown's light gives each its sky visibility.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows.
 */
export function placeShoots(input: DressInput): ShootRows {
	void input;
	throw notBuilt('shoot rows');
}
