// The extras: cones and fruit as lathe shapes, flowers as petal cups, thorns and cactus spines as
// spine fans, and catkins, on the bud sites their record names, in the seasons it names. It throws
// until the extras are built.
import type { MeshArrays } from '../asset';
import { notBuilt } from '../core/not-built';
import type { MeshInput, MeshLevel } from '../stages';

/**
 * The extras of one variant at a level, or none when the record has none in this season.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The extras' mesh, or undefined.
 */
export function extrasMesh(input: MeshInput, level: MeshLevel): MeshArrays | undefined {
	if (!input.record.extras?.some((extra) => extra.seasons.includes(input.season))) return undefined;
	void level;
	throw notBuilt('extras');
}
