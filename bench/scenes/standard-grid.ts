// The standard material's grid, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports: spheres over
// metalness, in rows from 0 at the top to 1, and roughness, in columns from 0 to 1, lit by a sun and
// an ambient light. The view, the background and the lights also serve the standard material's
// features test. The environment tests light the same grid with an environment alone.

import { sampleUrl } from '../../tools/lib/sample-url';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels. */
export const GRID_IMAGE = { width: 480, height: 270 } as const;

/** The background, in sRGB. */
export const GRID_BACKGROUND = '#20242a';

/** The perspective camera: its field of view in degrees, its planes, and where it stands and looks. */
export const GRID_CAMERA = {
	fov: 35,
	near: 0.1,
	far: 50,
	position: [0, 0, 12],
	target: [0, 0, 0],
} as const satisfies { fov: number; near: number; far: number; position: Vec3; target: Vec3 };

/** The sun: the way its light travels, its sRGB color and its intensity. */
export const GRID_SUN = {
	direction: [-0.5, -0.7, -1],
	color: '#ffffff',
	intensity: 3,
} as const satisfies { direction: Vec3; color: string; intensity: number };

/** The ambient light. */
export const GRID_AMBIENT = { color: '#ffffff', intensity: 0.4 } as const;

/** The sphere that every cell shows: its radius and its segments around and from pole to pole. */
export const GRID_SPHERE = { radius: 0.62, widthSegments: 48, heightSegments: 24 } as const;

/** The spheres' sRGB color. */
export const GRID_COLOR = '#d8a860';

/** A sphere of the grid: its center, metalness and roughness. */
export interface GridCell {
	position: Vec3;
	metalness: number;
	roughness: number;
}

const ROWS = 3;
const COLUMNS = 5;
/** The distance between the centers of neighboring spheres, in meters. */
const SPACING = 1.5;

/** Five columns of roughness by three rows of metalness, row by row from the top. */
export const GRID_CELLS: readonly GridCell[] = Array.from(
	{ length: ROWS * COLUMNS },
	(_, k): GridCell => {
		const [row, column] = [Math.floor(k / COLUMNS), k % COLUMNS];
		return {
			position: [(column - (COLUMNS - 1) / 2) * SPACING, ((ROWS - 1) / 2 - row) * SPACING, 0],
			metalness: row / (ROWS - 1),
			roughness: column / (COLUMNS - 1),
		};
	},
);

/**
 * The environments that light the grid in its environment tests, with no sun and no ambient light:
 * the room of three.js's `RoomEnvironment`, built in, Poly Haven's Venice Sunset, a Radiance file
 * with a low sun, and Poly Haven's small studio, an OpenEXR file. The asset tool turns a file into
 * an environment map, or the engine reads the file itself and filters it at load.
 */
export const GRID_ENVIRONMENTS = {
	room: { builtin: 'room' },
	venice: { hdr: sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr') },
	studio: { hdr: sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr') },
} as const;

export type GridEnvironmentName = keyof typeof GRID_ENVIRONMENTS;

/**
 * The hemisphere light that the environment test with a hemisphere light adds to the room's light:
 * a blue sky above and a brown ground below, upright.
 */
export const GRID_HEMISPHERE = {
	skyColor: '#9cc8ff',
	groundColor: '#806040',
	intensity: 1,
} as const;

/** The environment's turn in the rotated test: a quarter turn about +Y, as three.js's Euler angles. */
export const GRID_ENVIRONMENT_ROTATION = [0, Math.PI / 2, 0] as const;
