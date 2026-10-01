// The texture background's scene, defined once for null3D's image test and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports: a small
// picture fills the view behind a lit box and an unlit box, as a texture in three.js's
// `scene.background` does. Each page draws the picture in code (tests/pages/lib/picture.ts), and
// each engine loads it with its texture loader's defaults, so it stands upright, and stretches it
// to the wide view.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const BACKGROUND_IMAGE = PARITY_CANVAS;

/** The picture: rows of sRGB colors, top row first, one color per pixel. */
export const BACKGROUND_PICTURE: readonly (readonly string[])[] = [
	['#e8554e', '#f2c14e', '#5bc27a', '#4a8cff'],
	['#20242a', '#b06ce0', '#fafafa', '#8a8f99'],
];

/** The camera: a perspective lens, where it stands, and the point it looks at. */
export const BACKGROUND_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 50,
	position: [0, 2.5, 6],
	target: [0, 0, 0],
} as const satisfies {
	fov: number;
	near: number;
	far: number;
	position: Vec3;
	target: Vec3;
};

/** A box: its size along x, y and z, its center, its sRGB color, and whether lights shade it. */
export interface BackgroundBox {
	size: Vec3;
	position: Vec3;
	color: string;
	lit: boolean;
}

/** The boxes in front of the picture. */
export const BACKGROUND_BOXES: readonly BackgroundBox[] = [
	{ size: [1.6, 1.6, 1.6], position: [-1.3, 0, 0], color: '#e8554e', lit: true },
	{ size: [1, 1, 1], position: [1.6, -0.3, 0.5], color: '#4a8cff', lit: false },
];
