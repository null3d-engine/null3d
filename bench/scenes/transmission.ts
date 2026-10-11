// The glass scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports. Three glass balls
// stand in front of a striped wall: a smooth one, a rough one and a thick tinted one. Each lets
// all the light behind it through, as three.js's `MeshPhysicalMaterial` with `transmission: 1`
// does. The smooth ball bends the stripes and turns them around, the rough one blurs them, and
// the tinted one takes the color of its volume over the light's path through it.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const TRANSMISSION_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const TRANSMISSION_CAMERA = {
	fov: 40,
	near: 0.1,
	far: 100,
	position: [0, 1.3, 6.5],
	target: [0, 0.8, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface TransmissionBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The colors of the wall's stripes, from the left, again and again. */
const STRIPE_COLORS = ['#e8554e', '#f2efe6', '#4a8cff', '#f2efe6'] as const;
/** The stripes across the wall, and the width of each. */
const STRIPES = 16;
const STRIPE_WIDTH = 0.5;

/**
 * The floor, and the wall of upright stripes behind the balls, which fills the view behind them.
 * The stripes show how far each ball bends the light, and how much it blurs it.
 */
export const TRANSMISSION_BOXES: readonly TransmissionBox[] = [
	{ size: [12, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	...Array.from(
		{ length: STRIPES },
		(_, k): TransmissionBox => ({
			size: [STRIPE_WIDTH, 6, 0.2],
			position: [(k - (STRIPES - 1) / 2) * STRIPE_WIDTH, 3, -1.5],
			color: STRIPE_COLORS[k % STRIPE_COLORS.length] as string,
		}),
	),
];

/**
 * A ball that lets light through: its center, its roughness, the thickness of its volume, and the
 * color and distance of the volume's absorption, or none for a volume that absorbs nothing.
 */
export interface TransmissionBall {
	position: Vec3;
	roughness: number;
	thickness: number;
	attenuation?: { color: string; distance: number };
}

/** The balls' radius, and the segments of each around and from pole to pole. */
export const BALL_RADIUS = 0.7;
export const BALL_SEGMENTS = [48, 24] as const;
/** The index of refraction of every ball: glass's, and the glTF default. */
export const BALL_IOR = 1.5;

/** The balls from the left: smooth, rough, and smooth with a tinted volume. */
export const TRANSMISSION_BALLS: readonly TransmissionBall[] = [
	{ position: [-1.9, 0.7, 0.6], roughness: 0, thickness: 2 * BALL_RADIUS },
	{ position: [0, 0.7, 0.6], roughness: 0.4, thickness: 2 * BALL_RADIUS },
	{
		position: [1.9, 0.7, 0.6],
		roughness: 0.05,
		thickness: 2 * BALL_RADIUS,
		attenuation: { color: '#3d9be0', distance: 0.8 },
	},
];

/** The object count that each engine's page reports: the boxes and the balls. */
export const TRANSMISSION_COUNT = TRANSMISSION_BOXES.length + TRANSMISSION_BALLS.length;
