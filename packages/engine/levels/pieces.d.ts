// The types of the pieces planner that the asset tool and the engine share (pieces.js). The
// planner is plain JavaScript, so that Node runs it as it stands in the asset tool.

/** The fewest triangles of one list for it to get pieces whatever draws it. */
export const PIECE_LIST_MIN_TRIANGLES: number;
/** The fewest triangles of a smaller list for it to get facing pieces. */
export const FACING_LIST_MIN_TRIANGLES: number;
/** The fewest triangles that a smaller list's copies hold together for it to get facing pieces. */
export const FACING_DRAWN_MIN_TRIANGLES: number;
/** A list whose triangles face one way by this much lies like a ground or a wall. */
export const ONE_WAY_FACING: number;
/** The facing groups of a smaller list. */
export const FACING_GROUPS: number;
/** The least share of a smaller list's triangles that its cones drop, for it to keep its pieces. */
export const FACING_MIN_SHARE: number;
/** The triangles that one piece aims to hold. */
export const PIECE_TRIANGLES: number;
/** The fewest pieces of one list. */
export const PIECE_MIN: number;
/** The most pieces of one list. */
export const PIECE_MAX: number;
/** The most facing groups of one list: more pieces than this split the groups by space. */
export const PIECE_FACINGS: number;
/** The numbers of each piece's bounds: its sphere's centre and radius, its cone's axis and cutoff. */
export const PIECE_BOUNDS: number;

/** The most triangles of one group of a piece. */
export const GROUP_TRIANGLES: number;
/** The most vertices that one group uses: the most that meshoptimizer's clusterizer takes. */
export const GROUP_VERTICES: number;
/** The fewest triangles of a list with pieces for its pieces to split into groups. */
export const GROUP_LIST_MIN_TRIANGLES: number;
/** How much the clusterizer weighs a group's spread of facings against its size in space. */
export const GROUP_CONE_WEIGHT: number;

/**
 * The groups of a list's pieces: the list's triangles in group order, which keeps each piece's
 * triangles in the piece, and each group's triangles and bounds.
 */
export interface GroupPlan {
	/** The list's triangles, each piece's in the order of its groups. */
	readonly indices: Uint32Array<ArrayBuffer>;
	/**
	 * The triangles of each group, one group after another, piece by piece: the groups of each
	 * piece hold its triangles and no other.
	 */
	readonly counts: Uint8Array<ArrayBuffer>;
	/** `PIECE_BOUNDS` numbers for each group, as a piece's. */
	readonly bounds: Float32Array<ArrayBuffer>;
}

/**
 * Splits a list of triangles into groups of up to `GROUP_TRIANGLES` triangles that lie close
 * together, as meshoptimizer's clusterizer makes them: the same triangles in group order, and the
 * triangles of each group.
 */
export type Clusterize = (
	indices: Uint32Array,
	positions: Float32Array,
) => { indices: Uint32Array; counts: Uint32Array };

/**
 * The groups that meshoptimizer's clusterizer made, from its buffers: `meshlets` holds four
 * numbers for each of `count` groups (where its vertices and its triangles start, its vertices
 * and its triangles), `vertices` the vertices that the groups use, and `triangles` three places in
 * a group's vertices for each triangle.
 */
export function meshletGroups(
	meshlets: ArrayLike<number>,
	vertices: ArrayLike<number>,
	triangles: ArrayLike<number>,
	count: number,
): { indices: Uint32Array; counts: Uint32Array };

/**
 * The groups of the pieces of a list of `GROUP_LIST_MIN_TRIANGLES` triangles or more, or
 * `undefined` for a smaller list. `indices` holds the list in piece order, and `pieces` the
 * triangles of each piece. A group never crosses from one piece into the next.
 */
export function planGroups(
	positions: ArrayLike<number>,
	indices: Uint32Array,
	pieces: ArrayLike<number>,
	clusterize: Clusterize,
): GroupPlan | undefined;

/** The pieces of a triangle list. */
export interface PiecePlan {
	/**
	 * The list's triangles in piece order: triangle `k` of the new list is triangle `order[k]` of
	 * the old one.
	 */
	readonly order: Uint32Array;
	/** The triangles of each piece, one piece after another. */
	readonly counts: Uint32Array;
	/** `PIECE_BOUNDS` numbers for each piece. */
	readonly bounds: Float32Array;
}

/**
 * The pieces that a triangle list of `triangles` triangles should have: none below
 * `PIECE_LIST_MIN_TRIANGLES`, else about one for each `PIECE_TRIANGLES`, within `PIECE_MIN` and
 * `PIECE_MAX`.
 */
export function pieceCount(triangles: number): number;

/**
 * Sorts a triangle list into `count` pieces, or fewer where its facings make fewer groups, with
 * at most `facings` facing groups: one gives pieces by space only. Returns `undefined` for a list
 * that gets none: one of fewer than two triangles that have area.
 */
export function planPieces(
	positions: ArrayLike<number>,
	indices: ArrayLike<number>,
	count: number,
	facings?: number,
): PiecePlan | undefined;

/**
 * True when `copies` copies of a list of `triangles` triangles pay for its facing pieces: a list
 * from `FACING_LIST_MIN_TRIANGLES` up to `PIECE_LIST_MIN_TRIANGLES` whose copies hold
 * `FACING_DRAWN_MIN_TRIANGLES` triangles or more together.
 */
export function facingPiecesPay(triangles: number, copies: number): boolean;

/**
 * The facing pieces of a list from `FACING_LIST_MIN_TRIANGLES` up to `PIECE_LIST_MIN_TRIANGLES`
 * triangles, or `undefined` for a list outside that range or whose cones would drop less than
 * `FACING_MIN_SHARE` of its triangles. The triangles that face between the groups draw in one piece
 * more, which faces every way. The pieces pay only where many copies draw the list
 * (`facingPiecesPay`).
 */
export function facingPieces(
	positions: ArrayLike<number>,
	indices: ArrayLike<number>,
): PiecePlan | undefined;

/**
 * The pieces that a file stores for a triangle list: `pieceCount` pieces for a large list, else
 * `facingPieces`, else none. `facing` is false for a list whose material draws both faces or
 * blends, so a smaller list gets none.
 */
export function listPieces(
	positions: ArrayLike<number>,
	indices: ArrayLike<number>,
	facing?: boolean,
): PiecePlan | undefined;

/**
 * The share of a plan's triangles that its cones drop, over eyes spread evenly around each piece
 * and far from it.
 */
export function coneShare(plan: PiecePlan): number;

/**
 * Each group's share of `count` pieces, by its triangles in `sizes`, at least one: the largest
 * remainders take the pieces left over. Groups past `count` take one each all the same.
 */
export function shareOut(sizes: number[], count: number): number[];

/**
 * The triangles of `indices` in the order of the pieces of `plan`, each piece's triangles in the
 * order that `cacheOrder` gives them for the GPU's vertex cache, which keeps the vertex numbers.
 */
export function piecesInOrder(
	indices: ArrayLike<number>,
	plan: PiecePlan,
	cacheOrder: (indices: Uint32Array) => Uint32Array,
): Uint32Array<ArrayBuffer>;

/** The bounds of one piece that holds the whole triangle list, as `planPieces` bounds each piece. */
export function listBounds(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array;

/**
 * How far a triangle list faces one way: the length of its triangles' facings summed by area, as
 * a share of their area. 1 for a flat list, near 0 for a closed shape.
 */
export function meanFacing(positions: ArrayLike<number>, indices: ArrayLike<number>): number;
