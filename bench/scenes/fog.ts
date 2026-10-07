// The fog's scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares the linear and exponential squared images with. It is plain data with no
// engine imports: rows of towers on a floor that runs away from the camera, lit and unlit, in fog.
// Two towers far down the floor turn fog off in their materials, so they keep their colors there.
// The background has the fog's color, as scenes with fog usually have, so far objects fade into it.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const FOG_IMAGE = PARITY_CANVAS;

/** The perspective camera: where it stands, the point it looks at, and its lens. */
export const FOG_CAMERA = {
	position: [0, 7, 14],
	target: [0, 0, -30],
	fov: 60,
	near: 0.1,
	far: 200,
} as const satisfies { position: Vec3; target: Vec3; fov: number; near: number; far: number };

/** The fog's sRGB color, which the background has too. */
export const FOG_COLOR = '#b8c4d0';

/**
 * Each fog that the scene draws, by the name of the `?fog=` switch, as `scene.setFog`'s options.
 * Linear and exponential squared fog are what a port of three.js's `Fog(color, 10, 70)` and
 * `FogExp2(color, 0.03)` sets. Height fog lies thick on the floor and thins up the towers. The sun
 * fog glows toward a low sun ahead of the camera.
 */
export const FOG_SETTINGS = {
	linear: { curve: 'linear', color: FOG_COLOR, near: 10, far: 70 },
	exp2: { curve: 'exp2', color: FOG_COLOR, density: 0.03 },
	exponential: { color: FOG_COLOR, density: 0.04 },
	height: { color: FOG_COLOR, density: 0.1, height: 0, heightFalloff: 0.5 },
	sun: { color: FOG_COLOR, density: 0.04, sunGlow: 0.3, sunGlowExponent: 8 },
} as const;

export type FogName = keyof typeof FOG_SETTINGS;

/** The fogs that three.js's twin draws too, with its `Fog` and `FogExp2`. */
export const TWIN_FOGS = ['linear', 'exp2'] as const satisfies readonly FogName[];

/**
 * The direction that the sun's light travels in the sun fog's image: from a low sun ahead of the
 * camera and to its left, toward the camera.
 */
export const FOG_SUN_DIRECTION = [0.3, -0.25, 1] as const;

/**
 * A box: its size along x, y and z, its center, its sRGB color, whether lights shade it, and
 * whether it takes the fog.
 */
export interface FogBox {
	size: Vec3;
	position: Vec3;
	color: string;
	lit: boolean;
	fog: boolean;
}

const COLORS = ['#e8554e', '#f2c14e', '#4a8cff', '#5bc27a', '#b06ce0'] as const;
/** Where the towers' columns stand along x. */
const COLUMNS = [-9, -4, 4, 9] as const;
/** Rows of towers, and the space between two rows. */
const ROWS = 12;
const SPACING = 8;

/**
 * The floor, and rows of towers from in front of the camera to 88 m away, lit and unlit in turn.
 * Two towers between the columns take no fog.
 */
export const FOG_BOXES: readonly FogBox[] = [
	{ size: [30, 0.5, 120], position: [0, -0.25, -45], color: '#8a8f99', lit: true, fog: true },
	...Array.from({ length: ROWS * COLUMNS.length }, (_, k): FogBox => {
		const column = k % COLUMNS.length;
		const row = Math.floor(k / COLUMNS.length);
		return {
			size: [1.5, 3, 1.5],
			position: [COLUMNS[column] as number, 1.5, -row * SPACING],
			color: COLORS[k % COLORS.length] as string,
			lit: (row + column) % 2 === 0,
			fog: true,
		};
	}),
	{ size: [2, 6, 2], position: [-1.5, 3, -44], color: '#e8554e', lit: true, fog: false },
	{ size: [2, 5, 2], position: [1.5, 2.5, -68], color: '#4a8cff', lit: false, fog: false },
];

/** The object count that each engine's page reports. */
export const FOG_COUNT = FOG_BOXES.length;
