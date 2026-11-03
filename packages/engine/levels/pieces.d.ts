// The types of the pieces planner that the asset tool and the engine share (pieces.js). The
// planner is plain JavaScript, so that Node runs it as it stands in the asset tool.

/** The fewest triangles of one list for it to get pieces. */
export const PIECE_LIST_MIN_TRIANGLES: number;
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
