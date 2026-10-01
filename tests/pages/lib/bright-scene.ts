// A bright scene for the tone mapping tests, defined once for null3D and three.js: a grid of flat
// tiles that face the camera, lit straight on by a strong sun. Each row has one hue, and each
// column a darker or lighter albedo, so the tiles' linear colors run from about 0.2 to 16, from the
// curves' dark end to far past white. Everything here is plain data with no engine imports.

/** The tone mappings the tests draw, by their null3D names. */
export const TONE_MAPPINGS = ['aces', 'agx', 'neutral', 'none'] as const;
export type BrightToneMapping = (typeof TONE_MAPPINGS)[number];

/**
 * The two exposures the tests draw at, in stops: the exposure is 2 to the power of the stops. The
 * pages take stops because a module address whose query holds a dot, such as exposure=0.5, reaches
 * Vite's transform with the value's end as the file's extension.
 */
export const STOPS = [0, -1] as const;

/** The exposure of a number of stops. */
export const exposureOf = (stops: number) => 2 ** stops;

/** The image's size in pixels, which is the image test manifest's default. */
export const SIZE = [320, 180] as const;

/** The linear color of each row's brightest tile. */
const HUES: readonly (readonly [number, number, number])[] = [
	[1, 1, 1],
	[1, 0.05, 0.02],
	[0.05, 1, 0.1],
	[0.05, 0.15, 1],
];
/** Each column's share of its row's color, from dark to bright. */
const SHADES = [0.01, 0.03, 0.1, 0.3, 0.6, 1] as const;

/** The side of a tile and the gap between tiles, in world units. */
const TILE = 1;
const GAP = 0.2;
/** Tiles are thin boxes, so their sides do not show. */
const THICKNESS = 0.01;

/** The sun shines straight into the tiles, from the camera's side. */
export const SUN = { direction: [0, 0, -1] as const, intensity: 50 };
/** The background, an sRGB hex color. */
export const BACKGROUND = '#203040';
/** A perspective camera on the z axis, looking at the grid's center. */
export const CAMERA = { fov: 30, near: 0.1, far: 100, position: [0, 0, 10] as const };

export interface Tile {
	/** The tile's center in world units. */
	position: [number, number, number];
	/** The box's size: width, height and thickness. */
	size: [number, number, number];
	/** The linear albedo. */
	color: [number, number, number];
}

/** Every tile, row by row from the top, each row from the darkest tile to the brightest. */
export function tiles(): Tile[] {
	const columns = SHADES.length;
	const rows = HUES.length;
	const step = TILE + GAP;
	return HUES.flatMap((hue, row) =>
		SHADES.map((shade, column) => ({
			position: [(column - (columns - 1) / 2) * step, ((rows - 1) / 2 - row) * step, 0],
			size: [TILE, TILE, THICKNESS],
			color: [hue[0] * shade, hue[1] * shade, hue[2] * shade],
		})),
	);
}

/**
 * The pixel at the center of each tile in the image, in the order of `tiles()`, from the camera's
 * projection of each tile's center.
 */
export function tileCenters(): [number, number][] {
	const [width, height] = SIZE;
	const halfHeight = Math.tan(((CAMERA.fov / 2) * Math.PI) / 180);
	const distance = CAMERA.position[2];
	return tiles().map(({ position: [x, y] }) => [
		Math.round(width / 2 + ((x / distance / halfHeight) * height) / 2),
		Math.round(height / 2 - ((y / distance / halfHeight) * height) / 2),
	]);
}
