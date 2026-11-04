// The types of the level planner that the asset tool and the engine share (planner.js). The
// planner is plain JavaScript, so that Node runs it as it stands in the asset tool.

/** A flag of meshoptimizer's simplifier, by the name that its package takes. */
export type SimplifierFlag =
	| 'LockBorder'
	| 'Sparse'
	| 'ErrorAbsolute'
	| 'Prune'
	| 'Regularize'
	| 'Permissive';

/**
 * The calls of meshoptimizer's simplifier that the planner makes, with the arguments of the
 * `meshoptimizer` package's `MeshoptSimplifier.simplifyWithAttributes`, and the reorder of a
 * level's triangles for the GPU's vertex cache.
 */
export interface Meshopt {
	simplifyWithAttributes(
		indices: Uint32Array,
		positions: Float32Array,
		positionsStride: number,
		attributes: Float32Array,
		attributesStride: number,
		weights: number[],
		lock: Uint8Array | null,
		target: number,
		error: number,
		flags: SimplifierFlag[],
	): [Uint32Array, number];
	/** The triangles in the order that meshoptimizer's `optimizeVertexCache` gives them. */
	cacheOrder(indices: Uint32Array): Uint32Array;
}

/** A vertex stream as floats in the mesh's units: `size` values per vertex. */
export interface Stream {
	values: Float32Array;
	size: number;
}

/** A triangle list's vertices and triangles as the planner reads them, in floats. */
export interface ListStreams {
	positions: Float32Array;
	normal: Stream | null;
	color: Stream | null;
	tangent: Stream | null;
	texcoords: Stream[];
	/** The list's triangles, which welding renames in place. */
	indices: Uint32Array;
}

/** A card: a separate piece of a list, such as a leaf's quad. */
export interface Card {
	vertices: number[];
	triangles: number[];
	centre: number[];
	size: number;
}

/** A triangle list as the simplifier plans it. */
export interface PlanningList {
	positions: Float32Array;
	attributes: Float32Array;
	stride: number;
	weights: number[];
	seams: Uint8Array;
	indices: Uint32Array;
	cards: Card[] | null;
	posed: boolean;
}

/** One lower level of a mesh. */
export interface PlannedLevel {
	/** The level's triangles for each list, naming the list's own vertices. */
	indices: Uint32Array[];
	/** The positions of a list whose vertices the step moved, as a level of cards does. */
	positions: (Float32Array | undefined)[];
	/** The largest distance between the level's surface and the full mesh's. */
	error: number;
	triangles: number;
}

export const LOD_MIN_TRIANGLES: number;
export const LOD_STEP: number;
export const LOD_FLOOR_TRIANGLES: number;
export const LOD_MAX_LEVELS: number;

export function longestSide(positions: Float32Array, indices?: Uint32Array): number;
export function weldList(
	streams: ListStreams,
	posed?: boolean,
	side?: number,
	cards?: boolean,
): PlanningList;
export function simplifierFlags(bends: boolean): SimplifierFlag[];
export function simplifyStep(
	meshopt: Meshopt,
	lists: PlanningList[],
	from: Uint32Array[],
	share: number,
	limit: number,
	flags: SimplifierFlag[],
	every?: number,
): {
	indices: Uint32Array[];
	positions: (Float32Array | undefined)[];
	error: number;
	triangles: number;
};
export function simplifyTries(
	meshopt: Meshopt,
	list: PlanningList,
	indices: Uint32Array,
	share: number,
	limit: number,
	flags: SimplifierFlag[],
	locks?: [Uint8Array | null, Uint8Array | null],
): [Uint32Array, number] | undefined;
export function planMeshLevels(
	meshopt: Meshopt,
	lists: PlanningList[],
	total: number,
	side: number,
	flags: SimplifierFlag[],
	maxLevels?: number,
): PlannedLevel[];
