// The level of detail that a picture records in the manifest. A page that forces a level names
// that level; a plain-background picture draws the level its colour picture draws from the first
// cell, and the shaped plant keeps that level's parts as its nearest band, so the band alone cannot
// name the level the picture shows. Both cases take the source level's name.

/**
 * The level a page read from its plant: the level, its name and the bands' starts. The type is here,
 * not taken from the plant core's render module, so a tool that reads this file's tests does not pull
 * the engine into its own project, as `plant-types.ts` does for the page's types.
 */
export interface DrawnLevel {
	readonly level: 0 | 1 | 2 | 3;
	readonly name: string;
	readonly starts: readonly number[];
}

/** The level names, in level order. */
export const LEVEL_WORDS = [
	'leaf form',
	'first card level',
	'second card level',
	'far card',
] as const;

/** The level a cell's record names, and what a whole-view redraw reads of it. */
export interface CellLevel {
	/** Whether the query forced the level rather than the camera's distance choosing it. */
	readonly forced: boolean;
	/** The level the picture draws. */
	readonly level: 0 | 1 | 2 | 3;
	/** The level in words. */
	readonly name: string;
	/** The distance from the lens to the plant's foot. */
	readonly distance?: number;
	/**
	 * The distance each level starts to draw at, from the source plant. A forced picture posts them
	 * too, so a reader can name the level the engine would draw at its distance.
	 */
	readonly starts?: readonly number[];
}

/** The name of a level, or the far card's for a level past the table. */
export function levelWord(level: number): string {
	return LEVEL_WORDS[level] ?? 'far card';
}

/**
 * The level a cell's picture records.
 *
 * @param drawn The level the cell's own distance draws, with its starts.
 * @param forced The level the query forces, where it forces one.
 * @param source The level a plain-background picture draws from its colour picture's first cell,
 *   where the cell is one.
 * @param distance The distance from the lens to the plant's foot.
 * @returns The level, its name, and the distance and starts that name the level the engine draws.
 */
export function cellLevel(
	drawn: DrawnLevel,
	forced: number | undefined,
	source: number | undefined,
	distance: number,
): CellLevel {
	if (forced !== undefined)
		return {
			forced: true,
			level: forced as CellLevel['level'],
			name: levelWord(forced),
			distance,
			starts: drawn.starts,
		};
	const level = (source ?? drawn.level) as CellLevel['level'];
	return {
		forced: false,
		level,
		name: levelWord(level),
		distance,
		starts: drawn.starts,
	};
}
