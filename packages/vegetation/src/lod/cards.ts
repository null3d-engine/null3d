// The card levels: each shoot row becomes its three-plane card set in the first card level, and the
// second keeps every second and fourth card in space-filling order, each kept card grown by the
// square root of the step. It throws until the cards are built.
import type { MeshArrays } from '../asset';
import { notBuilt } from '../core/not-built';
import type { MeshInput } from '../stages';

/**
 * The shoot cards of one variant at a card level.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns The cards' mesh.
 */
export function cardMesh(input: MeshInput, level: 1 | 2): MeshArrays {
	void input;
	void level;
	throw notBuilt('shoot cards');
}
