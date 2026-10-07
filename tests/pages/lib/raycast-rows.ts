// What the row raycast sketch posts, for the sketch, its page and the test that reads it.

/** The canvas's size in CSS pixels, which the page fixes and the sketch's three.js twins take. */
export const ROWS_WIDTH = 320;
export const ROWS_HEIGHT = 180;

/** The batches of the scene, in the order of their colors. */
export const ROW_BATCHES = [
	'world sprites',
	'screen sprites',
	'world points',
	'screen points',
	'pixel strip',
	'world segments',
	'pixel loop',
] as const;

/** Each batch's color as the frame shows it: an 8-bit sRGB color with no tone mapping. */
export const ROW_COLORS: readonly (readonly [number, number, number])[] = [
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 255],
	[255, 255, 0],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];

/** A pixel whose rays disagree near an edge, which the drawn frame does not judge. */
export const ROW_PIXEL_EDGE = 254;
/** A pixel whose ray hits nothing. */
export const ROW_PIXEL_NONE = 255;

/** How null3D's raycasts against rows compared with three.js's Raycaster. */
export interface RowRaycastResults {
	/** Rays from the camera through the canvas, compared with Sprite and Line2 twins. */
	cameraRays: number;
	/** Rays from anywhere with three.js's thresholds, compared with Points and Line twins. */
	thresholdRays: number;
	/** Rays that hit a row, in each comparison. */
	rowHits: number;
	/** Rows that each comparison hit, by batch. */
	hitsByBatch: Record<string, number>;
	mismatches: number;
	/** The first mismatches, described. */
	examples: string[];
}

/** Where the test clicks, and what a raycast through that point hits. */
export interface RowTarget {
	batch: string;
	x: number;
	y: number;
	/** The batch and row that a raycast through the point hits. */
	hit: string;
}
