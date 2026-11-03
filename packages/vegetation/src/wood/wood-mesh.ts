// The wood mesher: tubes along each axis by parallel transport, rings by curvature and radius, UVs
// in metres that run on from parent to child, welded junctions with collars, the root flare and
// buttresses, and peeling fins. It throws until the wood is built.
import type { MeshArrays } from '../asset';
import { notBuilt } from '../core/not-built';
import type { MeshInput, MeshLevel } from '../stages';

/**
 * The wood of one variant at a level: every axis at the nearest level, fewer orders and fewer sides
 * at the card levels.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The wood's mesh, with UVs in metres of bark.
 */
export function meshWood(input: MeshInput, level: MeshLevel): MeshArrays {
	void input;
	void level;
	throw notBuilt('wood');
}
