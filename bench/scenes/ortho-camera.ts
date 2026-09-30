// The orthographic camera's scene, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports: towers on a
// floor slab, seen from above at an angle, as isometric games show their worlds. A row of equal
// cubes runs away from the camera, and every cube keeps its size in the image. The near plane cuts
// the front corner of the slab, and the far plane cuts the bar at the back, so the image also
// shows where depth starts and ends.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const ORTHO_IMAGE = PARITY_CANVAS;

/**
 * The camera: where it stands, the point it looks at, the height of its view in world units, and
 * its near and far planes. The view's width follows the image's aspect ratio.
 */
export const ORTHO_CAMERA = {
	position: [12, 10, 12],
	target: [0, 1, 0],
	height: 10,
	near: 14.5,
	far: 27,
} as const satisfies {
	position: Vec3;
	target: Vec3;
	height: number;
	near: number;
	far: number;
};

/** A box: its size along x, y and z, its center, its sRGB color, and whether lights shade it. */
export interface OrthoBox {
	size: Vec3;
	position: Vec3;
	color: string;
	lit: boolean;
}

/** The slab, the towers and the bar at the back. */
export const ORTHO_BOXES: readonly OrthoBox[] = [
	{ size: [10, 0.5, 10], position: [0, -0.25, 0], color: '#8a8f99', lit: true },
	{ size: [1.5, 3, 1.5], position: [-2.5, 1.5, 1.5], color: '#e8554e', lit: true },
	{ size: [1.5, 1.5, 1.5], position: [1.5, 0.75, -2], color: '#f2c14e', lit: true },
	{ size: [1, 2, 1], position: [2.5, 1, 2.5], color: '#4a8cff', lit: false },
	{ size: [2, 4, 1], position: [-1, 2, -3], color: '#5bc27a', lit: true },
	{ size: [16, 0.6, 0.6], position: [-4, 0.3, -4.6], color: '#f2c14e', lit: true },
];

/** The edge of each cube in the row, which one static instance batch draws. */
export const ORTHO_CUBE_SIZE = 0.6;
/** The cubes' color. */
export const ORTHO_CUBE_COLOR = '#b06ce0';
/**
 * The cubes' centers: a row along the front of the slab that runs away from the camera, in front
 * of the red and blue towers. Each x is a multiple of 1/16, which 32-bit floats hold exactly
 * 1,000 km from the origin too, so the scene moved there starts from the same numbers.
 */
export const ORTHO_CUBES: readonly Vec3[] = Array.from(
	{ length: 7 },
	(_, k): Vec3 => [3.5 - k * 1.125, ORTHO_CUBE_SIZE / 2, 3.5],
);

/** The object count that each engine's page reports: the boxes and the cubes. */
export const ORTHO_COUNT = ORTHO_BOXES.length + ORTHO_CUBES.length;
