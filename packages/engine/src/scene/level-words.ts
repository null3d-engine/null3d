// What the level planner's start in the sketch's thread (scene/mesh-levels.ts) and its task on a
// job worker (scene/levels-task.ts) share: the names of meshoptimizer's modules, and the layout of
// a mesh's words as the sketch's thread reads them from the core (`readPlanningPart`). A file of
// its own, so that neither side's code loads with the other's.

import { VERTEX_ATTRIBUTES } from '../generated/gpu';

/** The simplifier's module. */
export const SIMPLIFIER_MODULE = 'meshopt-simplifier';
/** The encoder's module, whose vertex cache order the planner runs. */
export const ENCODER_MODULE = 'meshopt-encoder';
/** The clusterizer's module, which splits the pieces of a large list into groups. */
export const CLUSTERIZER_MODULE = 'meshopt-clusterizer';

/**
 * The vertex shader location and the floats of each attribute that the planner reads, in the
 * order of the words: the position, the normal, the first and second texture coordinates, the
 * tangent and the color.
 */
export const PLANNED_ATTRIBUTES: readonly (readonly [location: number, floats: number])[] = [
	[0, 3],
	[1, 3],
	[2, 2],
	[3, 2],
	[4, 4],
	[5, 4],
];

/**
 * The most parts of a split mesh whose vertices note the parts that hold them, one bit a part in
 * a 32-bit word. The lists of a mesh of more parts get no pieces.
 */
export const MAX_MASKED_PARTS = 32;

/** True for a format that holds the attribute at `location`. Positions and normals it always does. */
export function holdsAttribute(format: number, location: number): boolean {
	const bit = VERTEX_ATTRIBUTES[location]?.[0] ?? 0;
	return bit === 0 || (format & bit) !== 0;
}
