// The transparent planes' scene, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports. Three
// see-through planes overlap in front of a wall, in an order that differs from the order of their
// creation, and a see-through sphere stands in front of them. Each engine must draw them farthest
// first with normal blending, as three.js does with `transparent: true`.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const GLASS_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const GLASS_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [1.5, 2, 7],
	target: [0, 1.2, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface GlassBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/**
 * The floor and the wall behind the planes. The wall fills the view behind the planes: the two
 * engines average the MSAA samples of an edge between a light surface and the dark background
 * differently, which is no part of what the scene checks.
 */
export const GLASS_BOXES: readonly GlassBox[] = [
	{ size: [12, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	{ size: [24, 12, 0.3], position: [0, 6, -2.2], color: '#e0e2e6' },
];

/**
 * A see-through plane: its width and height, whether lights shade it, its sRGB color and opacity,
 * its center, and its turn about the y axis in radians.
 */
export interface GlassPlane {
	size: readonly [number, number];
	lit: boolean;
	color: string;
	opacity: number;
	position: Vec3;
	turn: number;
}

/** The planes, in the order both engines create them: the nearest first, the farthest last. */
export const GLASS_PLANES: readonly GlassPlane[] = [
	{
		size: [1.6, 1.6],
		lit: false,
		color: '#4a8cff',
		opacity: 0.45,
		position: [0.9, 1.1, 1.4],
		turn: -0.2,
	},
	{
		size: [2, 2],
		lit: true,
		color: '#5bc27a',
		opacity: 0.6,
		position: [0, 1.4, 0.3],
		turn: 0.35,
	},
	{
		size: [2.2, 1.8],
		lit: false,
		color: '#e8554e',
		opacity: 0.5,
		position: [-0.9, 1.3, -0.8],
		turn: 0,
	},
];

/** The see-through sphere in front of the planes: its radius, sRGB color, opacity and center. */
export const GLASS_SPHERE = {
	radius: 0.5,
	color: '#f2c14e',
	opacity: 0.5,
	position: [-1.3, 0.6, 2] as Vec3,
} as const;

/** The segments of the sphere around and from pole to pole, the same in both engines. */
export const GLASS_SPHERE_SEGMENTS = [32, 16] as const;

/** The object count that each engine's page reports: the boxes, the planes and the sphere. */
export const GLASS_COUNT = GLASS_BOXES.length + GLASS_PLANES.length + 1;
